// R-28: IRP/EWB connectivity (opt-in) — session management, wire crypto, and
// submission with hard idempotency.
//
// Wire model per the NIC e-invoice API (sandbox documentation):
//   AUTH    — request carries base64(RSA(pubkey, AppKey)) + base64(RSA(pubkey,
//             password)); response carries { Authtoken, Sek, ExpInHrs,
//             ValidUntil } where Sek is base64(AES-256-ECB(AppKey, sek)).
//   GENIRN  — body { action: "GENIRN", payload: base64(AES-256-ECB(SEK, json)) };
//             response.data is base64 AES-256-ECB(SEK, responseJson).
//   GENEWB  — e-way bill from an existing IRN + Part-B transport fields.
//
// Posture:
//   - OPT-IN: nothing here runs unless an operator configures per-company
//     credentials (CompanySettings). Without credentials the R-24/R-25
//     generate+download behavior is byte-identical (guarded by regression).
//   - Secrets never leave the server in plaintext (crypto.ts at rest, masked
//     reads in routes). AppKey + SEK live only in process memory, dying with
//     the token (6h production / 1h sandbox).
//   - IDEMPOTENCY IS A CORRECTNESS REQUIREMENT: the NIC blocks users who fire
//     duplicate transactions for one hour. Two partial unique indexes
//     ((voucher,kind) WHERE status='accepted' / ='pending') make a double
//     submit impossible at the DB level; this service also refuses eagerly
//     (no network call) on a known accepted/pending submission, and
//     self-heals a pending row older than PENDING_STALE_MS as an abandoned
//     attempt (crash between insert and update) before proceeding.
//   - Every submission attempt is recorded VERBATIM in irp_submissions —
//     accepted rows are never deleted by the application (legal record).

import { db } from "../db/index.js";
import { irpCredentials, irpEwbOps, irpSubmissions } from "../db/schema.js";
import { and, eq, lt } from "drizzle-orm";
import crypto from "node:crypto";
import { decryptSecret, encryptSecret, irpKeyFromEnv } from "../lib/crypto.js";
import { eInvoicePayload } from "./einvoice.js";
import { ewaybillDirectPayload, EwaybillParams } from "./ewaybill.js";

const PENDING_STALE_MS = 10 * 60 * 1000;

export type IrpKind = "e-invoice" | "ewaybill";
export type IrpStatus = "pending" | "accepted" | "rejected" | "error" | "cancelled";

interface IrpCredsRow {
  id: number; companyId: number; environment: string; clientId: string;
  clientSecretEnc: string; gstin: string; username: string; passwordEnc: string;
  // R-30: EWB-portal credentials (a SEPARATE portal from the e-invoice IRP).
  // Nullable — absent = EWB-from-IRN only (B2B), the pre-R-30 behavior.
  ewbUsername: string | null; ewbPasswordEnc: string | null;
  publicKeyPem: string | null; endpointOverride: string | null;
}

// ---------- session cache (AppKey + SEK live in memory only) ----------
interface IrpSession { authtoken: string; sek: Buffer; appKey: Buffer; expiry: number }
const sessions = new Map<string, IrpSession>(); // `${credsId}:${gstin}`

export function _clearIrpSessions(): void { sessions.clear(); }

// ---------- wire crypto ----------
export function encryptPayload(sek: Buffer, json: unknown): string {
  const c = crypto.createCipheriv("aes-256-ecb", sek, null);
  return Buffer.concat([c.update(JSON.stringify(json), "utf8"), c.final()]).toString("base64");
}
export function decryptResponse(sek: Buffer, b64: string): unknown {
  const d = crypto.createDecipheriv("aes-256-ecb", sek, null);
  return JSON.parse(Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]).toString("utf8"));
}
function rsaEncrypt(pubkeyPem: string, plaintext: Buffer): string {
  return crypto.publicEncrypt({ key: pubkeyPem, padding: crypto.constants.RSA_PKCS1_PADDING }, plaintext).toString("base64");
}

// ---------- endpoints ----------
function baseUrl(creds: IrpCredsRow): string {
  if (creds.endpointOverride && creds.endpointOverride.trim() !== "") return creds.endpointOverride.replace(/\/+$/, "");
  if (creds.environment === "sandbox") return "https://einv-apisandbox.nic.in";
  throw new Error(
    "Production IRP connectivity requires an explicit endpoint (production IRP hosts vary by IRP) — " +
      "set the endpoint override in Company Settings, or point it at a mock/adapter for testing.",
  );
}

