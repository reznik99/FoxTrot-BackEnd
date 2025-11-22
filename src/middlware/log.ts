import pino from 'pino';

const logger = pino({
    level: process.env.LOG_LEVEL || 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: true,
            singleLine: false,
        },
    },
});

const httpLoggerConfig = {
    logger,
    autoLogging: true,

    serializers: {
        req(req) {
            return {
                method: req.method,
                url: req.url,
            };
        },
        res(res) {
            return {
                statusCode: res.statusCode,
                responseTime: res.responseTime, // set automatically by pino-http
            };
        },
    },

    customSuccessMessage(req, res) {
        return `${req.method} ${req.url} ${res.statusCode} in ${res.responseTime}ms`;
    },
    customErrorMessage(req, res, err) {
        return `${req.method} ${req.url} errored with ${res.statusCode}: ${err.message}`;
    },
};

export {
    logger,
    httpLoggerConfig,
};
