const hapi = require('hapi')
const puppeteer = require('puppeteer')

// our render helpers
const render = require('./lib/render')

const { URL } = require('url')
const { DEBUG, HEADFUL, CHROME_BIN, HOST, PORT } = process.env

const server = new hapi.server({
  port : PORT || 3000,
  host : HOST || 'localhost'
})

// Puppeteer browser and page contexts
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

  browser = await puppeteer.launch(config) // launch chrome

  page = await browser.newPage() // create a new page

  await page.setCacheEnabled(false)
  await page.setRequestInterception(true)

  await server.register(require('inert'))
  await server.register(require('hapi-response-utilities'))
  
  // our interactive page
  server.route({
    method: 'GET',
    path: '/',
    handler: function(req, h) {
      return(h.file('index.html'))
    }
  })

  // is the server up?
  server.route({
    method: 'GET',
    path: '/_ping',
    handler: function(req, h) {
      return({ status: 'ok' })
    }
  })

  // some debug info (mostly for memory info)
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

  // HTML renderer
  server.route({
    method: 'GET',
    path: '/render_html',
    handler: async function(req, h) {
      return(await render.html(req, h, page))
    }
  })

  // HAR renderer
  server.route({
    method: 'GET',
    path: '/render_har',
    handler: async function(req, h) {
      return(await render.har(req, h, page))
    }
  })

  // PDF renderer
  server.route({
    method: 'GET',
    path: '/render_pdf',
    handler: async function(req, h) {
      return(await render.pdf(req, h, page))
    }
  })

  // Image renderer
  server.route({
    method: 'GET',
    path: '/render_png',
    handler: async function(req, h) {
      return(await render.png(req, h, page))
    }
  })

  // let's go!
  await server.start()
  
  console.log(`👍 gepetto running on: ${server.info.uri}`)

}

process.on('unhandledRejection', (err) => {
  console.log(err)
})

init()