import { IncomingMessage, Server } from 'http';
import jwt, { JwtPayload } from 'jsonwebtoken';
import wslib from 'ws';
import url from 'url';

import { callsCounter, websocketCounter } from './middlware/metrics';
import { pool, ServerConfig } from './config/envConfig';
import { getFCMToken } from './routes';
import { firebaseMessaging } from '.';
import { logger } from './middlware/log';

interface WebSocketServer extends wslib.Server {
    clients: Set<WebSocket>
}
interface WebSocket extends wslib {
    isAlive: boolean;
    session: JwtPayload;
}
export interface SocketData {
    cmd: 'MSG' | 'CALL_OFFER' | 'CALL_ICE_CANDIDATE' | 'CALL_ANSWER' | 'CALL_CLOSED';
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
    offer?: string;
    answer?: string;
    candidate?: string;
}
interface WebRTCData {
    offer?: SocketData;
    icecandidates: SocketData[];
    cacheTime: number;
}

const socketPingMs = 30_000;    // 30s ping timeout
const webrtcCacheMs = 90_000;   // 90s webrtc metadata expiry

export const wsClients = new Map<string, WebSocket>();
const webrtcCachedData = new Map<string, WebRTCData>();

export const InitWebsocketServer = (expressServer: Server) => {
    // Define the WebSocket server. Here, the server mounts to the `/ws` route of the Express JS server.
    const wss = new wslib.Server({ server: expressServer, path: '/foxtrot-api/ws' }) as WebSocketServer;

    wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
        const token = url.parse(req.url as string, true).query.token as string;

        try {
            const decoded = jwt.verify(token, ServerConfig.JWT_SECRET) as JwtPayload;
            wsClients.set(decoded.id, ws);
            ws.isAlive = true;
            ws.session = decoded;
            logger.info({ user: decoded.phone_no }, 'WSS: connection established');
            // Update metrics for active websocket counter
            websocketCounter.inc();
            // Set active status in database
            await pool.query('UPDATE users SET online=$1, last_seen=NOW() WHERE id=$2', [true, ws.session.id]);
            // Check if any cached ice candidates await this user
            if (webrtcCachedData.has(ws.session.id)) {
                webrtcSendCachedData(ws);
            }
        } catch (err) {
            logger.error(err, 'WSS: connection rejected, invalid JWT');
            ws.close();
            return;
        }

        // Individual websocket event handlers
        ws.on('message', async (data) => {
            try {
                const parsedData = JSON.parse(data.toString()) as SocketData;
                const size = new Blob([data.toString()]).size;
                logger.info(`WSS: (${parsedData.cmd}) ${ws.session.phone_no} -> ${parsedData.data.reciever}: (${size} bytes)`);

                switch (parsedData.cmd) {
                    // WebRTC Call Signaling logic
                    case 'CALL_OFFER': {
                        callsCounter.inc();
                        // Proxy webrtc call offer if ws online, else cache for a while and send on connection opened event
                        const success = wsProxyMessage(ws, parsedData);
                        if (!success) {
                            webrtcCacheMessage(parsedData);
                            // User is offline, send push notification to trigger call screen on receiver's device
                            sendPushNotificationForCall(parsedData);
                        }
                        break;
                    }
                    case 'CALL_ICE_CANDIDATE': {
                        // Proxy webrtc ice candidate if ws online, else cache for a while and send on connection opened event
                        const success = wsProxyMessage(ws, parsedData);
                        if (!success) {
                            webrtcCacheMessage(parsedData);
                        }
                        break;
                    }
                    case 'CALL_ANSWER': {
                        wsProxyMessage(ws, parsedData);
                        break;
                    }
                    case 'CALL_CLOSED': {
                        // TODO: Check call ID to ensure right call is declined
                        wsProxyMessage(ws, parsedData);
                        break;
                    }
                    default:
                        throw new Error(`Unknown command recieved: ${parsedData.cmd}`);
                }
            } catch (err) {
                logger.error(err, 'WSS: error receiving data');
                ws.send('Error receiving data');
            }
        });
        ws.on('pong', () => {
            ws.isAlive = true;
        });
        ws.on('ping', () => {
            ws.pong();
        });
        ws.on('error', (err) => {
            logger.warn({ err: err, user: ws.session?.phone_no }, 'WSS: websocket error');
        });
        ws.on('close', async (code) => {
            try {
                logger.info({ user: ws.session?.phone_no, code: code }, 'WSS: closing websocket');
                // Delete socket info and update metrics
                const deleted = wsClients.delete(ws.session?.id);
                if (deleted) websocketCounter.dec();
                // Set active status in database
                await pool.query('UPDATE users SET online=$1, last_seen=NOW() WHERE id=$2', [false, ws.session.id]);
            } catch (err) {
                logger.warn({ err: err, user: ws.session?.phone_no }, 'WSS: error on websocket close event');
            }
        });
    });

    setInterval(() => wsHeartbeat(wss), socketPingMs);
};

