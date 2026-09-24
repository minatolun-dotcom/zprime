export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  // B-14 (R-04): never force a Content-Type onto FormData — the browser must set
  // its own multipart boundary, or the server rejects the body as invalid JSON.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const res = await fetch(path, {
    credentials: "include",
    headers: options.body && !isFormData ? { "Content-Type": "application/json", ...(options.headers ?? {}) } : options.headers,
    ...options,
  });
  if (res.status === 401) {
    window.location.hash = "";
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? res.json() : ((await res.text()) as unknown as T);
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });
// R-02 voucher cancellation — explicit state transitions (not part of the
// voucher PUT schema). Reason is optional and capped server-side.
export const cancelVoucher = (cid: string | number, id: number | string, reason?: string) =>
  post(`/api/c/${cid}/vouchers/${id}/cancel`, reason ? { reason } : {});
export const uncancelVoucher = (cid: string | number, id: number | string) =>
  api(`/api/c/${cid}/vouchers/${id}/uncancel`, { method: "POST", body: JSON.stringify({}) });
