import path from 'path';
import { Pool } from 'pg';

require('dotenv').config({ path: path.join(__dirname, '.env') });

export const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "5432"),
});

export const JWT_SECRET = process.env.JWT_SECRET || ""
export const METRICS_PASSWORD = process.env.METRICS_PASSWORD || ""
export const PORT = parseInt(process.env.PORT || "1234")
