#!/usr/bin/env node
// R-85 mock Google Drive + OAuth2 — the backup counterpart of mock_irp.js.
// Speaks just enough of the REAL wire shapes for zprime's gdrive.ts client:
//
//   GET  /o/oauth2/v2/auth            → 302 to {redirect_uri}?code&state   (browser navigation)
//   POST /token                       → authorization_code / refresh_token grants
//   POST /revoke                      → 200 (best-effort revoke path)
//   GET  /drive/v3/files?q=…          → folder-by-name / list-in-folder
//   POST /upload/drive/v3/files       → multipart upload → { id }
//   GET  /drive/v3/files/:id?alt=media→ raw bytes
//   DELETE /drive/v3/files/:id        → 204
//
// Test controls (like mock_irp's /__stats):
//   POST /__fail-refresh  { error: "invalid_grant" } → next token refresh fails with that error
//                         (the 7-day-consent-Testing signature; suites assert the actionable message)
//   POST /__corrupt       { name } → next download of that file returns corrupted bytes (sha-refusal test)
//   GET  /__files         → every stored file (name, size, parents) for suite assertions
//   POST /__reset         → wipe state between suites
//
// One server serves BOTH sides: the in-container server calls DRIVE/OAUTH endpoints via
// BACKUP_DRIVE_ENDPOINT/BACKUP_OAUTH_ENDPOINT (http://mock-drive:3309), while the test
// browser follows the consent redirect via BACKUP_AUTHORIZE_ENDPOINT (http://localhost:3309).
// Tokens are static ("mock-access-token") — the server's Authorization header carries it.
//
// Usage: node scripts/mock_drive.js --port 3309
import crypto from "node:crypto";
import http from "node:http";

const args = process.argv.slice(2);
const port = parseInt(args[args.indexOf("--port") + 1] ?? "3309", 10);

const ACCESS = "mock-access-token";
const state = {
  files: new Map(), // id → { id, name, mimeType, parents, size, createdTime, bytes: Buffer, corrupt: boolean }
  failRefresh: null, // error name for the next /token refresh grant
  failDrive401: false, // next /drive/* call answers 401 once (exercises the client's cache-invalidate + retry path)
  corruptNext: null, // file name whose next download is corrupted
  stats: { authCalls: 0, codeExchanges: 0, refreshCalls: 0, uploads: 0, downloads: 0, deletes: 0, revokes: 0, refreshFailures: 0 },
};

