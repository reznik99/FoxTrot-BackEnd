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
import { verifyS3Connection } from './storage';
import serviceAccount from './config/foxtrot-push-notifications-firebase-adminsdk.json';

export let firebaseMessaging: firebase.messaging.Messaging;

async function main() {
    // Validate required environment variables
    if (!ServerConfig.JWT_SECRET) {
        logger.error('JWT Secret not found in env but is required!');
        process.exit(1);
    } else if (!ServerConfig.METRICS_PASSWORD) {
        logger.error('Password for /metrics not found in env but is required!');
        process.exit(1);
    } else if (!ServerConfig.TURN_SECRET) {
        logger.error('TURN server secret is required!');
        process.exit(1);
    } else if (!ServerConfig.S3_BUCKET || !ServerConfig.S3_REGION ||
               !ServerConfig.S3_ACCESS_KEY_ID || !ServerConfig.S3_SECRET_ACCESS_KEY) {
        logger.error('S3 configuration (S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) is required!');
        process.exit(1);
    }

    // Initialize Firebase
    firebase.initializeApp({
        credential: firebase.credential.cert(serviceAccount as firebase.ServiceAccount),
    });
    firebaseMessaging = firebase.messaging();

    // Verify S3 connectivity
    await verifyS3Connection();

    // Create Express app
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
}

main().catch((err) => {
    logger.error(err, 'Fatal error during startup');
    process.exit(1);
});
