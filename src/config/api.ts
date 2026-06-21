const API_BASE_STORAGE_KEY = "office.api-base";
const API_BASE_QUERY_KEY = "officeApi";
const DEFAULT_API_PORT = 3001;

function getHost(): string {
  return window.location.hostname || "localhost";
}

function getDefaultProtocol(): string {
  return window.location.protocol === "https:" ? "https:" : "http:";
}

function normalizeBaseUrl(rawValue: string, defaultPort?: number): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const hasProtocol = /^[a-z]+:\/\//i.test(trimmed);
  const candidate = hasProtocol ? trimmed : `${getDefaultProtocol()}//${trimmed}`;

  try {
    const url = new URL(candidate);
    if (!hasProtocol && defaultPort && !url.port) {
      url.port = String(defaultPort);
    }
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getStoredOverride(): string | null {
  try {
    return normalizeBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY) ?? "", DEFAULT_API_PORT);
  } catch {
    return null;
  }
}

function getQueryOverride(): string | null {
  try {
    const url = new URL(window.location.href);
    return normalizeBaseUrl(url.searchParams.get(API_BASE_QUERY_KEY) ?? "", DEFAULT_API_PORT);
  } catch {
    return null;
  }
}

function getDefaultApiBase(): string {
  return window.location.origin || `${getDefaultProtocol()}//${getHost()}`;
}

export function getApiBase(): string {
  return getQueryOverride() ?? getStoredOverride() ?? getDefaultApiBase();
}

export function getApiBaseLabel(): string {
  try {
    const url = new URL(getApiBase());
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return getApiBase();
  }
}

export function setApiBaseOverride(rawValue: string): string {
  const normalized = normalizeBaseUrl(rawValue, DEFAULT_API_PORT);
  if (!normalized) {
    throw new Error("Enter a valid MissionOS API URL or host");
  }

  window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
  return normalized;
}

export function clearApiBaseOverride(): void {
  window.localStorage.removeItem(API_BASE_STORAGE_KEY);
}

export function getWsUrl(): string {
  const url = new URL(getApiBase());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "");
}