// R-30: the NIC EWB-API is a DIFFERENT system (v1.03) with no stable,
// NIC-published sandbox constant we could verify — so unlike the IRP base
// URL there is no default: sandbox AND production require an explicit
// endpoint override (the mock sidecar in CI — it speaks BOTH URL families
// under one host; the operator's GSP/NIC EWB-API host in the field).
// Fail-fast beats guessing a hostname. Documented limitation: production
// IRP and EWB hosts share the single override field today.
function ewbBaseUrl(creds: IrpCredsRow): string {
  if (creds.endpointOverride && creds.endpointOverride.trim() !== "") return creds.endpointOverride.replace(/\/+$/, "");
  throw new Error(
    "Direct e-way bill connectivity requires an explicit endpoint override in Company Settings " +
      "(the EWB-API host differs from the e-invoice IRP and has no zprime default) — point it at " +
      "your GSP/NIC EWB-API host or the mock for testing.",
  );
}

async function irpFetch(creds: IrpCredsRow, path: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(baseUrl(creds) + path, init);
  } catch (e: any) {
    throw new Error(`IRP unreachable (${e?.message ?? e})`);
  }
  const body = await res.json().catch(() => null);
  if (body === null) throw new Error(`IRP returned non-JSON HTTP ${res.status}`);
  return body;
}

// R-30: same transport, EWB base URL (distinct portal). Error text names the
// EWB system so an unreachable host is diagnosable at a glance.
async function ewbFetch(creds: IrpCredsRow, path: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(ewbBaseUrl(creds) + path, init);
  } catch (e: any) {
    throw new Error(`EWB-API unreachable (${e?.message ?? e})`);
  }
  const body = await res.json().catch(() => null);
  if (body === null) throw new Error(`EWB-API returned non-JSON HTTP ${res.status}`);
  return body;
}

// ---------- auth ----------
async function authenticate(creds: IrpCredsRow): Promise<IrpSession> {
  const appKey = crypto.randomBytes(32);
  const clientSecret = decryptSecret(creds.clientSecretEnc);
  const pub = creds.publicKeyPem?.trim()
    ? creds.publicKeyPem
    : process.env.IRP_NIC_PUBLIC_KEY?.trim() ?? "";
  if (!pub) throw new Error("No IRP public key configured (Company Settings or IRP_NIC_PUBLIC_KEY).");
  const reqBody = {
    action: "AUTHTOK",
    ClientId: creds.clientId,
    ClientSecret: rsaEncrypt(pub, Buffer.from(clientSecret, "utf8")),
    Gstin: creds.gstin,
    Username: creds.username,
    Password: rsaEncrypt(pub, Buffer.from(decryptSecret(creds.passwordEnc), "utf8")),
    AppKey: rsaEncrypt(pub, appKey),
    ForceRefreshAccessToken: false,
  };
  const body = await irpFetch(creds, "/eivital/v1.10/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reqBody),
  });
  if (body.Status !== 1 || !body.Authtoken || !body.Sek) {
    const err = body.ErrorDetails ?? [{ ErrorMessage: `auth failed (HTTP Status ${body.Status})` }];
    throw Object.assign(new Error("IRP authentication failed"), { irpErrors: err });
  }
  const sek = crypto.createDecipheriv("aes-256-ecb", appKey, null);
  const sekBuf = Buffer.concat([sek.update(Buffer.from(body.Sek, "base64")), sek.final()]);
  const hours = typeof body.ExpInHrs === "number" ? body.ExpInHrs : 6;
  const sess: IrpSession = { authtoken: body.Authtoken, sek: sekBuf, appKey, expiry: Date.now() + hours * 3600_000 - 5 * 60_000 };
  sessions.set(`${creds.id}:${creds.gstin}`, sess);
  return sess;
}

async function session(creds: IrpCredsRow): Promise<IrpSession> {
  const key = `${creds.id}:${creds.gstin}`;
  const cur = sessions.get(key);
  if (cur && cur.expiry > Date.now()) return cur;
  return authenticate(creds);
}

