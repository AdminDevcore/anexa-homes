import fs from "fs/promises";
import path from "path";

// Storage abstraction with two drivers selected by STORAGE_DRIVER:
//   - "local" (default): writes under ./storage on disk (dev).
//   - "s3": writes to an S3 bucket (production).
// Both expose the same put/get surface so call sites never change.

const DRIVER = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();

// Computed lazily so module-load tracing doesn't see a top-level cwd() call.
function root(): string {
  return path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? "./storage");
}

// --- Local disk driver ---------------------------------------------------

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function putLocal(key: string, data: Buffer): Promise<string> {
  const full = path.join(root(), key);
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, data);
  return key;
}

async function getLocal(key: string): Promise<Buffer> {
  return fs.readFile(path.join(root(), key));
}

export function getLocalPath(key: string): string {
  return path.join(root(), key);
}

// --- S3 driver -----------------------------------------------------------

let s3Client: import("@aws-sdk/client-s3").S3Client | null = null;

async function s3() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  if (!s3Client) {
    // Credentials resolve from the standard AWS provider chain (env vars, IAM role).
    s3Client = new S3Client({ region: process.env.AWS_REGION });
  }
  const bucket = process.env.STORAGE_S3_BUCKET;
  if (!bucket) throw new Error("STORAGE_S3_BUCKET is required when STORAGE_DRIVER=s3");
  return { client: s3Client, bucket };
}

async function putS3(key: string, data: Buffer): Promise<string> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { client, bucket } = await s3();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));
  return key;
}

async function getS3(key: string): Promise<Buffer> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { client, bucket } = await s3();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`S3 object not found: ${key}`);
  return Buffer.from(bytes);
}

// --- Public surface ------------------------------------------------------

export async function putObject(key: string, data: Buffer): Promise<string> {
  return DRIVER === "s3" ? putS3(key, data) : putLocal(key, data);
}

export async function getObject(key: string): Promise<Buffer> {
  return DRIVER === "s3" ? getS3(key) : getLocal(key);
}
