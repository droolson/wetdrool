import { IndexerPayloadError } from './contract.js';

export const MAX_INDEXER_JSON_BYTES = 6 * 1024 * 1024;

export function endpointFor(base: URL, pathname: string): URL {
  const normalizedBase = new URL(base);
  if (!normalizedBase.pathname.endsWith('/')) normalizedBase.pathname += '/';
  return new URL(pathname, normalizedBase);
}

export async function readIndexerJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new IndexerPayloadError('The indexer did not return an application/json response.');
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/u.test(normalizedLength)) {
      await cancelResponseBody(response.body);
      throw new IndexerPayloadError('The indexer returned an invalid Content-Length header.');
    }
    const canonicalLength = normalizedLength.replace(/^0+/u, '') || '0';
    const maximumLength = String(MAX_INDEXER_JSON_BYTES);
    if (
      canonicalLength.length > maximumLength.length ||
      (canonicalLength.length === maximumLength.length && canonicalLength > maximumLength)
    ) {
      await cancelResponseBody(response.body);
      throw new IndexerPayloadError('The indexer response exceeded the JSON byte budget.');
    }
  }
  if (response.body === null) {
    throw new IndexerPayloadError('The indexer returned an empty JSON response.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > MAX_INDEXER_JSON_BYTES) {
        await cancelResponseReader(reader);
        throw new IndexerPayloadError('The indexer response exceeded the JSON byte budget.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new IndexerPayloadError('The indexer returned invalid UTF-8.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new IndexerPayloadError('The indexer returned invalid JSON.');
  }
}

async function cancelResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Cancellation is best effort after the response has already been rejected.
  }
}

async function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best effort after the response has already been rejected.
  }
}