/**
 * Proxies message from one websocket to another after overriding sender info with `ws` session info
 * @param ws Sender websocket (used for sender info)
 * @param parsedData data to proxy (includes destination info)
 */
function wsProxyMessage(ws: WebSocket, parsedData: SocketData) {
    const targetWS = wsClients.get(parsedData.data.reciever_id);
    if (!targetWS) { return false; }
    // Override sender info to avoid spoofing
    const proxyMsg: SocketData = {
        ...parsedData,
        data: { ...parsedData.data, sender_id: ws.session.id, sender: ws.session.phone_no },
    };
    targetWS.send(JSON.stringify(proxyMsg));
    return true;
}

/**
 * Caches CALL_OFFER and CALL_ICE_CANDIDATE into cache for future use.
 * Used for handling calling while one user is offline / closed app
 * @param parsedData socket data to extract webrtc info from
 */
function webrtcCacheMessage(parsedData: SocketData) {
    const key = parsedData.data.reciever_id;
    if (!webrtcCachedData.has(key)) {
        webrtcCachedData.set(key, { icecandidates: [], cacheTime: Date.now() });
    }
    const cacheEntry = webrtcCachedData.get(key) as WebRTCData;
    switch (parsedData.cmd) {
        case 'CALL_OFFER': {
            cacheEntry.offer = parsedData;
            break;
        }
        case 'CALL_ICE_CANDIDATE': {
            cacheEntry.icecandidates.push(parsedData);
            break;
        }
    }
}

/**
 * Sends all the previously cached webrtc data to the supplied websocket
 * @param ws receiver of cached webrtc data
 */
function webrtcSendCachedData(ws: WebSocket) {
    try {
        const cachedData = webrtcCachedData.get(ws.session.id);
        if (!cachedData) { return; }

        // Check if cache is expired
        if (cachedData.cacheTime < Date.now() - webrtcCacheMs) {
            logger.warn({ cacheTime: new Date(cachedData.cacheTime).toLocaleTimeString() }, 'WSS: webrtc cached data expired at');
            return;
        }
        // Re-send ice-candidates
        // TODO: maybe rate limit these
        if (cachedData.icecandidates) {
            for (const candidate of cachedData.icecandidates) {
                const size = new Blob([JSON.stringify(candidate)]).size;
                logger.info(`WSS: [cached](${candidate.cmd}) ${candidate.data.sender} -> ${candidate.data.reciever}: (${size} bytes)`);
                ws.send(JSON.stringify(candidate));
            }
        }
        // Re-send offer
        if (cachedData.offer) {
            const offer = cachedData.offer;
            const size = new Blob([JSON.stringify(offer)]).size;
            logger.info(`WSS: [cached](${offer.cmd}) ${offer.data.sender} -> ${offer.data.reciever}: (${size} bytes)`);
            ws.send(JSON.stringify({
                ...offer,
                data: {
                    ...offer.data,
                    ring: false,
                },
            }));
        }
    } finally {
        webrtcCachedData.delete(ws.session.id);
    }
}

/**
 * Iterates through all connected websockets and terminates those that are unresponsive
 * and sends ping to the rest.
 * @param wss WebSocket server instance
 */
function wsHeartbeat(wss: WebSocketServer) {
    wss.clients.forEach((ws: WebSocket) => {
        if (!ws.isAlive) {
            logger.info({ phone_no: ws.session?.phone_no }, 'WSS: websocket is dead. Terminating...');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
    // Clear out cached webrtc data if any
    for (const [key, value] of webrtcCachedData) {
        if (value.cacheTime < Date.now() - webrtcCacheMs) {
            webrtcCachedData.delete(key);
        }
    }
}

/**
 * Sends a DATA PUSH notification through firebase to the reciever, this triggers a call-screen.
 * @param parsedData 
 */
async function sendPushNotificationForCall(parsedData: SocketData) {
    const fcm_token = await getFCMToken(parsedData.data.reciever_id);
    if (!fcm_token) {
        logger.warn({
            receiverId: parsedData.data.reciever_id,
            note: 'cannot send push notification for call',
        }, 'WSS: no FCM token for user');
        return;
    }
    await firebaseMessaging.send({
        token: fcm_token,
        android: {
            priority: 'high',
        },
        data: {
            caller: JSON.stringify({
                id: parsedData.data.sender_id,
                phone_no: parsedData.data.sender,
                pic: `https://robohash.org/${parsedData.data.sender_id}?size=200x200`,
                public_key: '',
                session_key: '',
            }),
        },
    });
}
