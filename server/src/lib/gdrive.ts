// R-85: Google Drive client for in-app backups — native fetch (Node 22),
// OAuth 2.0 with the operator's OWN Google Cloud project (no vendor relay),
// least-privilege `drive.file` scope (the app sees only files it created).
//
// Security posture:
//  - The client secret and refresh token are encrypted at rest by the caller
//    (crypto.ts); this module only ever holds them in memory for a call.
//  - Destination hosts are FIXED in code — never user-controllable. The only
//    override is the env-only BACKUP_DRIVE_ENDPOINT (test suites' mock sidecar,
//    mock-irp pattern); it is read from process.env at module load and never
//    from the API/UI.
//  - drive.file scope: even a leaked token cannot read files the app did not
//    create or that the operator has not explicitly opened with it.
//
// Refresh tokens are long-lived EXCEPT when the operator's OAuth consent
// screen is left in "Testing" publishing status — Google expires those in 7
// days (official OAuth2 doc). The setup wizard walks the operator to publish;
// an invalid_grant surfaces the actionable reconnect message (routes layer).

import crypto from "node:crypto";

const DRIVE = process.env.BACKUP_DRIVE_ENDPOINT || "https://www.googleapis.com";
const OAUTH = process.env.BACKUP_OAUTH_ENDPOINT || "https://oauth2.googleapis.com";
// The authorize URL's host is fixed by the OAuth spec shape (accounts.google.com);
// like the two endpoints above it is overridable ONLY via env (test suites'
// mock sidecar) — never from the API/UI (SSRF posture).
const AUTHORIZE = process.env.BACKUP_AUTHORIZE_ENDPOINT || "https://accounts.google.com";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
}

/** The consent URL the operator's browser is redirected to. state is an
 *  unguessable nonce the callback must echo (CSRF protection). */
export function authorizeUrl(creds: { clientId: string }, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // force a refresh token even if the operator consented before
    include_granted_scopes: "false",
    state,
  });
  return `${AUTHORIZE}/o/oauth2/v2/auth?${q.toString()}`;
}

/** Exchange an authorization code for tokens (callback step). */
export async function exchangeCode(
  creds: { clientId: string; clientSecret: string },
  redirectUri: string,
  code: string,
): Promise<{ refreshToken: string }> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !body.refresh_token) {
    throw new Error(
      body.error_description || body.error || `Google token exchange failed (${res.status})`,
    );
  }
  return { refreshToken: body.refresh_token };
}

let cachedAccessToken: { token: string; exp: number } | null = null;

/** Access token via the refresh token (cached until ~5 min before expiry).
 *  A 401 mid-call invalidates the cache once and retries (see driveFetch). */
async function accessToken(creds: DriveCreds): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.exp > Date.now() + 5 * 60_000) return cachedAccessToken.token;
  if (!creds.refreshToken) throw new Error("Google Drive is not connected");
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !body.access_token) {
    cachedAccessToken = null;
    // The classic signature of the consent-screen-"Testing" 7-day expiry —
    // surface the actionable message, never a bare 500.
    if (body.error === "invalid_grant") {
      throw new Error(
        "Google rejected the saved connection (invalid_grant). Usual cause: the OAuth consent " +
          "screen is still in \"Testing\" publishing status (refresh tokens expire in 7 days) or " +
          "access was revoked. Set it to \"In production\" in the Google Cloud console, then reconnect.",
      );
    }
    throw new Error(body.error_description || body.error || `Google token refresh failed (${res.status})`);
  }
  cachedAccessToken = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

export function invalidateAccessToken(): void {
  cachedAccessToken = null;
}

async function driveFetch(creds: DriveCreds, path: string, init?: RequestInit): Promise<Response> {
  const doFetch = async () =>
    fetch(`${DRIVE}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${await accessToken(creds)}` },
    });
  let res = await doFetch();
  if (res.status === 401) {
    invalidateAccessToken();
    res = await doFetch();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive API error (${res.status}): ${text.slice(0, 300)}`);
  }
  return res;
}

/** Get-or-create the backups folder inside the operator's Drive. Returns the
 *  folder id (drive.file: it becomes visible to the app by creation). */
export async function ensureFolder(creds: DriveCreds, folderName: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`,
  );
  const res = await driveFetch(creds, `/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`);
  const body = (await res.json()) as { files?: { id: string }[] };
  if (body.files?.length) return body.files[0].id;
  const created = await driveFetch(creds, "/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
  });
  const folder = (await created.json()) as { id: string };
  return folder.id;
}

/** Multipart upload of a small file (dumps are MBs; Drive's 5 MB simple-limit
 *  is sidestepped by multipart which allows metadata+media in one call for
 *  larger payloads too). Returns the Drive file id. */
export async function uploadFile(
  creds: DriveCreds,
  folderId: string,
  name: string,
  mimeType: string,
  data: Buffer,
): Promise<string> {
  const boundary = `zprime-${crypto.randomBytes(16).toString("hex")}`;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await driveFetch(creds, "/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  const out = (await res.json()) as { id: string };
  return out.id;
}

export interface DriveFileInfo {
  id: string;
  name: string;
  size: string | null;
  createdTime: string;
}

/** List the app's files in the folder, newest first (drive.file: only the
 *  app's own files are visible at all). */
export async function listFiles(creds: DriveCreds, folderId: string): Promise<DriveFileInfo[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveFetch(
    creds,
    `/drive/v3/files?q=${q}&fields=files(id,name,size,createdTime)&orderBy=createdTime desc&pageSize=100`,
  );
  const body = (await res.json()) as { files?: DriveFileInfo[] };
  return body.files ?? [];
}

/** Download a file's bytes. */
export async function downloadFile(creds: DriveCreds, fileId: string): Promise<Buffer> {
  const res = await driveFetch(creds, `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return Buffer.from(await res.arrayBuffer());
}

/** Permanently delete a file (retention pruning). */
export async function deleteFile(creds: DriveCreds, fileId: string): Promise<void> {
  await driveFetch(creds, `/drive/v3/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}

/** Best-effort token revocation on disconnect (the operator may also revoke
 *  from their Google account at any time — https://myaccount.google.com/permissions). */
export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(`${OAUTH}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined); // best-effort: wipe locally regardless
}
