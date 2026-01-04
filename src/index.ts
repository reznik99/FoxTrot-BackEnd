import express from 'express';
import passport from 'passport';
import pinoHttp from 'pino-http';
import bodyParser from 'body-parser';
import firebase from 'firebase-admin';

import { InitWebsocketServer } from './sockets';
import { InitMetrics, metricsMiddleware } from './middlware/metrics';
import { logger, httpLoggerConfig } from './middlware/log';
import { InitAuth } from './middlware/auth';
import { CreateRoutes } from './routes';
import { ServerConfig } from './config/envConfig';
import serviceAccount from './config/foxtrot-push-notifications-firebase-adminsdk.json';

if (!ServerConfig.JWT_SECRET) {
    logger.error('JWT Secret not found in env but is required!');
    process.exit(1);
} else if (!ServerConfig.METRICS_PASSWORD) {
    logger.error('Password for /metrics not found in env but is required!');
    process.exit(1);
} else if (!ServerConfig.TURN_SECRET) {
    logger.error('TURN server secret is required!');
    process.exit(1);
}

firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount as firebase.ServiceAccount),
});
export const firebaseMessaging = firebase.messaging();

const app = express();

// Middleware & Logging
app.use(bodyParser.json({ limit: '10mb' }));
app.use(pinoHttp(httpLoggerConfig));
app.use(metricsMiddleware);
app.use(passport.initialize());

// Register metrics, authentication and routes
InitMetrics();
InitAuth(passport);
CreateRoutes(app, passport);

// Start & Listen
const expressServer = app.listen(ServerConfig.PORT, () => {
    logger.info(`FoxTrot Server mode:${ServerConfig.NODE_ENV} listening on ${ServerConfig.PORT}`);
});

InitWebsocketServer(expressServer);
