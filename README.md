# gepetto

[ScrapingHub Splash](https://github.com/scrapinghub/splash)-like REST API for [Headless Chrome](https://developers.google.com/web/updates/2017/04/headless-chrome) based on [Puppeteer](https://github.com/GoogleChrome/puppeteer/blob/v1.7.0/docs/api.md)

## Description

Splash is a lightweight, scriptable browser as a service with an HTTP API. This project aims to create the same for Headless Chrome and duplicate the high-level Splash API and offer similiar functionality as is provided by Splash's Lua interface (without supporting Lua).

The goal is not to become a full [WebDriver](https://www.w3.org/TR/webdriver/) (i.e. it's not aiming to replace [Selenium](https://www.seleniumhq.org/projects/webdriver/)) but to provide a straigthforward/concise facility for loading URLs in a javascript context and obtaining HTML, PDF or screenshot data back. 

It requires a recent installation of [Node.js](https://nodejs.org/en/) and [npm](https://www.npmjs.com/).

## Installation

    npm install https://gitlab.com/hrbrmstr/gepetto.git --global 

or:

    git clone git@gitlab.com/hrbrmstr/gepetto
    cd gepetto
    npm install [-g] # use -g for global installation which may require sudo on some systems

This will grab all the dependencies and also download a module-copy of Chromium for the platfor you are on.

## What's Inside the Tin?

### Starting the Server

If you only performed a local installation, then you can fire up `gepetto` in the module directory with:

    $ node index
    🚀 Launch browser!
    👍 gepetto running on: http://localhost:3000

If you already have a service running on TCP port 3000, then you can change the port `gepetto` uses via:

    $ PORT=#### node index

If you performed a global installation, you now have a `gepetto` command on your `PATH` and can just do:

    $ gepetto

or:

    PORT=#### gepetto

You can use the `HOST` environment variable to change what IP address the service listens on.

### API Documentation

There is online API documentation for `gepetto` at the `/documentation` endpoint. i.e., if you're running with the defaults, you can go to <http://localhost:3000/documentation> and see the API documentation there. 

Static documentation is avaiable at `docs/index.html` from the module's top-level directory.
