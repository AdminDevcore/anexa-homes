import fs from "fs/promises";
import path from "path";

// Storage abstraction with three drivers selected by STORAGE_DRIVER:
//   - "local" (default): writes under ./storage on disk (dev).
//   - "s3": writes to an S3 / S3-compatible bucket (R2, Supabase, B2…).
//   - "db": stores bytes in Postgres (no external account needed). Fine for
//     PDFs/docs and modest photo volume; move to "s3" before heavy media use.
// All expose the same put/get surface so call sites never change.

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
    // A custom endpoint targets S3-compatible stores (Cloudflare R2, Backblaze
    // B2, MinIO). R2 needs region "auto" and path-style addressing. Credentials
    // resolve from the standard AWS provider chain (AWS_ACCESS_KEY_ID /
    // AWS_SECRET_ACCESS_KEY env vars, or an IAM role on AWS).
    const endpoint = process.env.STORAGE_S3_ENDPOINT ?? process.env.AWS_ENDPOINT_URL_S3;
    s3Client = new S3Client({
      region: process.env.AWS_REGION ?? (endpoint ? "auto" : undefined),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
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

// --- Database driver (Postgres bytea via Prisma) -------------------------

async function putDb(key: string, data: Buffer): Promise<string> {
  const { prisma } = await import("@/server/db/client");
  // Prisma's Bytes field wants a Uint8Array backed by a plain ArrayBuffer.
  const bytes = new Uint8Array(data);
  await prisma.storedFile.upsert({
    where: { key },
    create: { key, data: bytes, size: bytes.length },
    update: { data: bytes, size: bytes.length },
  });
  return key;
}

async function getDb(key: string): Promise<Buffer> {
  const { prisma } = await import("@/server/db/client");
  const row = await prisma.storedFile.findUnique({ where: { key }, select: { data: true } });
  if (!row) throw new Error(`File not found: ${key}`);
  return Buffer.from(row.data);
}

// --- Public surface ------------------------------------------------------

export async function putObject(key: string, data: Buffer): Promise<string> {
  if (DRIVER === "s3") return putS3(key, data);
  if (DRIVER === "db") return putDb(key, data);
  return putLocal(key, data);
}

export async function getObject(key: string): Promise<Buffer> {
  if (DRIVER === "s3") return getS3(key);
  if (DRIVER === "db") return getDb(key);
  return getLocal(key);
}

/**
 * Is the stored object actually there?
 *
 * A FileAsset row and the bytes it points at are two different things, and they
 * can drift: a bucket lifecycle rule expires an object, a restore brings the
 * database back without the storage, a local dev tree gets wiped. Asking the
 * row alone would say "yes" and then hand a customer a broken image.
 *
 * Metadata-only on every driver — HEAD on S3, a stat on disk, a size lookup in
 * Postgres — so checking is cheap enough to do before every proposal render.
 * Never throws: anything unexpected reads as "not available", because the
 * caller's job is to decide whether to show a section, not to handle an outage.
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    if (DRIVER === "s3") {
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const { client, bucket } = await s3();
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    }
    if (DRIVER === "db") {
      const { prisma } = await import("@/server/db/client");
      const row = await prisma.storedFile.findUnique({ where: { key }, select: { size: true } });
      return !!row && row.size > 0;
    }
    const stat = await fs.stat(path.join(root(), key));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}
