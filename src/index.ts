import express from 'express';
import passport from 'passport';
import pinoHttp from 'pino-http';
import bodyParser from 'body-parser';
import firebase from 'firebase-admin';

import { InitWebsocketServer } from './sockets';
import { CreateRoutes } from './routes';
import { InitAuth } from './middlware/auth';
import { InitMetrics, metricsMiddleware } from './middlware/metrics';
import { PORT, JWT_SECRET, METRICS_PASSWORD } from './config/envConfig';
import serviceAccount from './config/foxtrot-push-notifications-firebase-adminsdk.json';
import logger from './middlware/log';

if (JWT_SECRET === '') {
    logger.error('JWT Secret not found in env but is required!');
    process.exit(1);
} else if (METRICS_PASSWORD === '') {
    logger.error('Password for /metrics not found in env but is required!');
    process.exit(1);
}

firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount as firebase.ServiceAccount),
});
export const firebaseMessaging = firebase.messaging();

const app = express();

// Middleware & Logging
app.use(bodyParser.json({ limit: '10mb' }));
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware);
app.use(passport.initialize());

// Register metrics, authentication and routes
InitMetrics();
InitAuth(passport);
CreateRoutes(app, passport);

// Start & Listen
const expressServer = app.listen(PORT, () => {
    logger.info(`FoxTrot Server mode:${process.env.NODE_ENV} listening on ${PORT}`);
});

InitWebsocketServer(expressServer);
