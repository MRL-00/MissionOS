type HttpLikeError = {
  message?: string;
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
};

export type HttpErrorResponse = { status: number; body: { error: string } };

export function formatHttpError(error: unknown, nodeEnv: string | undefined): HttpErrorResponse {
  const httpError = isHttpLikeError(error) ? error : {};
  const status = normalizeHttpStatus(httpError.status ?? httpError.statusCode);

  if (httpError.type === "entity.parse.failed") {
    return { status: 400, body: { error: "Invalid JSON payload." } };
  }

  if (httpError.type === "entity.too.large" || status === 413) {
    return { status: 413, body: { error: "Request body is too large." } };
  }

  if (status >= 400 && status < 500) {
    return { status, body: { error: httpError.message || "Bad request." } };
  }

  return {
    status: 500,
    body: {
      error: nodeEnv === "production" ? "Server error" : httpError.message || "Server error",
    },
  };
}

function isHttpLikeError(error: unknown): error is HttpLikeError {
  return Boolean(error && typeof error === "object");
}

function normalizeHttpStatus(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 500;
}