// ---------- authenticated POST ----------
async function irpAction(creds: IrpCredsRow, action: string, payload: unknown, path = "/eivital/v1.10/genirn"): Promise<any> {
  const sess = await session(creds);
  const body = await irpFetch(creds, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "auth-token": sess.authtoken,
      "client-id": creds.clientId,
      "client-secret": decryptSecret(creds.clientSecretEnc),
      "user-name": creds.username,
      Gstin: creds.gstin,
      "ip-uisrn": "127.0.0.1",
      requestid: crypto.randomUUID(),
      "request-timestamp": new Date().toISOString(),
    },
    body: JSON.stringify({ action, payload: encryptPayload(sess.sek, payload) }),
  });
  if (body.Status !== 1 || !body.Data) {
    throw Object.assign(new Error(`IRP action ${action} failed`), { irpErrors: body.ErrorDetails ?? [{ ErrorMessage: `HTTP-level failure (Status ${body.Status})` }] });
  }
  return decryptResponse(sess.sek, body.Data);
}

// ---- R-30: EWB-portal session (NIC EWB-API v1.03 — a SEPARATE portal) ----
// Same RSA/AES choreography as the IRP but its own credentials (the
// taxpayer's ewaybillgst.gov.in username/password), own authtoken/SEK, own
// cache namespace. Casing is tolerated across the wire because v1.03
// mirrors disagree (MasterGST/Vayana vs NIC PDF) — the mock emits the
// lowercase form.
interface EwbSession { authtoken: string; sek: Buffer; appKey: Buffer; expiry: number }
const ewbSessions = new Map<string, EwbSession>(); // `ewb:${credsId}`

export function _clearEwbSessions(): void { ewbSessions.clear(); }

function ewbDecryptSek(appKey: Buffer, b64: string): Buffer {
  const d = crypto.createDecipheriv("aes-256-ecb", appKey, null);
  return Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]);
}

async function ewbAuthenticate(creds: IrpCredsRow): Promise<EwbSession> {
  if (!creds.ewbUsername || !creds.ewbPasswordEnc) {
    throw Object.assign(
      new Error("Direct e-way bills need EWB-portal credentials (the EWB system is separate from the e-invoice IRP) — add the EWB username/password in Company Settings."),
      { statusCode: 400 },
    );
  }
  const appKey = crypto.randomBytes(32);
  const pub = creds.publicKeyPem?.trim()
    ? creds.publicKeyPem
    : process.env.EWB_NIC_PUBLIC_KEY?.trim() ?? process.env.IRP_NIC_PUBLIC_KEY?.trim() ?? "";
  if (!pub) throw new Error("No EWB public key configured (Company Settings public key or EWB_NIC_PUBLIC_KEY env).");
  const reqBody = {
    action: "AUTHTOK",
    gstin: creds.gstin,
    username: creds.ewbUsername,
    password: rsaEncrypt(pub, Buffer.from(decryptSecret(creds.ewbPasswordEnc), "utf8")),
    appkey: rsaEncrypt(pub, appKey),
  };
  const body = await ewbFetch(creds, "/v1.03/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reqBody),
  });
  const status = body.status ?? body.Status;
  const token = body.authtoken ?? body.Authtoken;
  const sekB64 = body.sek ?? body.Sek;
  if (Number(status) !== 1 || !token || !sekB64) {
    const err = body.errorDetails ?? body.ErrorDetails ?? [{ errorMessage: `EWB auth failed (HTTP Status ${status})` }];
    throw Object.assign(new Error("EWB-portal authentication failed"), { irpErrors: err });
  }
  const hours = typeof body.expInHrs === "number" ? body.expInHrs : 6; // v1.03 AUTHTOK: 6 h
  const sess: EwbSession = { authtoken: token, sek: ewbDecryptSek(appKey, sekB64), appKey, expiry: Date.now() + hours * 3600_000 - 5 * 60_000 };
  ewbSessions.set(`ewb:${creds.id}`, sess);
  return sess;
}

async function ewbSession(creds: IrpCredsRow): Promise<EwbSession> {
  const cur = ewbSessions.get(`ewb:${creds.id}`);
  if (cur && cur.expiry > Date.now()) return cur;
  return ewbAuthenticate(creds);
}

