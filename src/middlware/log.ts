import pino from 'pino';
import { Options } from 'pino-http';

const logger = pino({
    level: process.env.LOG_LEVEL || 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            singleLine: true,
            ignore: 'req,res,hostname,pid,reqId,responseTime',
        },
    },
});

const httpLoggerConfig: Options = {
    logger,
    autoLogging: {
        ignore: (req) => req.url === '/foxtrot-api/metrics',
    },
    quietReqLogger: true,
    quietResLogger: true,
    customSuccessMessage(req, res, responseTime) {
        const contentLength = res.getHeader('Content-Length') || 0;
        return `${req.method} ${req.url} ${res.statusCode} ${contentLength}bytes in ${responseTime}ms`;
    },
    customErrorMessage(req, res, err) {
        return `${req.method} ${req.url} errored with ${res.statusCode}: ${err.message}`;
    },
};

export {
    logger,
    httpLoggerConfig,
};
