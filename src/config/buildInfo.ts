function normalizeDeployVersion(version: string | undefined): string {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "vlocal";
}

export const DEPLOY_VERSION = normalizeDeployVersion(import.meta.env.VITE_DEPLOY_VERSION);
