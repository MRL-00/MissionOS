import { createOAuthHandler } from "./oauthProvider";

export const handleCodexAuth = createOAuthHandler({
  callbackPath: "/auth/codex/callback",
  provider: "codex",
  clientIdEnv: "CODEX_OAUTH_CLIENT_ID",
  placeholderClientId: "missing-codex-client-id",
  placeholderCode: "mock-codex-code",
});
