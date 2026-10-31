import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let client = null;

export function r2Configured() {
  return Boolean(
    env.R2_ACCESS_KEY_ID
    && env.R2_SECRET_ACCESS_KEY
    && env.R2_BUCKET_NAME
    && env.R2_ENDPOINT,
  );
}

function getClient() {
  if (!r2Configured()) {
    throw new Error('R2 is not configured (set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT)');
  }
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export function safeJid(jid) {
  return String(jid || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function sanitizeName(filename) {
  return String(filename || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'file';
}

export function makeObjectKey(jid, filename) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safeJid(jid)}/${stamp}/${Date.now()}-${sanitizeName(filename)}`;
}

export function r2PublicUrl(key) {
  if (!key) return null;
  return env.R2_PUBLIC_URL ? `${env.R2_PUBLIC_URL}/${key}` : null;
}

export async function uploadR2Object({ key, body, contentType }) {
  const s3 = getClient();
  await s3.send(new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
  }));
  logger.info({ key, bytes: Buffer.byteLength(body) }, 'uploaded object to R2');
  return { key, url: r2PublicUrl(key) };
}

export async function uploadR2ObjectStream({ key, stream, contentType, size }) {
  const s3 = getClient();
  await s3.send(new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    Body: stream,
    ContentType: contentType || 'application/octet-stream',
    ContentLength: size || undefined,
  }));
  logger.info({ key, bytes: size || null }, 'uploaded object stream to R2');
  return { key, url: r2PublicUrl(key) };
}

export async function presignR2Url(key, ttlSeconds = 3600) {
  const s3 = getClient();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }), {
    expiresIn: ttlSeconds,
  });
}

export async function resolveFileUrl(record) {
  if (!record) return null;
  if (record.url) return record.url;
  if (record.key) return presignR2Url(record.key);
  return null;
}

export async function deleteR2Object(key) {
  if (!key) return;
  const s3 = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
  logger.info({ key }, 'deleted object from R2');
}