async function ewbAction(creds: IrpCredsRow, action: string, payload: unknown, path = "/v1.03/ewayapi"): Promise<any> {
  const sess = await ewbSession(creds);
  const body = await ewbFetch(creds, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      gstin: creds.gstin,
      username: creds.ewbUsername ?? "",
      authtoken: sess.authtoken,
    },
    body: JSON.stringify({ action, payload: encryptPayload(sess.sek, payload) }),
  });
  const status = body.status ?? body.Status;
  const data = body.data ?? body.Data;
  if (Number(status) !== 1 || !data) {
    throw Object.assign(new Error(`EWB action ${action} failed`), {
      irpErrors: body.errorDetails ?? body.ErrorDetails ?? body.info ?? [{ errorMessage: `HTTP-level failure (Status ${status})` }],
    });
  }
  return decryptResponse(sess.sek, data);
}

// ---------- idempotency ----------
async function resolveStalePending(voucherId: number, kind: IrpKind): Promise<void> {
  const stale = await db
    .select({ id: irpSubmissions.id })
    .from(irpSubmissions)
    .where(and(eq(irpSubmissions.voucherId, voucherId), eq(irpSubmissions.kind, kind), eq(irpSubmissions.status, "pending"), lt(irpSubmissions.createdAt, new Date(Date.now() - PENDING_STALE_MS))));
  for (const row of stale) {
    await db.update(irpSubmissions)
      .set({ status: "error", error: { message: "abandoned pending attempt (stale > 10 min) — cleared automatically" } })
      .where(eq(irpSubmissions.id, row.id));
  }
}

async function existingBlocking(voucherId: number, kind: IrpKind) {
  const rows = await db
    .select()
    .from(irpSubmissions)
    .where(and(eq(irpSubmissions.voucherId, voucherId), eq(irpSubmissions.kind, kind)));
  return rows.find((r) => r.status === "accepted") ?? rows.find((r) => r.status === "pending") ?? null;
}

// ---------- public API ----------
export interface SubmitResult {
  ok: boolean;
  duplicate?: boolean; // refused without a network call — already accepted/pending
  validationErrors?: string[]; // payload validation failed; nothing was submitted
  irpErrors?: unknown; // IRP ErrorDetails verbatim
  submission?: unknown; // the irp_submissions row
}

async function loadCreds(companyId: number, env: string): Promise<IrpCredsRow> {
  irpKeyFromEnv(); // fail fast with the actionable message before anything else
  const rows = await db.select().from(irpCredentials).where(and(eq(irpCredentials.companyId, companyId), eq(irpCredentials.environment, env)));
  if (rows.length === 0) {
    throw Object.assign(new Error(`No ${env} IRP credentials configured for this company (Company Settings).`), { statusCode: 400 });
  }
  return rows[0];
}

export async function submitEInvoice(companyId: number, voucherId: number, requestedBy: number, env = "sandbox"): Promise<SubmitResult> {
  await resolveStalePending(voucherId, "e-invoice");
  const block = await existingBlocking(voucherId, "e-invoice");
  if (block) return { ok: false, duplicate: true, submission: maskSubmission(block) };

  const payload = await eInvoicePayload(companyId, voucherId);
  if (!payload.ok || !payload.payload) {
    return { ok: false, validationErrors: payload.errors };
  }

  const creds = await loadCreds(companyId, env);
  const inserted = await db
    .insert(irpSubmissions)
    .values({ companyId, voucherId, kind: "e-invoice", status: "pending", requestedBy })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    const block2 = await existingBlocking(voucherId, "e-invoice");
    return { ok: false, duplicate: true, submission: block2 ? maskSubmission(block2) : undefined };
  }
  const rowId = inserted[0].id;
  try {
    const resp = (await irpAction(creds, "GENIRN", payload.payload)) as any;
    const accepted = resp.Irn != null;
    const updated = await db.update(irpSubmissions).set({
      status: accepted ? "accepted" : "rejected",
      irn: resp.Irn ?? null,
      ackNo: resp.AckNo != null ? String(resp.AckNo) : null,
      ackDate: resp.AckDt ?? null,
      response: resp,
      error: accepted ? null : (resp.ErrorDetails ?? [{ ErrorMessage: "IRP did not return an IRN" }]),
    }).where(eq(irpSubmissions.id, rowId)).returning();
    return { ok: accepted, irpErrors: accepted ? undefined : updated[0].error, submission: maskSubmission(updated[0]) };
  } catch (e: any) {
    // IRP business rejection (Status 0 + ErrorDetails) = 'rejected' — the
    // operator fixes the payload and RETRIES. Transport/decryption failure =
    // 'error' — zprime-side problem. Both recorded verbatim.
    const rejected = Array.isArray(e?.irpErrors);
    const updated = await db.update(irpSubmissions).set({ status: rejected ? "rejected" : "error", error: { message: e?.message ?? String(e), irpErrors: e?.irpErrors ?? null } }).where(eq(irpSubmissions.id, rowId)).returning();
    return { ok: false, irpErrors: e?.irpErrors ?? e?.message, submission: maskSubmission(updated[0]) };
  }
}

