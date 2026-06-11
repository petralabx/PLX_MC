// The one shared frontend fetch wrapper (governance: no raw fetch('/api/...')
// anywhere else). Unwraps the standard envelope and throws ApiClientError on
// the { error } side. Client-safe; the server route wrapper lives in
// ./route.ts (imported separately, mirroring mc-data's store split).

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  let body: { data?: T; error?: { code: string; message: string } };
  try {
    body = await resp.json();
  } catch {
    throw new ApiClientError("bad_response", `non-JSON response (${resp.status}) from /api${path}`);
  }
  if (!resp.ok || body.error) {
    throw new ApiClientError(body.error?.code ?? "http_error", body.error?.message ?? `HTTP ${resp.status}`);
  }
  return body.data as T;
}
