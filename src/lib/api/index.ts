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