export async function submitEwayBillFromIrn(
  companyId: number, voucherId: number, requestedBy: number, partB: Record<string, unknown>, env = "sandbox",
): Promise<SubmitResult> {
  await resolveStalePending(voucherId, "ewaybill");
  const block = await existingBlocking(voucherId, "ewaybill");
  if (block) return { ok: false, duplicate: true, submission: maskSubmission(block) };

  const einv = await existingBlocking(voucherId, "e-invoice");
  if (!einv || einv.status !== "accepted" || !einv.irn) {
    throw Object.assign(new Error("Register the e-invoice first — the e-way bill is generated from its IRN."), { statusCode: 400 });
  }

  const creds = await loadCreds(companyId, env);
  const inserted = await db
    .insert(irpSubmissions)
    .values({ companyId, voucherId, kind: "ewaybill", status: "pending", requestedBy })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    const block2 = await existingBlocking(voucherId, "ewaybill");
    return { ok: false, duplicate: true, submission: block2 ? maskSubmission(block2) : undefined };
  }
  const rowId = inserted[0].id;
  try {
    const resp = (await irpAction(creds, "GENEWB", { Irn: einv.irn, ...partB }, "/eivital/v1.10/genewb")) as any;
    const accepted = resp.EwbNo != null;
    const updated = await db.update(irpSubmissions).set({
      status: accepted ? "accepted" : "rejected",
      ewbNo: resp.EwbNo != null ? String(resp.EwbNo) : null,
      ewbValidUntil: resp.EwbDt ?? resp.ValidUpto ?? null,
      response: resp,
      error: accepted ? null : (resp.ErrorDetails ?? [{ ErrorMessage: "IRP did not return an EWB number" }]),
    }).where(eq(irpSubmissions.id, rowId)).returning();
    return { ok: accepted, irpErrors: accepted ? undefined : updated[0].error, submission: maskSubmission(updated[0]) };
  } catch (e: any) {
    const rejected = Array.isArray(e?.irpErrors);
    const updated = await db.update(irpSubmissions).set({ status: rejected ? "rejected" : "error", error: { message: e?.message ?? String(e), irpErrors: e?.irpErrors ?? null } }).where(eq(irpSubmissions.id, rowId)).returning();
    return { ok: false, irpErrors: e?.irpErrors ?? e?.message, submission: maskSubmission(updated[0]) };
  }
}

