import { createReadStream } from 'node:fs';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

let client: S3Client | undefined;

function config() {
  const values = {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  };
  if (!values.endpoint || !values.bucket || !values.accessKeyId || !values.secretAccessKey) throw new Error('S3 storage is not fully configured.');
  return { endpoint: values.endpoint, region: values.region, bucket: values.bucket, accessKeyId: values.accessKeyId, secretAccessKey: values.secretAccessKey };
}

function getClient() {
  if (!client) {
    const values = config();
    client = new S3Client({
      endpoint: values.endpoint,
      region: values.region,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId: values.accessKeyId, secretAccessKey: values.secretAccessKey },
    });
  }
  return client;
}

export function usesS3() {
  return (process.env.STORAGE_DRIVER || 'local').toLowerCase() === 's3';
}

export type StorageHealth = {
  driver: string;
  state: 'ok' | 'unavailable' | 'skipped';
};

export async function checkStorageHealth(): Promise<StorageHealth> {
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  if (driver !== 's3') return { driver, state: 'skipped' };
  try {
    const values = config();
    await getClient().send(new HeadBucketCommand({ Bucket: values.bucket }));
    return { driver, state: 'ok' };
  } catch {
    return { driver, state: 'unavailable' };
  }
}

export async function putStorageObject(key: string, body: Uint8Array, contentType: string) {
  if (!usesS3()) return;
  const values = config();
  await getClient().send(new PutObjectCommand({ Bucket: values.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function putStorageFile(key: string, filePath: string, contentType: string, metadata: Record<string, string> = {}) {
  if (!usesS3()) return;
  const values = config();
  await getClient().send(new PutObjectCommand({
    Bucket: values.bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentType: contentType,
    Metadata: metadata,
  }));
}

export async function getStorageObject(key: string) {
  if (!usesS3()) return null;
  const values = config();
  const result = await getClient().send(new GetObjectCommand({ Bucket: values.bucket, Key: key }));
  if (!result.Body) return null;
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deleteStorageObject(key: string) {
  if (!usesS3()) return;
  const values = config();
  await getClient().send(new DeleteObjectCommand({ Bucket: values.bucket, Key: key }));
}
