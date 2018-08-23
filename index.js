#!/usr/bin/env node

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

  await server.register([
    require('hapi-response-utilities'),
    require('vision'), 
    require('inert'), 
    {
      plugin: require('hapi-swagger'), 
      options: { 
        info: { 
          title: 'gepetto API Documentation', 
          description: 'gepetto is a lightweight REST API interface to Headless Chrome',
          version: '0.1.0' 
        } 
      } 
    } 
  ])
  
  server.events.on('stop', () => {
    process.exit(0)
  })

  // our interactive page
  server.route({
    method: 'GET',
    path: '/',
    handler: function(req, h) {
      return(h.file('index.html'))
    }
  })

  // die die die
  server.route({
    method: 'GET',
    path: '/_stop',
    config: {
      description: 'Stop the gepetto service and shudown Headless Chrome',
      tags: ['api'],
    },
    handler: function(req, h) {
      server.stop()
      return({ status: 'ok' })
    }
  })

  // is the server up?
  server.route({
    method: 'GET',
    config: {
      description: 'Test if the gepetto service is up',
      tags: ['api'],
    },
    path: '/_ping',
    handler: function(req, h) {
      return({ status: 'ok' })
    }
  })

  // some debug info (mostly for memory info)
  server.route({
    method: 'GET',
    config: {
      description: 'Return "debug-level" information about the gepetto service execution environment',
      tags: ['api'],
    },
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

  // Just go to a URL
  server.route({
    method: 'GET',
    config: {
      description: 'Go to a URL without returning page contents',
      tags: ['api'],
    },
    path: '/goto',
    handler: async function(req, h) {
      return(await render.goto(req, h, page))
    }
  })

  // Get page metrics
  server.route({
    method: 'GET',
    config: {
      description: 'Retrieve page metrics',
      tags: ['api'],
    }, 
    path: '/page_metrics',
    handler: async function(req, h) {
      return(await page.metrics())
    }
  })

  // Get page title
  server.route({
    method: 'GET',
    config: {
      description: 'Retrieve title of the current page',
      tags: ['api'],
    },
    path: '/page_title',
    handler: async function(req, h) {
      return({ title: await page.title() })
    }
  })

  // Get page url
  server.route({
    method: 'GET',
    config: {
      description: 'Retrieve URL of the current page',
      tags: ['api'],
    },
    path: '/page_url',
    handler: async function(req, h) {
      return({ url : await page.url() })
    }
  })

  // Apply a CSS Selector and return the outerHtml
  server.route({
    method: 'GET',
    config: {
      description: 'Select the first HTML element matching the CSS selector and return the `outerHTML` for it',
      tags: ['api'],
    },
    path: '/select',
    handler: async function(req, h) {
      const selector = req.query.selector
      const element = await page.$eval(selector, el => el.outerHTML)
      return(element ? element : '<html></html>')
    }
  })

  // Apply a CSS Selector and return the outerHtml
  server.route({
    method: 'GET',
    config: {
      description: 'Select all the HTML elements matching the CSS selector and return the `outerHTML` for the collection',
      notes: 'this is a note to see how it appears',
      tags: ['api'],
    },
    path: '/select_all',
    handler: async function(req, h) {
      const selector = req.query.selector
      const els = await page.$$(selector)
      const elements = await page.$$eval(selector, nodes => Array.prototype.reduce.call(nodes, (html, node) => {
        return(html + (node.outerHTML || node.nodeValue))
      }))
      return(elements ? elements : '<html></html>')
    }
  })

  // HTML renderer
  server.route({
    method: 'GET',
    config: {
      description: 'Visit a URL in a javascript context and return the resultant document HTML',
      tags: ['api'],
    },
    path: '/render_html',
    handler: async function(req, h) {
      return(await render.html(req, h, page))
    }
  })

  // HAR renderer
  server.route({
    method: 'GET',
    config: {
      description: 'Visit a URL in a javascript context and return HAR JSON with all of the requests metadata',
      tags: ['api'],
    },
    path: '/render_har',
    handler: async function(req, h) {
      return(await render.har(req, h, page))
    }
  })

  // PDF renderer
  server.route({
    method: 'GET',
    config: {
      description: 'Visit a URL in a javascript context and return the resultant document in PDF form',
      tags: ['api']
    },
    path: '/render_pdf',
    handler: async function(req, h) {
      return(await render.pdf(req, h, page))
    }
  })

  // Image renderer
  server.route({
    method: 'GET',
    config: {
      description: 'Visit a URL in a javascript context and return the resultant document screenshot',
      tags: ['api'],
    },
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

// swagger-codegen generate -i http://localhost:3000/swagger.json -l html2 -o docs