declare const console: {
  log(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
};

declare const process: {
  exitCode?: number | undefined;
};

declare function fetch(
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  },
): Promise<{
  ok: boolean;
  status: number;
}>;

declare namespace NodeJS {
  interface Timer {}
}

declare class URL {
  constructor(input: string, base?: string);
  pathname: string;
}

declare const setTimeout: (callback: () => void, ms: number) => NodeJS.Timer;

interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
}

declare const Buffer: {
  from(input: string | Uint8Array): Buffer;
  concat(list: readonly Buffer[]): Buffer;
  isBuffer(input: unknown): input is Buffer;
};

declare module "node:http" {
  export interface IncomingMessage extends AsyncIterable<Buffer | string> {
    method?: string | undefined;
    url?: string | undefined;
    headers: Record<string, string | undefined>;
  }

  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    end(body?: string): void;
  }

  export interface Server {
    listen(port: number, callback?: () => void): void;
  }

  export function createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  ): Server;
}

declare module "ws" {
  import type { Server } from "node:http";

  export interface WebSocketLike {
    OPEN: number;
    readyState: number;
    send(data: string): void;
  }

  export class WebSocketServer {
    clients: Set<WebSocketLike>;
    constructor(options: { server: Server });
    on(event: "connection", listener: (socket: WebSocketLike) => void): this;
  }
}
