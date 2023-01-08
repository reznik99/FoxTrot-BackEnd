const url = require('url')
const wslib = require('ws')
const jwt = require('jsonwebtoken')
const jwtConfig = require('./config/jwtConfig')

const wsClients = new Map()
const socketPingMs = 30000

module.exports = {
    wsClients: wsClients,
    configureWebsocket: (expressServer) => {
        // Define the WebSocket server. Here, the server mounts to the `/ws` route of the Express JS server.
        const wss = new wslib.Server({ server: expressServer, path: '/foxtrot-api/ws' })


        wss.on('connection', (ws, req) => {
            const token = url.parse(req.url, true).query.token

            jwt.verify(token, jwtConfig.secret, (err, decoded) => {
                if (err) {
                    console.error("Websocket connection rejected, invalid JWT")
                    ws.close()
                } else {
                    wsClients.set(decoded.id, ws)
                    ws.isAlive = true
                    ws.session = decoded
                    console.log(`Websocket connection established for ${decoded.phone_no}`)
                }
            })

            // Handlers
            ws.on('pong', () => { ws.isAlive = true })
            ws.on('message', (data) => {
                jwt.verify(token, jwtConfig.secret, (err, decoded) => {
                    if (err) {
                        console.error("Websocket connection rejected, invalid JWT")
                        ws.close()
                    }
                })
                console.log(data.toString())
                try {
                    const parsedData = JSON.parse(data)
                    switch (parsedData.cmd) {
                        case "CALL_OFFER":
                        case "CALL_ANSWER": // Forward webrtc peer offer
                            if (!wsClients.has(parsedData.data.reciever_id)) {
                                ws.send("User not online")
                                // TODO: Handle this case using push notifications
                                return
                            }
                            const targetWS = wsClients.get(parsedData.data.reciever_id)
                            targetWS.send(JSON.stringify({...parsedData, data: {...parsedData.data, sender_id: ws.session.id, sender: ws.session.phone_no}}))
                            break
                        default:                                                                                                                                        
                            throw new Error(`Unknown command recieved: ${parsedData.cmd}`)
                    }
                } catch (err) {
                    ws.send("Invalid JSON data")
                    console.warn('Websocket message error: ', err.message || err)
                }
            })
            ws.on('close', () => {
                console.log(`Closing websocket for ${ws.session?.phone_no}`)
                wsClients.delete(ws.session?.id)
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
        }, socketPingMs)
    }
}