// ---- R-30: DIRECT e-way bill generation (NIC EWB-API v1.03, non-IRN) ----
// For EWB-eligible-but-not-IRN-eligible vouchers (B2C sales): the e-invoice
// path demands a buyer GSTIN, Rule 138 does not. Same idempotency model as
// every submission: one (voucher, kind='ewaybill') accepted/pending row,
// enforced by the DB partial uniques — a direct-born EWB and an IRN-born EWB
// are the same kind, so one voucher can never carry two EWBs.
export async function generateEwbDirect(
  companyId: number, voucherId: number, requestedBy: number, partB: EwaybillParams, env = "sandbox",
): Promise<SubmitResult> {
  await resolveStalePending(voucherId, "ewaybill");
  const block = await existingBlocking(voucherId, "ewaybill");
  if (block) return { ok: false, duplicate: true, submission: maskSubmission(block) };

  // Friendly boundary: if the voucher already rides an IRN, the EWB must be
  // born from it (Part-A is derived server-side there). Direct is for the
  // rest — the structural guard is the shared kind, this is the message.
  const einv = await existingBlocking(voucherId, "e-invoice");
  if (einv && einv.status === "accepted" && einv.irn) {
    throw Object.assign(new Error("This voucher has a registered IRN — generate the e-way bill from it (ewb-gen)."), { statusCode: 400 });
  }

  const payload = await ewaybillDirectPayload(companyId, voucherId, partB);
  if (!payload.ok || !payload.payload) {
    return { ok: false, validationErrors: payload.errors };
  }

  const creds = await loadCreds(companyId, env);
  if (!creds.ewbUsername || !creds.ewbPasswordEnc) {
    throw Object.assign(
      new Error("Direct e-way bills need EWB-portal credentials (Company Settings → EWB portal section) — the EWB system is separate from the e-invoice IRP."),
      { statusCode: 400 },
    );
  }

  const inserted = await db
    .insert(irpSubmissions)
    .values({ companyId, voucherId, kind: "ewaybill", status: "pending", requestedBy })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    const block2 = await existingBlocking(voucherId, "ewaybill");
    return { ok: false, duplicate: true, submission: block2 ? maskSubmission(block2) : undefined };
  }
  const rowId = inserted[0].id;
  try {
    // v1.03 response: { ewayBillNo, ewayBillDate, validUpto, alert } — the
    // EwbNo alias is tolerated defensively (mirror casing varies).
    const resp = (await ewbAction(creds, "GENEWB", payload.payload)) as any;
    const ewbNo = resp.ewayBillNo ?? resp.EwbNo ?? null;
    const accepted = ewbNo != null;
    const updated = await db.update(irpSubmissions).set({
      status: accepted ? "accepted" : "rejected",
      ewbNo: accepted ? String(ewbNo) : null,
      ewbValidUntil: resp.validUpto ?? resp.ValidUpto ?? null,
      response: resp,
      error: accepted ? null : (resp.errorDetails ?? resp.ErrorDetails ?? [{ errorMessage: "EWB-API did not return an e-way bill number" }]),
    }).where(eq(irpSubmissions.id, rowId)).returning();
    return { ok: accepted, irpErrors: accepted ? undefined : updated[0].error, submission: maskSubmission(updated[0]) };
  } catch (e: any) {
    // Same split as every submission: a business rejection from the portal
    // (Status 0 + error details) = 'rejected' — fix and retry; a transport/
    // decryption failure = 'error' — zprime-side problem. Verbatim either way.
    const rejected = Array.isArray(e?.irpErrors);
    const updated = await db.update(irpSubmissions).set({ status: rejected ? "rejected" : "error", error: { message: e?.message ?? String(e), irpErrors: e?.irpErrors ?? null } }).where(eq(irpSubmissions.id, rowId)).returning();
    return { ok: false, irpErrors: e?.irpErrors ?? e?.message, submission: maskSubmission(updated[0]) };
  }
}

export async function submissionHistory(companyId: number, voucherId?: number) {
  const rows = voucherId != null
    ? await db.select().from(irpSubmissions).where(and(eq(irpSubmissions.companyId, companyId), eq(irpSubmissions.voucherId, voucherId)))
    : await db.select().from(irpSubmissions).where(eq(irpSubmissions.companyId, companyId));
  return rows.sort((a, b) => b.id - a.id).map(maskSubmission);
}

// ---------- R-29: EWB lifecycle operations ----------
// All three ops are operations ON the accepted ewaybill submission row (not
// new submissions), so the partial-unique idempotency model is untouched.
// Every op attempt is recorded verbatim in irp_ewb_ops — success AND failure
// — before/after the wire call. Eager guards refuse impossible ops BEFORE any
// network call; NIC-side time windows (24h cancel, 8h extend) are enforced by
// NIC itself and surfaced verbatim when it rejects.

const EWB_EXTEND_REASONS = ["vehicle_breakdown", "law_and_order", "accident", "natural_calamity", "transshipment", "others"];
const EWB_CANCEL_REASONS = ["duplicate", "data_entry_mistake", "order_cancelled", "others"];

interface EwbCtx { creds: IrpCredsRow; ewbRow: any; ewbNo: string }

async function loadAcceptedEwb(companyId: number, voucherId: number, env: string): Promise<EwbCtx> {
  const rows = await db
    .select()
    .from(irpSubmissions)
    .where(and(eq(irpSubmissions.companyId, companyId), eq(irpSubmissions.voucherId, voucherId), eq(irpSubmissions.kind, "ewaybill")));
  const ewbRow = rows.find((r) => r.status === "accepted");
  if (!ewbRow || !ewbRow.ewbNo) {
    throw Object.assign(new Error("No accepted e-way bill for this voucher — generate one first (GSTR-1 → ewb)."), { statusCode: 400 });
  }
  // Credentials resolve per (company, env) exactly as GENEWB did at birth —
  // the routes pass the operator's active environment through.
  return { creds: await loadCreds(companyId, env), ewbRow, ewbNo: String(ewbRow.ewbNo) };
}

