import express from 'express';
import passport from 'passport';
import morgan from 'morgan';
import bodyParser from 'body-parser';

import { InitWebsocketServer } from './sockets';
import { CreateRoutes } from './routes';
import { InitAuth } from './middlware/auth';
import { CyanColor, ResetColor, YellowColor, log_error, log_info } from './middlware/log';
import { InitMetrics, metricsMiddleware } from './middlware/metrics';
import { PORT, JWT_SECRET, METRICS_PASSWORD } from './config/envConfig';

if (JWT_SECRET === '') {
    log_error('JWT Secret not found in env but is required!');
    process.exit(1);
} else if (METRICS_PASSWORD === '') {
    log_error('Password for /metrics not found in env but is required!');
    process.exit(1);
}

const app = express();

// Middleware & Logging
app.use(bodyParser.json({ limit: '10mb' }));
app.use(morgan(`${CyanColor}[INFO] :date ${ResetColor}${YellowColor}:method${ResetColor} ${CyanColor}:url${ResetColor} :status :res[content-length]bytes in :response-time ms`, { skip: (req) => req.path === '/foxtrot-api/metrics' }));
app.use(metricsMiddleware);
app.use(passport.initialize());

// Register metrics, authentication and routes
InitMetrics();
InitAuth(passport);
CreateRoutes(app, passport);

// Start & Listen
const expressServer = app.listen(PORT, () => {
    log_info(`FoxTrot Server mode:${process.env.NODE_ENV} listening on ${PORT}`);
});

InitWebsocketServer(expressServer);
