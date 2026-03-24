import type { ServerResponse } from "node:http";
import { storeToken } from "./storage";

interface OAuthState {
  redirectTarget?: string;
  ts?: number;
}

interface OAuthProviderOptions {
  callbackPath: string;
  provider: "claude" | "codex";
  clientIdEnv: string;
  placeholderClientId: string;
  placeholderCode: string;
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { Location: location });
  response.end();
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function parseState(stateParam: string): OAuthState | null {
  try {
    return JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return null;
  }
}

export function createOAuthHandler({
  callbackPath,
  provider,
  clientIdEnv,
  placeholderClientId,
  placeholderCode,
}: OAuthProviderOptions) {
  return async function handleOAuth(pathname: string, url: URL, response: ServerResponse): Promise<boolean> {
    if (pathname === `/auth/${provider}/authorize`) {
      const redirectTarget = url.searchParams.get("redirect") ?? "http://localhost:5173/";
      const clientId = process.env[clientIdEnv] ?? placeholderClientId;
      const state = Buffer.from(JSON.stringify({ redirectTarget, ts: Date.now() })).toString("base64url");

      // Placeholder flow: bounce through the local callback instead of exchanging with a real provider.
      redirect(
        response,
        `${callbackPath}?code=${encodeURIComponent(placeholderCode)}&state=${encodeURIComponent(state)}&client_id=${encodeURIComponent(clientId)}`,
      );
      return true;
    }

    if (pathname === callbackPath) {
      const code = url.searchParams.get("code");
      const stateParam = url.searchParams.get("state");
      if (!code || !stateParam) {
        json(response, 400, { error: "Missing OAuth callback parameters" });
        return true;
      }

      const state = parseState(stateParam);
      if (!state) {
        json(response, 400, { error: "Invalid OAuth state" });
        return true;
      }

      const tokenId = await storeToken({
        provider,
        code,
        accessToken: `${provider}-placeholder-token-${Date.now().toString(36)}`,
        clientId: process.env[clientIdEnv] ?? url.searchParams.get("client_id") ?? undefined,
        createdAt: Date.now(),
      });
      const redirectTarget = new URL(state.redirectTarget ?? "http://localhost:5173/");
      redirectTarget.searchParams.set("oauth_provider", provider);
      redirectTarget.searchParams.set("oauth_status", "connected");
      redirectTarget.searchParams.set("token_id", tokenId);
      redirect(response, redirectTarget.toString());
      return true;
    }

    return false;
  };
}