async function recordEwbOp(companyId: number, submissionId: number, requestedBy: number, op: string, request: unknown, patch: { response?: unknown; error?: unknown }) {
  await db.insert(irpEwbOps).values({
    companyId, submissionId, op, request: request as any, response: (patch.response ?? null) as any,
    error: (patch.error ?? null) as any, requestedBy,
  });
}

function opError(e: any): { ok: false; irpErrors?: unknown; error?: string; submission?: unknown } {
  const rejected = Array.isArray(e?.irpErrors);
  return { ok: false, irpErrors: e?.irpErrors ?? e?.message, error: rejected ? undefined : e?.message ?? String(e), };
}

/** NIC VEHEWB — update the vehicle (Part-B). Repeatable per NIC (every change
 *  is logged); zprime refuses nothing except the absence of an accepted EWB
 *  and malformed input. */
export async function updateEwbVehicle(
  companyId: number, voucherId: number, requestedBy: number, partB: Record<string, unknown>, env = "sandbox",
): Promise<SubmitResult> {
  const { creds, ewbRow, ewbNo } = await loadAcceptedEwb(companyId, voucherId, env);
  const vehicleNo = String(partB.vehicleNo ?? "").trim();
  if (!vehicleNo) return { ok: false, validationErrors: ["vehicleNo is required"] };
  if (partB.transMode && String(partB.transMode).toLowerCase() !== "road") {
    return { ok: false, validationErrors: ["vehicleNo applies only to road transport — drop it or set transMode=road"] };
  }
  const req = { ewbNo, vehicleNo, fromPlace: partB.fromPlace ?? null, fromState: partB.fromState ?? null, transDocNo: partB.transDocNo ?? null, transDocDate: partB.transDocDate ?? null, transMode: "road" };
  const inserted = await db.insert(irpEwbOps).values({ companyId, submissionId: ewbRow.id, op: "vehewb", request: req as any, requestedBy }).returning();
  const opId = inserted[0].id;
  try {
    const resp = (await irpAction(creds, "VEHEWB", req, "/eivital/v1.10/vehewb")) as any;
    await db.update(irpEwbOps).set({ response: resp }).where(eq(irpEwbOps.id, opId));
    return { ok: true, submission: maskSubmission({ ...ewbRow, response: resp }) };
  } catch (e: any) {
    await db.update(irpEwbOps).set({ error: { message: e?.message ?? String(e), irpErrors: e?.irpErrors ?? null } }).where(eq(irpEwbOps.id, opId));
    return opError(e);
  }
}

/** NIC EXTENDVALIDITY — one extension per EWB, ever (eager guard); the 8h
 *  before/after-expiry window is enforced by NIC and surfaced verbatim.
 *  Requires reason enum + remaining distance; validity recalculated by NIC. */
