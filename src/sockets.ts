import { IncomingMessage, Server } from 'http'
import jwt, { JwtPayload } from 'jsonwebtoken'
import wslib from 'ws'
import url from 'url'

import { jwtSecret } from './config/jwtConfig'

interface WebSocketServer extends wslib.Server {
    clients: Set<WebSocket>
}
interface WebSocket extends wslib {
    isAlive: boolean;
    session: JwtPayload;
}

const LogHeader = "\x1b[33mWSS:\x1b[0m"
const socketPingMs = 30000
export const wsClients = new Map()

export const InitWebsocketServer = (expressServer: Server) => {
    // Define the WebSocket server. Here, the server mounts to the `/ws` route of the Express JS server.
    const wss = new wslib.Server({ server: expressServer, path: '/foxtrot-api/ws' }) as WebSocketServer

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const token = url.parse(req.url as string, true).query.token as string

        try {
            const decoded = jwt.verify(token, jwtSecret) as JwtPayload
            wsClients.set(decoded.id, ws)
            ws.isAlive = true
            ws.session = decoded
            console.log(`${LogHeader} connection established for`, decoded.phone_no)
        } catch (err) {
            console.error(`${LogHeader} connection rejected, invalid JWT`)
            ws.close()
        }

        // Handlers
        ws.on('message', (data) => {
            try {
                const parsedData = JSON.parse(data.toString())
                switch (parsedData.cmd) {
                    // WebRTC Call Signaling logic
                    case "CALL_OFFER":
                    case "CALL_ICE_CANDIDATE":
                    case "CALL_ANSWER":
                        console.log(`${LogHeader} (${parsedData.cmd}) ${ws.session.phone_no} -> ${parsedData.data.reciever}: (${data.toString()?.length} bytes)`)
                        if (!wsClients.has(parsedData.data.reciever_id)) {
                            // TODO: Handle this case using push notifications
                            return
                        }
                        const targetWS = wsClients.get(parsedData.data.reciever_id)
                        targetWS.send(JSON.stringify({ ...parsedData, data: { ...parsedData.data, sender_id: ws.session.id, sender: ws.session.phone_no } }))
                        break
                    default:
                        throw new Error(`Unknown command recieved: ${parsedData.cmd}`)
                }
            } catch (err: any) {
                ws.send("Error receiving data", err.message || err)
                console.warn(`${LogHeader} Error receiving data: `, err.message || err)
            }
        })

        ws.on('pong', () => { ws.isAlive = true })

        ws.on('close', () => {
            console.log(`${LogHeader} Closing websocket for ${ws.session?.phone_no}`)
            wsClients.delete(ws.session?.id)
            ws.close()
        })
    })

    setInterval(() => {
        wss.clients.forEach((ws: WebSocket) => {
            if (!ws.isAlive) {
                console.log(`${LogHeader} ${ws.session?.phone_no}'s websocket is dead. Terminating...`)
                wsClients.delete(ws.session?.id)
                return ws.terminate()
            }
            ws.isAlive = false
            ws.ping()
        })
    }, socketPingMs)
}