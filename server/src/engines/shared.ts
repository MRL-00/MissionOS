import { spawn, type ChildProcess } from "node:child_process";
import type { EngineTestResult } from "./types.js";

const trackedChildren = new Set<ChildProcess>();
let shutdownHandlersRegistered = false;

function terminateTrackedChildren(): void {
  for (const child of trackedChildren) {
    if (child.exitCode !== null || child.killed) {
      trackedChildren.delete(child);
      continue;
    }

    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
    }, 3_000);
  }
}

function ensureShutdownHandlers(): void {
  if (shutdownHandlersRegistered) {
    return;
  }

  shutdownHandlersRegistered = true;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, terminateTrackedChildren);
  }
  process.once("exit", terminateTrackedChildren);
}

export function trackChildProcess(child: ChildProcess): () => void {
  ensureShutdownHandlers();
  trackedChildren.add(child);

  return () => {
    trackedChildren.delete(child);
  };
}

export async function* streamProcess(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; cwd?: string; stdin?: string },
): AsyncGenerator<string> {
  const child = spawn(command, args, {
    env: options?.env,
    cwd: options?.cwd,
    stdio: [options?.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
  });

  if (options?.stdin !== undefined && child.stdin) {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }

  const untrackChild = trackChildProcess(child);

  const queue: string[] = [];
  const waiters: Array<() => void> = [];
  let done = false;
  let failure: Error | null = null;

  const release = () => {
    const waiter = waiters.shift();
    waiter?.();
  };

  const push = (chunk: string) => {
    queue.push(chunk);
    release();
  };

  child.stdout?.on("data", (data) => push(String(data)));
  child.stderr?.on("data", (data) => push(String(data)));
  child.on("error", (error) => {
    failure = error;
    done = true;
    release();
  });
  child.on("close", (code) => {
    untrackChild();
    if (code !== 0 && !failure) {
      failure = new Error(`${command} exited with code ${code ?? -1}`);
    }
    done = true;
    release();
  });

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => waiters.push(resolve));
      continue;
    }

    const next = queue.shift();
    if (next) {
      yield next;
    }
  }

  if (failure) {
    throw failure;
  }
}

export async function testCommand(command: string, args: string[]): Promise<{ ok: boolean; message: string }> {
  try {
    let output = "";
    for await (const chunk of streamProcess(command, args)) {
      output += chunk;
    }
    return {
      ok: true,
      message: output.trim() || `${command} responded successfully.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Command failed.",
    };
  }
}

function extractSemver(text: string): string | undefined {
  const match = text.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/u);
  return match?.[0];
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split(/[.+-]/u).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(/[.+-]/u).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

async function fetchLatestNpmVersion(packageName: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);

  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return undefined;
    }

    const payload = await response.json() as { version?: unknown };
    return typeof payload.version === "string" && payload.version.trim() ? payload.version.trim() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testCliCommand(
  command: string,
  args: string[],
  options: { label: string; latestPackageName?: string; upgradeCommand?: string },
): Promise<EngineTestResult> {
  const result = await testCommand(command, args);
  if (!result.ok) {
    return result;
  }

  const currentVersion = extractSemver(result.message);
  const latestVersion = options.latestPackageName ? await fetchLatestNpmVersion(options.latestPackageName) : undefined;
  const updateAvailable = Boolean(currentVersion && latestVersion && compareSemver(latestVersion, currentVersion) > 0);

  return {
    ok: true,
    message: currentVersion ? `${options.label} ${currentVersion}` : result.message,
    ...(currentVersion ? { currentVersion } : {}),
    ...(latestVersion ? { latestVersion } : {}),
    ...(currentVersion && latestVersion ? { updateAvailable } : {}),
    ...(updateAvailable && options.upgradeCommand ? { upgradeCommand: options.upgradeCommand } : {}),
  };
}

function extractHttpVersionMetadata(text: string): Pick<EngineTestResult, "currentVersion" | "latestVersion" | "updateAvailable"> {
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const currentVersion =
      typeof payload.currentVersion === "string"
        ? payload.currentVersion
        : typeof payload.version === "string"
          ? payload.version
          : undefined;
    const latestVersion = typeof payload.latestVersion === "string" ? payload.latestVersion : undefined;
    const updateAvailable =
      typeof payload.updateAvailable === "boolean"
        ? payload.updateAvailable
        : Boolean(currentVersion && latestVersion && compareSemver(latestVersion, currentVersion) > 0);
    return {
      ...(currentVersion ? { currentVersion } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      ...(currentVersion && latestVersion ? { updateAvailable } : {}),
    };
  } catch {
    return {};
  }
}

export async function httpHealthcheck(
  url: string,
  init?: RequestInit,
): Promise<EngineTestResult> {
  try {
    const startedAt = Date.now();
    const response = await fetch(url, init);
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        message: `${response.status} ${response.statusText}${text ? `: ${text.slice(0, 160)}` : ""}`,
      };
    }

    const ms = Date.now() - startedAt;
    const versionMetadata = extractHttpVersionMetadata(text);
    return {
      ok: true,
      message: text.trim() || `OK in ${ms}ms`,
      ...versionMetadata,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Request failed.",
    };
  }
}

export async function* httpRun(url: string, init: RequestInit): AsyncGenerator<string> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  yield text;
}
