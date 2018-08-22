const fs = require('fs')
const http = require('http')
const { URL } = require('url')
const { DEBUG, HEADFUL, CHROME_BIN, PORT } = process.env

const puppeteer = require('puppeteer')
const puppeteer_har = require('puppeteer-har')
const jimp = require('jimp')
const pTimeout = require('p-timeout')
const LRU = require('lru-cache')
const cache = LRU({
  max: process.env.CACHE_SIZE || Infinity,
  maxAge: 1000 * 60, // 1 minute
  noDisposeOnSet: true,
  dispose: async (url, page) => {
    try {
      if (page && page.close){
        console.log('🗑 Disposing ' + url)
        page.removeAllListeners()
        await page.deleteCookie(await page.cookies())
        await page.close()
      }
    } catch (e) {
      console.log('Caught page error')
    }
  }
})
setInterval(() => cache.prune(), 1000 * 60) // Prune every minute

const blocked = require('./blocked.json')
const blockedRegExp = new RegExp('(' + blocked.join('|') + ')', 'i')

const truncate = (str, len) => str.length > len ? str.slice(0, len) + '…' : str

let browser

http.createServer(async (req, res) => {

  const { host } = req.headers
  
  if (req.url == '/'){
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public,max-age=31536000',
    })
    res.end(fs.readFileSync('index.html'))
    return
  }
  
  if (req.url == '/favicon.ico'){
    res.writeHead(204)
    res.end()
    return
  }
  
  if (req.url == '/_debug'){
    res.writeHead(200, {
      'content-type': 'application/json; charset=UTF-8',
    })
    res.end(JSON.stringify({
      pages: cache.keys(),
      process: {
        versions: process.versions,
        memoryUsage: process.memoryUsage(),
      },
    }, null, '\t'))
    return
  }

  if (req.url == '/_ping'){
    res.writeHead(200, {
      'content-type': 'application/json; charset=UTF-8',
    })
    res.end(JSON.stringify({
      status: 'ok'
    }))
    return
  }

  if ((req.url == '/exec') & (req.method == 'POST')) {
    var body = ''
    req.on('data', function(data) {
      body += data
    }).on('end', () => {
      console.log(body)
      eval(body)
      res.end('ok')
    })
    return
  }

  if (req.url == '/screenshot'){
    const fullPage = true
    
    let pages = await browser.pages()
    let screenshot = await pTimeout(pages[0].screenshot({
      type: 'jpeg',
      fullPage,
    }), 20 * 1000, 'Screenshot timed out')
    
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'cache-control': 'public,max-age=31536000',
    })
    
    res.end(screenshot, 'binary')
    return
  }

  
  const [_, action, url] = req.url.match(/^\/(render_html|render_har|render_jpeg|render_pdf)?\/?(.*)/i) || ['', '', '']
  
  if (!url){
    res.writeHead(400, {
      'content-type': 'text/plain; charset=UTF-8',
    })
    res.end('Something is wrong. Missing URL.')
    return
  }
  
  if (cache.itemCount > 20){
    res.writeHead(420, {
      'content-type': 'text/plain',
    })
    res.end(`There are ${cache.itemCount} pages in the current instance now. Please try again in few minutes.`)
    return
  }
  
  let page, pageURL
  try {
    
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Invalid URL')
    }
  
    const { origin, hostname, pathname, searchParams } = new URL(url)
    const path = decodeURIComponent(pathname)
    
    await new Promise((resolve, reject) => {
      const req = http.request({
        method: 'HEAD',
        host: hostname,
        path,
      }, ({ statusCode, headers }) => {
        if (!headers || (statusCode == 200 && !/text\/html/i.test(headers['content-type']))){
          reject(new Error('Not a HTML page'))
        } else {
          resolve()
        }
      })
      req.on('error', reject)
      req.end()
    })
    
    pageURL = origin + path
    let actionDone = false
  

    const width = parseInt(searchParams.get('width'), 10) || 1024
    const height = parseInt(searchParams.get('height'), 10) || 768
    
    // page = cache.get(pageURL)
    if (!browser) {
      console.log('🚀 Launch browser!')
      const config = {
        ignoreHTTPSErrors: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ],
      }
      if (DEBUG) config.dumpio = true
      if (HEADFUL) {
        config.headless = false
        config.args.push('--auto-open-devtools-for-tabs')
      }
      if (CHROME_BIN) config.executablePath = CHROME_BIN
      browser = await puppeteer.launch(config)
    }

    page = await browser.newPage()
    await page.setCacheEnabled(false)

    const har = new puppeteer_har(page)

    await har.start()
    
    const nowTime = +new Date()
    let reqCount = 0
    await page.setRequestInterception(true)
    
    page.on('request', (request) => {
      const url = request.url()
      const method = request.method()
      const resourceType = request.resourceType()
      
      // Skip data URIs
      if (/^data:/i.test(url)){
        request.continue()
        return
      }
      
      const seconds = (+new Date() - nowTime) / 1000
      const shortURL = truncate(url, 70)
      const otherResources = /^(manifest|other)$/i.test(resourceType)
      // Abort requests that exceeds 15 seconds
      // Also abort if more than 100 requests
      if (seconds > 15 || reqCount > 100 || actionDone){
        console.log(`❌⏳ ${method} ${shortURL}`)
        request.abort()
      } else if (blockedRegExp.test(url) || otherResources){
        console.log(`❌ ${method} ${shortURL}`)
        request.abort()
      } else {
        console.log(`✅ ${method} ${shortURL}`)
        request.continue()
        reqCount++
      }
    })
    
    let responseReject
    const responsePromise = new Promise((_, reject) => {
      responseReject = reject
    })

    page.on('response', ({ headers }) => {
      const location = headers['location']
      if (location && location.includes(host)){
        responseReject(new Error('Possible infinite redirects detected.'))
      }
    })
    
    await page.setViewport({
      width,
      height,
    })
    
    console.log('⬇️ Fetching ' + pageURL)
    await Promise.race([
      responsePromise,
      page.goto(pageURL, {
        waitUntil: 'networkidle2',
      })
    ])
    
    // Pause all media and stop buffering
    page.frames().forEach((frame) => {
      frame.evaluate(() => {
        document.querySelectorAll('video, audio').forEach(m => {
          if (!m) return
          if (m.pause) m.pause()
          m.preload = 'none'
        })
      })
    })
    
    await page.setViewport({
      width,
      height,
    })
  
    console.log('💥 Perform action: ' + action)
  
    switch (action){
    case 'render_html': {
      const content = await pTimeout(page.content(), 10 * 1000, 'Render timed out')
      res.writeHead(200, {
        'content-type': 'text/html; charset=UTF-8',
        'cache-control': 'public,max-age=31536000',
      })
      res.end(content)
      break
    }
    case 'render_har': {
      const har_content = await pTimeout(har.stop(), 10 * 1000, 'Render timed out')
      //console.log(har_content)
      const content = JSON.stringify(har_content, null, 2)
      res.writeHead(200, {
        'content-type': 'application/json; charset=UTF-8',
      })
      res.end(content)
      break
    }
    case 'render_pdf': {
      const format = searchParams.get('format') || null
      const pageRanges = searchParams.get('pageRanges') || null
      
      const pdf = await pTimeout(page.pdf({
        format,
        pageRanges,
      }), 10 * 1000, 'PDF timed out')
      
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'cache-control': 'public,max-age=31536000',
      })
      res.end(pdf, 'binary')
      break
    }
    case 'render_jpeg': {
      const thumbWidth = parseInt(searchParams.get('thumbWidth'), 10) || null
      const fullPage = searchParams.get('fullPage') == 'true' || false
      const clipSelector = searchParams.get('clipSelector')
      
      let screenshot
      if (clipSelector){
        const handle = await page.$(clipSelector)
        if (handle){
          screenshot = await pTimeout(handle.screenshot({
            type: 'jpeg',
          }), 20 * 1000, 'Screenshot timed out')
        }
      } else {
        screenshot = await pTimeout(page.screenshot({
          type: 'jpeg',
          fullPage,
        }), 20 * 1000, 'Screenshot timed out')
      }
      
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'cache-control': 'public,max-age=31536000',
      })
      
      if (thumbWidth && thumbWidth < width){
        const image = await jimp.read(screenshot)
        image.resize(thumbWidth, jimp.AUTO).quality(90).getBuffer(jimp.MIME_JPEG, (err, buffer) => {
          res.end(buffer, 'binary')
        })
      } else {
        res.end(screenshot, 'binary')
      }
      break
    }
    }
  
    actionDone = true
    console.log('💥 Done action: ' + action)
    if (!cache.has(pageURL)){
      cache.set(pageURL, page)
      
      // Try to stop all execution
      page.frames().forEach((frame) => {
        frame.evaluate(() => {
          // Clear all timer intervals https://stackoverflow.com/a/6843415/20838
          for (var i = 1; i < 99999; i++) window.clearInterval(i)
          // Disable all XHR requests
          XMLHttpRequest.prototype.send = _=>_
          // Disable all RAFs
          requestAnimationFrame = _=>_
        })
      })
    }
  } catch (e) {
    if (!DEBUG && page) {
      console.error(e)
      console.log('💔 Force close ' + pageURL)
      page.removeAllListeners()
      page.close()
    }
    cache.del(pageURL)
    const { message = '' } = e
    res.writeHead(400, {
      'content-type': 'text/plain',
    })
    res.end('Oops. Something is wrong.\n\n' + message)
    
    // Handle websocket not opened error
    if (/not opened/i.test(message) && browser){
      console.error('🕸 Web socket failed')
      try {
        browser.close()
        browser = null
      } catch (err) {
        console.warn(`Chrome could not be killed ${err.message}`)
        browser = null
      }
    }
  }
}).listen(PORT || 3000)

process.on('SIGINT', () => {
  if (browser) browser.close()
  process.exit()
})

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at:', p, 'reason:', reason)
})