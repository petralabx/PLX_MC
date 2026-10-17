// The one shared frontend fetch wrapper (governance: no raw fetch('/api/...')
// anywhere else). Unwraps the standard envelope and throws ApiClientError on
// the { error } side; apiDownload() does the same for file routes. Client-safe;
// the server route wrapper lives in ./route.ts (imported separately, mirroring
// mc-data's store split).

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

// The middleware answers an API call without a session with 401
// signin_required (src/lib/auth/edge.ts, TASK-3161). A read sends the browser
// to sign in, then back to this screen. A write does not: leaving the page
// would drop what the person was saving, so it fails with the message instead.
function signInIfRequired(status: number, code: string | undefined, method: string | undefined): void {
  if (status !== 401 || code !== "signin_required" || typeof window === "undefined") return;
  if ((method ?? "GET").toUpperCase() !== "GET") return;
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/signin?callbackUrl=${encodeURIComponent(here)}`);
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
  signInIfRequired(resp.status, body.error?.code, init?.method);
  if (!resp.ok || body.error) {
    throw new ApiClientError(body.error?.code ?? "http_error", body.error?.message ?? `HTTP ${resp.status}`);
  }
  return body.data as T;
}

export interface ApiDownload {
  blob: Blob;
  /** The name from Content-Disposition, or null when the route sent none. */
  fileName: string | null;
}

/**
 * The shared way to fetch a file route (an export): the body as a Blob and its
 * suggested file name. A failure carries the standard error envelope and throws
 * ApiClientError, as api() does.
 */
export async function apiDownload(path: string, init?: RequestInit): Promise<ApiDownload> {
  const resp = await fetch(`/api${path}`, init);
  if (!resp.ok) {
    let body: { error?: { code: string; message: string } };
    try {
      body = await resp.json();
    } catch {
      throw new ApiClientError("bad_response", `non-JSON response (${resp.status}) from /api${path}`);
    }
    signInIfRequired(resp.status, body.error?.code, init?.method);
    throw new ApiClientError(body.error?.code ?? "http_error", body.error?.message ?? `HTTP ${resp.status}`);
  }
  return { blob: await resp.blob(), fileName: dispositionFileName(resp.headers.get("content-disposition")) };
}

/** The file name in a Content-Disposition header (filename="…" or filename=…), or null. */
export function dispositionFileName(header: string | null): string | null {
  const match = /filename\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(header ?? "");
  const name = (match?.[1] ?? match?.[2] ?? "").trim();
  return name || null;
}
