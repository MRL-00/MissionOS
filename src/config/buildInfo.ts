function normalizeDeployBadgeLabel(version: string | undefined, buildDate: string): string {
  const trimmed = version?.trim();

  if (!trimmed || trimmed === "local" || trimmed === "vlocal") {
    return buildDate;
  }

  const deployDateMatch = trimmed.match(/^v?(\d{4}\.\d{2}\.\d{2})(?:-\d+)?$/);
  if (deployDateMatch) {
    return deployDateMatch[1] ?? buildDate;
  }

  const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (isoDateMatch) {
    const [, year = "0000", month = "00", day = "00"] = isoDateMatch;
    return `${year}.${month}.${day}`;
  }

  return trimmed;
}

export const DEPLOY_BADGE_LABEL = normalizeDeployBadgeLabel(import.meta.env.VITE_DEPLOY_VERSION, __BUILD_DATE__);
