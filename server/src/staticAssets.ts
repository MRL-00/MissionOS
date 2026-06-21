import type { Response } from "express";

export const CLIENT_INDEX_CACHE_CONTROL = "no-cache, max-age=0, must-revalidate";

export function setStaticAssetHeaders(res: Response, filePath: string): void {
  if (filePath.endsWith("index.html")) {
    res.setHeader("Cache-Control", CLIENT_INDEX_CACHE_CONTROL);
  }
}

export function sendClientIndex(res: Response, indexPath: string): void {
  res.setHeader("Cache-Control", CLIENT_INDEX_CACHE_CONTROL);
  res.sendFile(indexPath);
}
