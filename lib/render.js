const pTimeout = require('p-timeout')
const puppeteer_har = require('puppeteer-har')

const truncate = (str, len) => str.length > len ? str.slice(0, len) + '…' : str
const setupViewport = function(req) {
  return({ height: ((req.query.height * 1) || 768), width: ((req.query.width * 1) || 1024)})
}

// visit a page. Requires the page context and other setup parameters
const visit = async function(page, url, width, height, waitUntil = 'networkidle2') {

  let responseReject
  const responsePromise = new Promise((_, reject) => {
    responseReject = reject
  })

  function _ereq(request) {
    const url = request.url()
    const method = request.method()
    const resourceType = request.resourceType()
    
    // Skip data URIs
    if (/^data:/i.test(url)){
      request.continue()
      return
    }
    
    const shortURL = truncate(url, 70)
    const otherResources = /^(manifest|other)$/i.test(resourceType)
    console.log(`✅ ${method} ${shortURL}`)
    request.continue()
  }

  function _eresp({ headers }) {
    const location = headers['location']
    // if (location && location.includes(host)){
    //   responseReject(new Error('Possible infinite redirects detected.'))
    // }
  }

  page.on('request', _ereq)
  page.on('response', _eresp)

  await page.setViewport({ width, height })

  await Promise.race([
    responsePromise,
    page.goto(url, {
      waitUntil: waitUntil,
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

  await page.setViewport({ width, height })

  page.removeListener('request', _ereq)
  page.removeListener('response', _eresp)

}

// fetch URL and return the javascript-executed page
exports.html = async function(req, h, page) {
  const { width, height } = setupViewport(req)
  await visit(page, req.query.url, width, height)
  return(await pTimeout(page.content(), 10 * 1000, 'Render timed out'))
}

// fetch URL and return the javascript-executed HAR
exports.har = async function(req, h, page) {
  const { width, height } = setupViewport(req)
  const har = new puppeteer_har(page)
  await har.start()
  await visit(page, req.query.url)
  return(await pTimeout(har.stop(), 10 * 1000, 'Render timed out'))
}

// fetch URL and return the javascript-executed PDF
exports.pdf = async function(req, h, page) {
  const { width, height } = setupViewport(req)
  await visit(page, req.query.url, width, height)
  const format = null
  const pageRanges = null
  const pdf = await pTimeout(page.pdf({
    format,
    pageRanges,
  }), 10 * 1000, 'PDF timed out')
  return(h.pdf(pdf, 'gepetto.pdf'))
}

// fetch URL and return the javascript-executed screen capture
exports.png = async function(req, h, page) {
  const { width, height } = setupViewport(req)
  await visit(page, req.query.url, width, height, 'networkidle0')
  const thumbWidth =  null
  const fullPage = true
  let screenshot = await pTimeout(page.screenshot({
    type: 'png',
    fullPage : fullPage,
  }), 20 * 1000, 'Screenshot timed out')
  return(
    h.response(Buffer.from(screenshot))
      .type('image/png')
  )
}
