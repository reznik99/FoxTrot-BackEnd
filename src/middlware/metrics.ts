import express from 'express'
import promClient from 'prom-client'

export const requestCounter = new promClient.Counter({
    name: "foxtrot_api_requests_total",
    help: "Total number of requests processed by Foxtrot-Backend."
})
export const requestErrorsCounter = new promClient.Counter({
    name: "foxtrot_api_requests_errors_total",
    help: "Total number of failed requests processed by Foxtrot-Backend."
})
export const messagesCounter = new promClient.Counter({
    name: "foxtrot_api_messages_total",
    help: "Total number of messages proxied by Foxtrot-Backend."
})
export const callsCounter = new promClient.Counter({
    name: "foxtrot_api_calls_total",
    help: "Total number of calls proxied by Foxtrot-Backend."
})
export const websocketCounter = new promClient.Gauge({
    name: "foxtrot_websockets_active",
    help: "Total number of calls proxied by Foxtrot-Backend.",
})

// Handle metrics such as requests count and errors count
export const metricsMiddleware: express.Handler = function (req, res, next) {
    requestCounter.inc()
    next() // Pass through middleware
    if (res.statusCode >= 400) {
        requestErrorsCounter.inc()
    }
}

export const InitMetrics = () => {
    promClient.register.registerMetric(requestCounter)
    promClient.register.registerMetric(requestErrorsCounter)
    promClient.register.registerMetric(messagesCounter)
    promClient.register.registerMetric(callsCounter)
    promClient.register.registerMetric(websocketCounter)
}