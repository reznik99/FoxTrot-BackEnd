
import express from 'express'
import passport from 'passport'
import morgan from 'morgan'
import bodyParser from 'body-parser'

import { InitWebsocketServer } from "./sockets"
import { CreateRoutes } from "./routes"
import { InitAuth } from "./auth"

const PORT = parseInt(process.env.PORT || "1234")
const app = express()

// Middleware & Logging
app.use(bodyParser.json({ limit: '10mb' }))
app.use(morgan(':date \x1b[33m:method\x1b[0m \x1b[36m:url\x1b[0m :status :res[content-length]bytes in :response-time ms'))
app.use(passport.initialize())

// Authentication & Routes
InitAuth(passport)
CreateRoutes(app, passport)

// Start & Listen
const expressServer = app.listen(PORT, () => {
    console.info(`FoxTrot Server mode:${process.env.NODE_ENV} listening on ${PORT}`)
})

InitWebsocketServer(expressServer)