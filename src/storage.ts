import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

import { ServerConfig } from './config/envConfig';
import { logger } from './middlware/log';

export const ALLOWED_MEDIA_TYPES = [
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm',
    'audio/aac', 'audio/mp4', 'audio/mpeg',
];

export const s3Client = new S3Client({
    region: ServerConfig.S3_REGION,
    credentials: {
        accessKeyId: ServerConfig.S3_ACCESS_KEY_ID,
        secretAccessKey: ServerConfig.S3_SECRET_ACCESS_KEY,
    },
});

/** Verifies S3 connectivity by checking the bucket exists and is accessible */
export async function verifyS3Connection(): Promise<void> {
    const command = new HeadBucketCommand({ Bucket: ServerConfig.S3_BUCKET });
    await s3Client.send(command);
    logger.info(`S3 bucket '${ServerConfig.S3_BUCKET}' in '${ServerConfig.S3_REGION}' is accessible`);
}

/** Generates a pre-signed upload URL and S3 object key for the given content type */
export async function generateUploadUrl(userId: number, contentType: string): Promise<{ uploadUrl: string; objectKey: string }> {
    const extension = contentType.split('/')[1] || 'bin';
    const objectKey = `media/${userId}/${randomUUID()}.${extension}`;

    const command = new PutObjectCommand({
        Bucket: ServerConfig.S3_BUCKET,
        Key: objectKey,
        ContentType: 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: ServerConfig.S3_UPLOAD_EXPIRY,
    });

    return { uploadUrl, objectKey };
}

/** Generates a pre-signed download URL for the given S3 object key */
export async function generateDownloadUrl(objectKey: string): Promise<{ downloadUrl: string }> {
    const command = new GetObjectCommand({
        Bucket: ServerConfig.S3_BUCKET,
        Key: objectKey,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: ServerConfig.S3_DOWNLOAD_EXPIRY,
    });

    return { downloadUrl };
}
