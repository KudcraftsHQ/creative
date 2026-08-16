/**
 * S3-compatible object storage — in production, Cloudflare R2.
 *
 * The bucket has a public custom domain, so an uploaded asset is referenced by a
 * plain URL on that domain and served by Cloudflare rather than by this process.
 * That matters more than it sounds: a document is portable, its image layers hold
 * URLs, and those URLs are fetched by whatever renders the document — the worker,
 * a laptop running `creative render`, this container. Pointing them at a CDN
 * instead of at the API means rendering a hundred listings does not become a
 * hundred requests through the app.
 *
 * All of it is optional. With no bucket configured, assets fall back to bytes in
 * Postgres and everything above still works.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION ?? "auto";
const endpoint = process.env.S3_ENDPOINT;

/** Public base URL of the bucket, if it has one. No trailing slash. */
const publicBase = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");

export const storageEnabled = Boolean(
  bucket && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
);

const client = storageEnabled
  ? new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    })
  : null;

export async function put(key: string, body: Buffer, contentType: string): Promise<string> {
  if (!client) throw new Error("S3 is not configured");
  await client.send(
    new PutObjectCommand({
      Bucket: bucket!,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Assets are immutable — the key carries a fresh id every upload — so this
      // is safe, and it keeps re-renders off the origin entirely.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return key;
}

export async function remove(key: string): Promise<void> {
  if (!client) return;
  await client.send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
}

/** The public URL for a key, when the bucket is served on a domain. */
export function publicUrlFor(key: string): string | null {
  return publicBase ? `${publicBase}/${key}` : null;
}

/** A short-lived URL, for a bucket with no public domain. */
export async function presign(key: string, expiresIn = 3600): Promise<string> {
  if (!client) throw new Error("S3 is not configured");
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket!, Key: key }), { expiresIn });
}
