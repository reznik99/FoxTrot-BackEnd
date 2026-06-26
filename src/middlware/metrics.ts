import express from 'express';
import promClient from 'prom-client';

const metricsPath = '/foxtrot-api/metrics';
const unmatchedPath = 'unmatched';

export const requestCounter = new promClient.Counter({
    name: 'foxtrot_api_requests_total',
    help: 'Total number of requests processed by Foxtrot-Backend.',
    labelNames: ['path'],
});
export const requestErrorsCounter = new promClient.Counter({
    name: 'foxtrot_api_requests_errors_total',
    help: 'Total number of failed requests processed by Foxtrot-Backend.',
    labelNames: ['path'],
});
export const messagesCounter = new promClient.Counter({
    name: 'foxtrot_api_messages_total',
    help: 'Total number of messages proxied by Foxtrot-Backend.',
});
export const callsCounter = new promClient.Counter({
    name: 'foxtrot_api_calls_total',
    help: 'Total number of calls proxied by Foxtrot-Backend.',
});
export const websocketCounter = new promClient.Gauge({
    name: 'foxtrot_websockets_active',
    help: 'Total number of websockets handled by Foxtrot-Backend.',
});

function getPathLabel(req: express.Request) {
    const routePath = req.route?.path;
    if (typeof routePath === 'string') return routePath;
    return unmatchedPath;
}

// Handle metrics such as requests count and errors count
export const metricsMiddleware: express.Handler = function (req, res, next) {
    if (req.path === metricsPath) {
        next();
        return;
    }

    res.on('finish', () => {
        const pathLabel = getPathLabel(req);
        requestCounter.labels(pathLabel).inc();
        if (res.statusCode >= 400) {
            requestErrorsCounter.labels(pathLabel).inc();
        }
    });
    next();
};

