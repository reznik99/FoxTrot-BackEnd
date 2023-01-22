
const express = require('express'),
    passport = require('passport'),
    morgan = require('morgan'),
    bodyParser = require('body-parser'),
    createRoutes = require('./routes'),
    { configureWebsocket } = require('./websockets'),
    auth = require('./auth')

const PORT = process.env.PORT || 1234
const app = express()

//middleware
app.use(bodyParser.json())
app.use(morgan(':method :url :status :res[content-length] in :response-time ms'))
app.use(passport.initialize())

//authentication and routes
auth(passport)
createRoutes(app, passport)

//listen
const expressServer = app.listen(PORT, () => {
    console.info(`FoxTrot Server mode:${process.env.NODE_ENV} listening on ${PORT}`)
})

configureWebsocket(expressServer)