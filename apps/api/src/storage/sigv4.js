import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4, query-string ("presigned URL") form, for S3-compatible storage.
 * Implemented with node:crypto so the API needs no storage SDK. Checked against the example
 * in the S3 documentation (see test/storage.test.js).
 */

const hmac = (key, value) => createHmac('sha256', key).update(value, 'utf8').digest();
const sha256Hex = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

/** RFC 3986 encoding as S3 expects it (encodeURIComponent leaves !'()* unescaped). */
export const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Encodes an object key for a URL path: each segment is encoded, slashes are kept. */
export const encodeKeyPath = (key) => key.split('/').map(encodeRfc3986).join('/');

const amzDate = (date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

/**
 * Returns a presigned URL.
 * `url`: the object URL without query. `headers`: headers the caller MUST send unchanged
 * (they are part of the signature), e.g. content-type and content-length for uploads.
 */
export function presignUrl({
  method,
  url,
  region,
  accessKeyId,
  secretAccessKey,
  expiresInSeconds,
  headers = {},
  now = new Date(),
  service = 's3',
}) {
  const target = new URL(url);
  const timestamp = amzDate(now);
  const day = timestamp.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;

  const signed = { host: target.host };
  for (const [name, value] of Object.entries(headers)) {
    signed[name.toLowerCase()] = String(value).trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(signed).sort();
  const signedHeaders = names.join(';');

  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`)
    .join('&');

  const canonicalRequest = [
    method.toUpperCase(),
    target.pathname,
    canonicalQuery,
    ...names.map((name) => `${name}:${signed[name]}`),
    '',
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256Hex(canonicalRequest)].join(
    '\n',
  );
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return `${target.origin}${target.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
