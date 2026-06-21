import type { NextFunction, Request, Response } from "express";

export const securityHeaders = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "no-referrer"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
] as const;

export function applySecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  for (const [name, value] of securityHeaders) {
    res.setHeader(name, value);
  }
  next();
}
