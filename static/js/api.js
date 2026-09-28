// Thin wrappers around the local backend.

async function request(url, { etag, method = "GET" } = {}) {
  const headers = { Accept: "application/json" };
  if (etag) headers["If-None-Match"] = `"${etag}"`;
  if (method !== "GET") headers["X-Tracker"] = "1";
  const res = await fetch(url, { method, headers, cache: "no-cache" });
  if (res.status === 304) return { notModified: true };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { body, etag: (res.headers.get("ETag") || "").replace(/"/g, "") };
}

export const getState = () => request("/api/state").then((r) => r.body);
export const getContent = (etag) => request("/api/content", { etag });
export const getMatches = (etag) => request("/api/matches", { etag });
export const syncNow = () => request("/api/sync", { method: "POST" });
export const backfill = () => request("/api/backfill", { method: "POST" });
