import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredOAuthToken {
  provider: "claude" | "codex";
  code: string;
  accessToken: string;
  clientId?: string | undefined;
  createdAt: number;
}

interface TokenFile {
  tokens: Record<string, StoredOAuthToken>;
}

const dataDir = path.resolve(process.cwd(), "data");
const tokenFilePath = path.join(dataDir, "tokens.json");

async function ensureDataDir(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
}

export async function readTokens(): Promise<TokenFile> {
  await ensureDataDir();

  try {
    const raw = await readFile(tokenFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TokenFile>;
    return {
      tokens: parsed.tokens ?? {},
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { tokens: {} };
    }
    throw error;
  }
}

export async function writeTokens(data: TokenFile): Promise<void> {
  await ensureDataDir();
  await writeFile(tokenFilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function storeToken(token: StoredOAuthToken): Promise<string> {
  const data = await readTokens();
  const tokenId = `${token.provider}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  data.tokens[tokenId] = token;
  await writeTokens(data);
  return tokenId;
}
