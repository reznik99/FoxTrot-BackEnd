import { IncomingMessage, Server } from 'http';
import jwt, { JwtPayload } from 'jsonwebtoken';
import firebase from 'firebase-admin';
import wslib from 'ws';
import url from 'url';

import { ResetColor, YellowColor, log_error, log_info, log_warning } from './middlware/log';
import { callsCounter, websocketCounter } from './middlware/metrics';
import { JWT_SECRET } from './config/envConfig';
import { getFCMToken } from './routes';

interface WebSocketServer extends wslib.Server {
    clients: Set<WebSocket>
}
interface WebSocket extends wslib {
    isAlive: boolean;
    session: JwtPayload;
}
export interface SocketData {
    cmd: 'MSG' | 'CALL_OFFER' | 'CALL_ICE_CANDIDATE' | 'CALL_ANSWER';
    data: SocketMessage;
}
export interface SocketMessage {
    sender: string;
    sender_id: string | number;
    reciever: string;
    reciever_id: string;
    message?: string;
    sent_at?: number;
    seen?: boolean;
    offer?: any;
    answer?: any;
    candidate?: unknown;
}

const logHeader = `${YellowColor}WSS${ResetColor}`;
const socketPingMs = 30000;
export const wsClients = new Map<string, WebSocket>();

export const InitWebsocketServer = (expressServer: Server) => {
    // Define the WebSocket server. Here, the server mounts to the `/ws` route of the Express JS server.
    const wss = new wslib.Server({ server: expressServer, path: '/foxtrot-api/ws' }) as WebSocketServer;

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        websocketCounter.inc();
        const token = url.parse(req.url as string, true).query.token as string;

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
            wsClients.set(decoded.id, ws);
            ws.isAlive = true;
            ws.session = decoded;
            log_info(logHeader, 'connection established for', decoded.phone_no);
        } catch (err) {
            log_error(logHeader, 'connection rejected, invalid JWT:', err);
            ws.close();
        }

        // Individual websocket event handlers
        ws.on('message', async (data) => {
            try {
                const parsedData = JSON.parse(data.toString()) as SocketData;
                log_info(logHeader, `(${parsedData.cmd}) ${ws.session.phone_no} -> ${parsedData.data.reciever}: (${data.toString()?.length} bytes)`);

                switch (parsedData.cmd) {
                    // WebRTC Call Signaling logic
                    case 'CALL_OFFER': {
                        callsCounter.inc();
                        const targetWS = wsClients.get(parsedData.data.reciever_id);
                        if (!targetWS) {
                            // User is offline, send push notification to trigger call screen on receiver's device
                            const fcm_token = await getFCMToken(parsedData.data.reciever_id);
                            if (!fcm_token) {
                                log_warning(logHeader, 'No FCM token for user', parsedData.data.reciever_id, 'cannot send push notification for call');
                                break;
                            }
                            await firebase.messaging().send({
                                token: fcm_token,
                                android: {
                                    priority: 'high'
                                },
                                data: {
                                    caller: JSON.stringify({
                                        id: parsedData.data.sender_id,
                                        phone_no: parsedData.data.sender,
                                        pic: `https://robohash.org/${parsedData.data.sender_id}?size=150x150`,
                                        public_key: '',
                                        session_key: ''
                                    }),
                                },
                            });
                            return;
                        }
                        proxyMessage(ws, parsedData);
                        break;
                    }
                    case 'CALL_ICE_CANDIDATE': {
                        proxyMessage(ws, parsedData);
                        break;
                    }
                    case 'CALL_ANSWER': {
                        proxyMessage(ws, parsedData);
                        break;
                    }
                    default:
                        throw new Error(`Unknown command recieved: ${parsedData.cmd}`);
                }
            } catch (err) {
                ws.send('Error receiving data');
                log_warning(logHeader, 'Error receiving data:', err);
            }
        });
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('ping', () => ws.pong());
        ws.on('error', (err) => log_warning(logHeader, 'Websocket error for', ws.session?.phone_no, ':', err));
        ws.on('close', (code) => {
            log_info(logHeader, 'Closing websocket for', ws.session?.phone_no, 'with code', code);
            const deleted = wsClients.delete(ws.session?.id);
            if (deleted) websocketCounter.dec();
            ws.close();
        });
    });

    setInterval(() => websocketHeartbeat(wss), socketPingMs);
};

/**
 * Proxies message from one websocket to another after overriding sender info with `ws` session info
 * @param ws Sender websocket (used for sender info)
 * @param parsedData data to proxy (includes destination info)
 */
function proxyMessage(ws: WebSocket, parsedData: SocketData) {
    const targetWS = wsClients.get(parsedData.data.reciever_id);
    // Override sender info to avoid spoofing
    const proxyMsg: SocketData = {
        ...parsedData,
        data: { ...parsedData.data, sender_id: ws.session.id, sender: ws.session.phone_no },
    };
    targetWS?.send(JSON.stringify(proxyMsg));
}

/**
 * Iterates through all connected websockets and terminates those that are unresponsive
 * and sends ping to the rest.
 * @param wss WebSocket server instance
 */
function websocketHeartbeat(wss: WebSocketServer) {
    wss.clients.forEach((ws: WebSocket) => {
        if (!ws.isAlive) {
            log_info(logHeader, `${ws.session?.phone_no}'s websocket is dead. Terminating...`);
            wsClients.delete(ws.session?.id);
            websocketCounter.dec();
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}
