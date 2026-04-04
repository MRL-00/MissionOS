import "@testing-library/jest-dom/vitest";

Object.defineProperty(globalThis, "__BUILD_DATE__", {
  configurable: true,
  value: "2026.03.29",
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
