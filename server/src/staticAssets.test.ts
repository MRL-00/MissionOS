import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";
import { CLIENT_INDEX_CACHE_CONTROL, sendClientIndex, setStaticAssetHeaders } from "./staticAssets.js";

function makeResponse() {
  const headers = new Map<string, string>();
  const files: string[] = [];
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    sendFile(filePath: string) {
      files.push(filePath);
    },
  } as Response;
  return { headers, files, response };
}

test("setStaticAssetHeaders forces html shell revalidation only", () => {
  const html = makeResponse();
  setStaticAssetHeaders(html.response, "/app/dist/index.html");
  assert.equal(html.headers.get("Cache-Control"), CLIENT_INDEX_CACHE_CONTROL);

  const script = makeResponse();
  setStaticAssetHeaders(script.response, "/app/dist/assets/index-abc123.js");
  assert.equal(script.headers.has("Cache-Control"), false);
});

test("sendClientIndex sets shell cache policy before sending the file", () => {
  const { headers, files, response } = makeResponse();
  sendClientIndex(response, "/app/dist/index.html");
  assert.equal(headers.get("Cache-Control"), CLIENT_INDEX_CACHE_CONTROL);
  assert.deepEqual(files, ["/app/dist/index.html"]);
});