export async function extendEwbValidity(
  companyId: number, voucherId: number, requestedBy: number, args: Record<string, unknown>, env = "sandbox",
): Promise<SubmitResult> {
  const { creds, ewbRow, ewbNo } = await loadAcceptedEwb(companyId, voucherId, env);
  const reasonCode = String(args.reasonCode ?? "");
  const remainFrom = String(args.remainFrom ?? "").trim();
  if (!EWB_EXTEND_REASONS.includes(reasonCode)) return { ok: false, validationErrors: [`reasonCode must be one of: ${EWB_EXTEND_REASONS.join(", ")}`] };
  if (!remainFrom) return { ok: false, validationErrors: ["remainFrom (place the vehicle is currently at) is required"] };
  const remainFromState = String(args.remainFromState ?? "").trim();
  if (!remainFromState) return { ok: false, validationErrors: ["remainFromState (current state code) is required"] };
  const remainingDistance = Number(args.remainingDistance);
  if (!Number.isFinite(remainingDistance) || remainingDistance <= 0) return { ok: false, validationErrors: ["remainingDistance (km) must be a positive number"] };

  // Eager once-ever guard: a successful prior extension is an op row whose
  // response carries the extended validity. (Failures don't consume the one
  // shot — NIC never accepted them.)
  const prior = await db.select().from(irpEwbOps)
    .where(and(eq(irpEwbOps.submissionId, ewbRow.id), eq(irpEwbOps.op, "extend")));
  if (prior.some((p) => p.response != null && (p.error == null))) {
    return { ok: false, validationErrors: ["Only one extension is permitted per e-way bill (NIC rule) — generate a fresh EWB for the remaining movement."] };
  }

  const req = { ewbNo, vehicleNo: args.vehicleNo ?? null, fromPlace: remainFrom, fromState: remainFromState, remainingDistance, reasonCode, remark: args.remark ?? null };
  const inserted = await db.insert(irpEwbOps).values({ companyId, submissionId: ewbRow.id, op: "extend", request: req as any, requestedBy }).returning();
  const opId = inserted[0].id;
  try {
    const resp = (await irpAction(creds, "EXTENDVALIDITY", req, "/eivital/v1.10/extendvalidity")) as any;
    await db.update(irpEwbOps).set({ response: resp }).where(eq(irpEwbOps.id, opId));
    // Persist the recalculated validity when NIC returns it.
    const validUpto = resp.ValidUpto ?? resp.validUpto ?? null;
    if (validUpto) await db.update(irpSubmissions).set({ ewbValidUntil: String(validUpto) }).where(eq(irpSubmissions.id, ewbRow.id));
    return { ok: true, submission: maskSubmission({ ...ewbRow, ewbValidUntil: validUpto ?? ewbRow.ewbValidUntil }) };
  } catch (e: any) {
    await db.update(irpEwbOps).set({ error: { message: e?.message ?? String(e), irpErrors: e?.irpErrors ?? null } }).where(eq(irpEwbOps.id, opId));
    return opError(e);
  }
}

/** NIC CANEWB — cancel within 24h of generation (eager pre-check against the
 *  submission's created_at, our documented approximation of NIC's generation
 *  timestamp), NIC enforces the not-verified-at-checkpost rule itself. The
 *  accepted row flips to status='cancelled' (retained verbatim — legal
 *  record), which re-opens (voucher, kind) so a fresh EWB can be generated. */
export async function cancelEwb(
  companyId: number, voucherId: number, requestedBy: number, args: Record<string, unknown>, env = "sandbox",
): Promise<SubmitResult> {
  const { creds, ewbRow, ewbNo } = await loadAcceptedEwb(companyId, voucherId, env);
  const reasonCode = String(args.reasonCode ?? "");
  if (!EWB_CANCEL_REASONS.includes(reasonCode)) return { ok: false, validationErrors: [`reasonCode must be one of: ${EWB_CANCEL_REASONS.join(", ")}`] };
  const remark = String(args.remark ?? "").trim();
  if (!remark) return { ok: false, validationErrors: ["remark is required"] };

  const ageMs = Date.now() - new Date(ewbRow.createdAt).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) {
    return { ok: false, validationErrors: ["Cancellation is only possible within 24 hours of e-way bill generation (NIC rule) — the window has passed."] };
  }

  const req = { ewbNo, reasonCode, remark };
  const inserted = await db.insert(irpEwbOps).values({ companyId, submissionId: ewbRow.id, op: "cancel", request: req as any, requestedBy }).returning();
  const opId = inserted[0].id;
  try {
    const resp = (await irpAction(creds, "CANEWB", req, "/eivital/v1.10/canewb")) as any;
    await db.update(irpEwbOps).set({ response: resp }).where(eq(irpEwbOps.id, opId));
    const updated = await db.update(irpSubmissions).set({ status: "cancelled", error: { message: `cancelled on the NIC: ${reasonCode} — ${remark}` } }).where(eq(irpSubmissions.id, ewbRow.id)).returning();
    return { ok: true, submission: maskSubmission(updated[0]) };
  } catch (e: any) {
    await db.update(irpEwbOps).set({ error: { message: e?.message ?? String(e), irpErrors: e?.irpErrors ?? null } }).where(eq(irpEwbOps.id, opId));
    return opError(e);
  }
}

/** Route-shape masking: the row is safe to return — secrets never live here —
 *  but response blobs are trimmed of nothing (they are IRP-verbatim). Kept as
 *  a named function so a future field addition cannot leak by accident. */
function maskSubmission(row: any) {
  return row;
}

// re-export for the boot check in index.ts
export { irpKeyFromEnv };
