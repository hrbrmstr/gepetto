const async = require('async')
const fs = require('fs')
const hapi = require('hapi')
const pTimeout = require('p-timeout')
const puppeteer = require('puppeteer')
const puppeteer_har = require('puppeteer-har')

const { URL } = require('url')
const { DEBUG, HEADFUL, CHROME_BIN, HOST, PORT } = process.env

const truncate = (str, len) => str.length > len ? str.slice(0, len) + '…' : str

const server = new hapi.server({
  port : PORT || 3000,
  host : HOST || 'localhost'
})

const width = 1024
const height = 768

let browser
let page

const init = async () => {

  console.log('🚀 Launch browser!')

  const config = {
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
  }

  browser = await puppeteer.launch(config)

  page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setRequestInterception(true)

  await server.register(require('inert'))
  await server.register(require('hapi-response-utilities'))
  
  const nowTime = +new Date()

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
    console.log(`✅ ${method} ${shortURL}`)
    request.continue()
  })

  let responseReject
  const responsePromise = new Promise((_, reject) => {
    responseReject = reject
  })

  // page.on('response', ({ headers }) => {
  //   const location = headers['location']
  //   if (location && location.includes(host)){
  //     responseReject(new Error('Possible infinite redirects detected.'))
  //   }
  // })

  server.route({
    method: 'GET',
    path: '/',
    handler: function(req, h) {
      return(h.file('index.html'))
    }
  })

  server.route({
    method: 'GET',
    path: '/_ping',
    handler: function(req, h) {
      return({ status: 'ok' })
    }
  })

  server.route({
    method: 'GET',
    path: '/_debug',
    handler: async function(req, h) {
      return({
        browser: {
          version:  await browser.version(),
          user_agent: await browser.userAgent()
        },
        process: {
          versions: process.versions,
          memoryUsage: process.memoryUsage(),
        },
      })
    }
  })

  server.route({
    method: 'GET',
    path: '/render_html',
    handler: async function(req, h) {

      await page.setViewport({
        width,
        height,
      })

      await Promise.race([
        responsePromise,
        page.goto(req.query.url, {
          waitUntil: 'networkidle2',
        })
      ])

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

      const content = await pTimeout(page.content(), 10 * 1000, 'Render timed out')

      return(content)

    }
  })

  server.route({
    method: 'GET',
    path: '/render_har',
    handler: async function(req, h) {

      const har = new puppeteer_har(page)
      await har.start()

      await page.setViewport({
        width,
        height,
      })

      await Promise.race([
        responsePromise,
        page.goto(req.query.url, {
          waitUntil: 'networkidle2',
        })
      ])

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

      const har_content = await pTimeout(har.stop(), 10 * 1000, 'Render timed out')

      return(har_content)

    }
  })

  server.route({
    method: 'GET',
    path: '/render_pdf',
    handler: async function(req, h) {

      await page.setViewport({
        width,
        height,
      })

      await Promise.race([
        responsePromise,
        page.goto(req.query.url, {
          waitUntil: 'networkidle2',
        })
      ])

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

      const format = null
      const pageRanges = null

      const pdf = await pTimeout(page.pdf({
        format,
        pageRanges,
      }), 10 * 1000, 'PDF timed out')

      return(h.pdf(pdf, 'gepetto.pdf'))

    }
  })


  server.route({
    method: 'GET',
    path: '/render_png',
    handler: async function(req, h) {
      const thumbWidth =  null
      const fullPage = false

      await page.setViewport({
        width,
        height,
      })

      await Promise.race([
        responsePromise,
        page.goto(req.query.url, {
          waitUntil: 'networkidle2',
        })
      ])

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
      
      let screenshot = await pTimeout(page.screenshot({
        type: 'png',
        fullPage,
      }), 20 * 1000, 'Screenshot timed out')
      
      return(
        h.response(Buffer.from(screenshot))
          .type('image/png')

      )

    }
  })

  await server.start()
  
  console.log(`👍 gepetto running on: ${server.info.uri}`)

}

process.on('unhandledRejection', (err) => {
  console.log(err)
})

init()