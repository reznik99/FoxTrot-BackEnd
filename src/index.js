
const express = require('express'),
    passport = require('passport'),
    morgan = require('morgan'),
    bodyParser = require('body-parser'),
    createRoutes = require('./routes'),
    { configureWebsocket } = require('./websockets'),
    auth = require('./auth')

const PORT = process.env.PORT || 1234
const app = express()

// Middleware & Logging
app.use(bodyParser.json({limit: '10mb'}))
app.use(morgan(':method :url :status :res[content-length] in :response-time ms'))
app.use(passport.initialize())

// Authentication & Routes
auth(passport)
createRoutes(app, passport)

// Start & Listen
const expressServer = app.listen(PORT, () => {
    console.info(`FoxTrot Server mode:${process.env.NODE_ENV} listening on ${PORT}`)
})

configureWebsocket(expressServer)