function q(url) {
  return new URL(url, "http://x").searchParams;
}
function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  // Binary-safe: accumulate BUFFERS (string += buffer would UTF-8-decode
  // multipart gzip bytes lossily — the sha-refusal suite caught this).
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (ch) => chunks.push(ch));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
function folderQueryMatches(sp, needle) {
  const s = sp.get("q") ?? "";
  return s.includes(needle);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const sp = url.searchParams;

  // ---------------- test controls ----------------
  if (url.pathname === "/__reset") {
    state.files.clear();
    state.failRefresh = null;
    state.failDrive401 = false;
    state.corruptNext = null;
    for (const k of Object.keys(state.stats)) state.stats[k] = 0;
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__stats") return send(res, 200, state.stats);
  if (url.pathname === "/__files") {
    return send(res, 200, [...state.files.values()].map(({ bytes, ...f }) => ({ ...f, size: bytes.length })));
  }
  if (url.pathname === "/__fail-refresh") {
    const body = await readBody(req);
    state.failRefresh = JSON.parse(body.toString() || "{}").error || "invalid_grant";
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__corrupt") {
    const body = await readBody(req);
    state.corruptNext = JSON.parse(body.toString() || "{}").name || null;
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__fail-drive-401") {
    state.failDrive401 = true;
    return send(res, 200, { ok: true });
  }

  // ---------------- OAuth2 ----------------
  // Consent navigation (browser): hand back an authorization code to the redirect_uri.
  if (url.pathname === "/o/oauth2/v2/auth") {
    state.stats.authCalls++;
    const redirect = sp.get("redirect_uri") ?? "";
    const target = `${redirect}?code=mock-auth-code&state=${encodeURIComponent(sp.get("state") ?? "")}`;
    res.writeHead(302, { location: target });
    return res.end();
  }
  if (url.pathname === "/token") {
    const body = await readBody(req);
    const p = new URLSearchParams(body.toString());
    if (p.get("grant_type") === "authorization_code") {
      state.stats.codeExchanges++;
      return send(res, 200, { access_token: ACCESS, expires_in: 3600, refresh_token: "mock-refresh-token", token_type: "Bearer" });
    }
    // refresh_token grant
    state.stats.refreshCalls++;
    if (state.failRefresh) {
      state.stats.refreshFailures++;
      const err = state.failRefresh;
      state.failRefresh = null; // one shot
      return send(res, 400, { error: err, error_description: `mock forced: ${err}` });
    }
    return send(res, 200, { access_token: ACCESS, expires_in: 3600, token_type: "Bearer" });
  }
  if (url.pathname === "/revoke") {
    state.stats.revokes++;
    return send(res, 200, { ok: true });
  }

  // ---------------- Drive v3 ----------------
  if (url.pathname.startsWith("/drive/") && state.failDrive401) {
    state.failDrive401 = false; // once
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { code: 401, message: "UNAUTHENTICATED" } }));
  }
  if (url.pathname === "/drive/v3/files" && req.method === "GET") {
    const files = [...state.files.values()];
    // Folder-by-name lookup (ensureFolder): mimeType folder + name='X'
    if (folderQueryMatches(sp, "mimeType='application/vnd.google-apps.folder'")) {
      const m = (sp.get("q") ?? "").match(/name='((?:[^'\\]|\\.)*)'/);
      const want = m ? m[1].replace(/\\'/g, "'") : "";
      const hit = files.find((f) => f.mimeType === "application/vnd.google-apps.folder" && f.name === want);
      return send(res, 200, { files: hit ? [{ id: hit.id }] : [] });
    }
    // In-folder listing (listFiles): 'id' in parents
    const pm = (sp.get("q") ?? "").match(/'([^']+)' in parents/);
    if (pm) {
      const hit = files
        .filter((f) => (f.parents ?? []).includes(pm[1]) && !f.trashed)
        .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
        .map(({ bytes, ...f }) => ({ ...f, size: String(bytes.length) }));
      return send(res, 200, { files: hit });
    }
    return send(res, 200, { files: [] });
  }

  if (url.pathname === "/drive/v3/files" && req.method === "POST") {
    // Folder creation
    const body = await readBody(req);
    const meta = JSON.parse(body.toString() || "{}");
    const id = crypto.randomBytes(8).toString("hex");
    state.files.set(id, {
      id, name: meta.name ?? "untitled", mimeType: meta.mimeType ?? "application/octet-stream",
      parents: meta.parents ?? [], createdTime: new Date().toISOString(), bytes: Buffer.alloc(0), trashed: false,
    });
    return send(res, 200, { id });
  }

  // Multipart upload
  if (url.pathname === "/upload/drive/v3/files" && req.method === "POST") {
    state.stats.uploads++;
    const body = await readBody(req);
    const raw = body.toString("latin1"); // byte-preserving for parsing; bytes re-sliced from the buffer
    const boundary = (req.headers["content-type"] ?? "").match(/boundary=([^;]+)/)?.[1];
    const metaM = raw.match(/Content-Type: application\/json; charset=UTF-8\r\n\r\n(.*)\r\n--/);
    const meta = metaM ? JSON.parse(metaM[1]) : {};
    // The media part starts after its headers; slice the ORIGINAL buffer to keep bytes exact.
    const sig = "Content-Type: application/json; charset=UTF-8\r\n\r\n";
    const afterMeta = body.indexOf(Buffer.from(sig, "latin1"));
    const metaEnd = body.indexOf(Buffer.from("\r\n--", "latin1"), afterMeta);
    const mediaStart = body.indexOf(Buffer.from("\r\n\r\n", "latin1"), metaEnd) + 4;
    const mediaEnd = body.indexOf(Buffer.from(`\r\n--${boundary}--`, "latin1"), mediaStart);
    const bytes = body.subarray(mediaStart, mediaEnd);
    const id = crypto.randomBytes(8).toString("hex");
    state.files.set(id, {
      id, name: meta.name ?? "upload.bin", mimeType: "application/octet-stream",
      parents: meta.parents ?? [], createdTime: new Date().toISOString(), bytes, trashed: false,
    });
    return send(res, 200, { id });
  }

  // Download / delete by id
  const idm = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (idm) {
    const f = state.files.get(idm[1]);
    if (!f) return send(res, 404, { error: { message: "File not found" } });
    if (req.method === "DELETE") {
      state.stats.deletes++;
      state.files.delete(idm[1]);
      return send(res, 204, {});
    }
    if (sp.get("alt") === "media") {
      state.stats.downloads++;
      let bytes = f.bytes;
      if (state.corruptNext === f.name) {
        bytes = Buffer.from(`corrupted-${bytes.length}`, "utf8"); // same-ish length, different bytes
        state.corruptNext = null;
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(bytes);
    }
    return send(res, 200, { id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime });
  }

  send(res, 404, { error: `mock-drive: no route ${req.method} ${url.pathname}` });
});

server.listen(port, () => console.log(`mock_drive listening on :${port}`));
