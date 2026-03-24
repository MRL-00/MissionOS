/** Derive API base URLs from the current browser location so the app works over Tailscale / LAN. */
function getHost(): string {
  return window.location.hostname || "localhost";
}

export function getApiBase(): string {
  return `http://${getHost()}:3001`;
}

export function getWsUrl(): string {
  return `ws://${getHost()}:3001`;
}
