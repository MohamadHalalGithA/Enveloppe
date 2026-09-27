/**
 * Browser-side calls to our own API. Same-origin only; the session cookie rides along automatically
 * and the browser adds the Origin header the API checks. Error messages come from the API's safe
 * `{ error: { code, message } }` bodies, never from raw exceptions.
 */

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiCallError";
  }
}

const FALLBACK = "Something went wrong. Please try again.";

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) {
      // Session expired: send the user to sign in and come back here. /auth/login is served by the Auth0
      // SDK (not a Next page) and redirects to Auth0, so it needs a full page navigation.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiCallError(res.status, body?.error?.code ?? "ERROR", body?.error?.message ?? FALLBACK);
  }
  return body as T;
}

export async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse<T>(res);
}

export async function del(url: string): Promise<void> {
  const res = await fetch(url, { method: "DELETE", credentials: "same-origin" });
  return parse<void>(res);
}

export async function uploadFile<T>(url: string, file: File): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(url, { method: "POST", credentials: "same-origin", body: form });
  return parse<T>(res);
}

export function messageOf(e: unknown): string {
  return e instanceof ApiCallError ? e.message : FALLBACK;
}
