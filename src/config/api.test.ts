import { afterEach, describe, expect, it } from "vitest";
import { clearApiBaseOverride, getApiBase, getApiBaseLabel, getWsUrl, setApiBaseOverride } from "./api";

function setLocation(url: string): void {
  const nextUrl = new URL(url);
  vi.spyOn(window, "location", "get").mockReturnValue({
    ...window.location,
    href: nextUrl.href,
    hostname: nextUrl.hostname,
    origin: nextUrl.origin,
    protocol: nextUrl.protocol,
  } as Location);
}

describe("API base configuration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearApiBaseOverride();
  });

  it("uses the current browser origin by default for same-origin production serving", () => {
    setLocation("http://127.0.0.1:4301/settings");

    expect(getApiBase()).toBe("http://127.0.0.1:4301");
    expect(getApiBaseLabel()).toBe("127.0.0.1:4301");
    expect(getWsUrl()).toBe("ws://127.0.0.1:4301");
  });

  it("keeps explicit host overrides on the default API port", () => {
    setLocation("https://missionos.local/settings?officeApi=api.internal");

    expect(getApiBase()).toBe("https://api.internal:3001");
    expect(getWsUrl()).toBe("wss://api.internal:3001");
  });

  it("persists explicit API overrides", () => {
    setLocation("http://localhost:5173/settings");

    expect(setApiBaseOverride("http://localhost:4301")).toBe("http://localhost:4301");
    expect(getApiBase()).toBe("http://localhost:4301");
  });
});
