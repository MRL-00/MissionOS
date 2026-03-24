import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_HEADERS, MAX_BODY_BYTES, RequestBodyError } from "./types";

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, DEFAULT_HEADERS);
  response.end(JSON.stringify(body));
}

export async function readJson<T>(request: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new RequestBodyError("Request body too large");
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new RequestBodyError("Invalid JSON payload");
  }
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
