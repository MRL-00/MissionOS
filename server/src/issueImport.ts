export const MAX_IMPORTED_ISSUE_TITLE_LENGTH = 180;
export const MAX_IMPORTED_ISSUE_DESCRIPTION_LENGTH = 10_000;
export const MAX_IMPORTED_ISSUE_LABEL_LENGTH = 60;
export const MAX_IMPORTED_ISSUE_LABEL_COUNT = 20;

export function normalizeImportedIssueTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  return (title || "Untitled").slice(0, MAX_IMPORTED_ISSUE_TITLE_LENGTH);
}

export function normalizeImportedIssueDescription(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const description = value.trim();
  return description ? description.slice(0, MAX_IMPORTED_ISSUE_DESCRIPTION_LENGTH) : null;
}

export function normalizeImportedIssueLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const labels: string[] = [];
  for (const item of value) {
    const label = typeof item === "string" ? item : typeof item?.name === "string" ? item.name : "";
    const normalized = label.trim().slice(0, MAX_IMPORTED_ISSUE_LABEL_LENGTH);
    if (normalized) {
      labels.push(normalized);
    }
    if (labels.length >= MAX_IMPORTED_ISSUE_LABEL_COUNT) {
      break;
    }
  }
  return labels;
}
