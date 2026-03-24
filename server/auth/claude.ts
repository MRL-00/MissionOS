import { createOAuthHandler } from "./oauthProvider";

export const handleClaudeAuth = createOAuthHandler({
  callbackPath: "/auth/claude/callback",
  provider: "claude",
  clientIdEnv: "CLAUDE_OAUTH_CLIENT_ID",
  placeholderClientId: "missing-claude-client-id",
  placeholderCode: "mock-claude-code",
});
