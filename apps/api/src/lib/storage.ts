/**
 * S3, when it is configured.
 *
 * Renders are reproducible from the document, so a stored preview is a cache and
 * never the source of truth. That is what lets this whole module be optional: with
 * no bucket configured the library falls back to rendering previews on demand,
 * which is slower and completely correct.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION ?? "auto";
const endpoint = process.env.S3_ENDPOINT;

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
    new PutObjectCommand({ Bucket: bucket!, Key: key, Body: body, ContentType: contentType }),
  );
  return key;
}

/** A short-lived URL. Objects stay private; the browser gets a signed link. */
export async function presign(key: string, expiresIn = 3600): Promise<string> {
  if (!client) throw new Error("S3 is not configured");
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket!, Key: key }), { expiresIn });
}
