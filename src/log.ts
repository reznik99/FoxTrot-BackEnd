

export function log_error(message: string) {
    console.error(`${new Date().toUTCString()}`, message)
}

export function log_warning(message: string) {
    console.warn(`${new Date().toUTCString()}`, message)
}

export function log_info(message: string) {
    console.info(`${new Date().toUTCString()}`, message)
}