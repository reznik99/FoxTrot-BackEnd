const url = require('url')
const wslib = require('ws')
const jwt = require('jsonwebtoken')
const jwtConfig = require('./config/jwtConfig')

const wsClients = new Map()

module.exports = {
    wsClients: wsClients,
    configureWebsocket: (expressServer) => {
        // Define the WebSocket server. Here, the server mounts to the `/ws` route of the Express JS server.
        const wss = new wslib.Server({ server: expressServer, path: '/ws' })


        wss.on('connection', (ws, req) => {
            const token = url.parse(req.url, true).query.token

            jwt.verify(token, jwtConfig.secret, (err, decoded) => {
                if (err) {
                    console.error("Websocket connection rejected, invalid JWT")
                    ws.close()
                } else {
                    wsClients.set(decoded.phone_no, ws)
                    ws.isAlive = true
                    ws.session = decoded
                    console.log(`New Websocket connection established for ${decoded.phone_no}`)
                }
            })

            // Handlers
            ws.on('pong', () => {
                ws.isAlive = true
            })
            ws.on('message', (data) => {
                jwt.verify(token, jwtConfig.secret, (err, decoded) => {
                    if (err) {
                        console.error("Websocket connection rejected, invalid JWT")
                        ws.close()
                    }
                })
                console.log(data.toString())
                const cmd = JSON.parse(data)
                switch (cmd.cmd) {
                    case "MSG":
                        const targetWS = wsClients.get(cmd.target)
                        if (!targetWS) ws.send("User not online")
                        else targetWS.send(ws.session.phone_no + ": " + cmd.data)
                        break
                    default:
                        ws.send(ws.session.phone_no + ": " + data)
                }
            })
            ws.on('close', () => {
                console.log(`Closing websocket for ${ws.session?.phone_no}`)
                wsClients.delete(ws.session?.phone_no)
                ws.close()
            })
        })

        const interval = setInterval(() => {
            wss.clients.forEach((ws) => {
                console.log(`Pinging ${ws.session?.phone_no}'s websocket`)
                if (!ws.isAlive) return ws.terminate()
                ws.isAlive = false
                ws.ping(() => { })
            })
        }, 5000)
    }
}