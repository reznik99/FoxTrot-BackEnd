
import express from 'express'
import passport from 'passport'
import morgan from 'morgan'
import bodyParser from 'body-parser'

import { InitWebsocketServer } from "./sockets"
import { CreateRoutes } from "./routes"
import { InitAuth } from "./auth"
import { CyanColor, ResetColor, YellowColor, log_info } from './log'

const PORT = parseInt(process.env.PORT || "1234")
const app = express()

// Middleware & Logging
app.use(bodyParser.json({ limit: '10mb' }))
app.use(morgan(`${CyanColor}[INFO] :date ${ResetColor}${YellowColor}:method${ResetColor} ${CyanColor}:url${ResetColor} :status :res[content-length]bytes in :response-time ms`))
app.use(passport.initialize())

// Authentication & Routes
InitAuth(passport)
CreateRoutes(app, passport)

// Start & Listen
const expressServer = app.listen(PORT, () => {
    log_info(`FoxTrot Server mode:${process.env.NODE_ENV} listening on ${PORT}`)
})

InitWebsocketServer(expressServer)