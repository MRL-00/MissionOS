import type { ServerResponse } from "node:http";
import { storeToken } from "./storage";

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { Location: location });
  response.end();
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  response.end(JSON.stringify(body));
}

export async function handleCodexAuth(pathname: string, url: URL, response: ServerResponse): Promise<boolean> {
  if (pathname === "/auth/codex/authorize") {
    const redirectTarget = url.searchParams.get("redirect") ?? "http://localhost:5173/";
    const clientId = process.env.CODEX_OAUTH_CLIENT_ID ?? "missing-codex-client-id";
    const state = Buffer.from(JSON.stringify({ redirectTarget, ts: Date.now() })).toString("base64url");

    // Placeholder flow: bounce through the local callback instead of exchanging with a real provider.
    redirect(response, `/auth/codex/callback?code=mock-codex-code&state=${encodeURIComponent(state)}&client_id=${encodeURIComponent(clientId)}`);
    return true;
  }

  if (pathname === "/auth/codex/callback") {
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    if (!code || !stateParam) {
      json(response, 400, { error: "Missing OAuth callback parameters" });
      return true;
    }

    const state = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8")) as { redirectTarget?: string; ts?: number };
    const tokenId = await storeToken({
      provider: "codex",
      code,
      accessToken: `codex-placeholder-token-${Date.now().toString(36)}`,
      clientId: process.env.CODEX_OAUTH_CLIENT_ID ?? url.searchParams.get("client_id") ?? undefined,
      createdAt: Date.now(),
    });
    const redirectTarget = new URL(state.redirectTarget ?? "http://localhost:5173/");
    redirectTarget.searchParams.set("oauth_provider", "codex");
    redirectTarget.searchParams.set("oauth_status", "connected");
    redirectTarget.searchParams.set("token_id", tokenId);
    redirect(response, redirectTarget.toString());
    return true;
  }

  return false;
}
