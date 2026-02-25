import path from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
});


const ServerConfig = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: parseInt(process.env.PORT || '1234'),
    // TODO: Autogenerate this!
    JWT_SECRET: process.env.JWT_SECRET || '',
    METRICS_PASSWORD: process.env.METRICS_PASSWORD || '',
    // TURN enviroment variables for WebRTC Call Proxying in case Peer-To-Peer fails (CGNAT or Symmetric NAT)
    TURN_SECRET: process.env.TURN_SECRET || '',
    TURN_TTL: Number(process.env.TURN_TTL || 3600),
    // S3 environment variables for media uploads (images, video, audio)
    S3_BUCKET: process.env.S3_BUCKET || '',
    S3_REGION: process.env.S3_REGION || '',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || '',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || '',
    S3_UPLOAD_EXPIRY: Number(process.env.S3_UPLOAD_EXPIRY || 300),
    S3_DOWNLOAD_EXPIRY: Number(process.env.S3_DOWNLOAD_EXPIRY || 3600),
};

export {
    ServerConfig,
    pool,
};
