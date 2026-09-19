#!/usr/bin/env node
// R-28 mock IRP — an in-suite stand-in for the NIC e-invoice API that speaks
// the REAL wire format: RSA-encrypted credentials (the test generates the
// keypair and hands us the private key), AppKey→SEK handshake, AES-256-ECB
// payload/response encryption, and auth-token enforcement. It exists so the
// connectivity regression proves zprime's crypto and idempotency behavior
// end-to-end without touching government infrastructure.
//
// Endpoints:
//   POST /eivital/v1.10/auth     → { Status, Authtoken, Sek, ExpInHrs }
//   POST /eivital/v1.10/genirn   → { Status, Data } (Data = SEK-encrypted response)
//   POST /eivital/v1.10/genewb   → same envelope; EwbNo derived from the IRN
//   POST /eivital/v1.10/vehewb          → vehicle update accepted (InfoDtls logged)
//   POST /eivital/v1.10/extendvalidity  → ValidUpto extended (once per ewbNo)
//   POST /eivital/v1.10/canewb          → cancel accepted within mock's window
//   GET  /__pubkey               → { publicKeyPem } (when self-keyed — lets suites
//                                  discover the key without sharing files)
//   GET  /__stats                → { authCalls, genirnCalls, genewbCalls, vehewbCalls, extendCalls, cancelCalls } (test assertions)
//   POST /__reject               → { invoiceNo } — next GENIRN for that number is rejected
//   POST /__failaction           → { action } — next call for that action returns an IRP error
//   POST /__expire               → { ewbNo } — mark an EWB older than 24h (cancel-window test)
//
// Self-keyed mode: run WITHOUT --private-key and the mock generates its own
// keypair in-memory (compose test-profile sidecar; the suite reads /__pubkey).
// Usage: node scripts/mock_irp.js --port 3199 --private-key /tmp/irp_test_key.pem
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";

const args = process.argv.slice(2);
const port = parseInt(args[args.indexOf("--port") + 1] ?? "3199", 10);
const privKeyFlagIdx = args.indexOf("--private-key");
const privKeyPath = privKeyFlagIdx >= 0 ? args[privKeyFlagIdx + 1] : undefined;
const priv = privKeyPath
  ? crypto.createPrivateKey(fs.readFileSync(privKeyPath, "utf8"))
  : crypto.createPrivateKey(crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }));

const stats = { authCalls: 0, genirnCalls: 0, genewbCalls: 0, vehewbCalls: 0, extendCalls: 0, cancelCalls: 0 };
const sessions = new Map(); // authtoken → { sek: Buffer }
const rejectNext = new Set(); // invoice numbers to reject once
const failAction = new Map(); // action → pending IRP-style failure (one shot)
const ewbBornAt = new Map(); // ewbNo → birth epoch ms (cancel-window simulation)
const expired = new Set(); // ewbNos force-aged past the 24h cancel window
const extended = new Set(); // ewbNos already extended (once-ever rule, NIC-side)

function rsaDec(b64) {
  return crypto.privateDecrypt({ key: priv, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(b64, "base64"));
}
function ecbEnc(key, obj) {
  const c = crypto.createCipheriv("aes-256-ecb", key, null);
  return Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]).toString("base64");
}
function ecbDec(key, b64) {
  const d = crypto.createDecipheriv("aes-256-ecb", key, null);
  return JSON.parse(Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]).toString("utf8"));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (ch) => (raw += ch));
    req.on("end", () => resolve(raw));
  });
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  let json = {};
  try { json = body ? JSON.parse(body) : {}; } catch { /* leave empty */ }
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (req.url === "/__stats") return send(200, stats);
  if (req.url === "/__pubkey") return send(200, { publicKeyPem: crypto.createPublicKey(priv).export({ type: "spki", format: "pem" }).toString() });
  if (req.url === "/__reject") { rejectNext.add(json.invoiceNo); return send(200, { ok: true }); }
  if (req.url === "/__failaction") { failAction.set(json.action, json.error ?? [{ ErrorCode: "9999", ErrorMessage: "mock forced failure" }]); return send(200, { ok: true }); }
  if (req.url === "/__expire") { expired.add(json.ewbNo); return send(200, { ok: true }); }

  if (req.url === "/eivital/v1.10/auth") {
    stats.authCalls++;
    try {
      const appKey = rsaDec(json.AppKey);
      const sek = crypto.randomBytes(32);
      const c = crypto.createCipheriv("aes-256-ecb", appKey, null);
      const sekEnc = Buffer.concat([c.update(sek), c.final()]).toString("base64");
      const authtoken = crypto.randomUUID();
      sessions.set(authtoken, { sek });
      return send(200, { Status: 1, Authtoken: authtoken, Sek: sekEnc, ExpInHrs: 1 });
    } catch (e) {
      return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "AUTH", ErrorMessage: "decryption failed: " + e.message }] });
    }
  }

  const sess = sessions.get(req.headers["auth-token"]);
  if (!sess) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "TOKEN", ErrorMessage: "invalid or expired authtoken" }] });

  let payload;
  try { payload = ecbDec(sess.sek, json.payload); } catch (e) {
    return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "PAYLOAD", ErrorMessage: "payload decryption failed: " + e.message }] });
  }

  if (req.url === "/eivital/v1.10/genirn") {
    stats.genirnCalls++;
    const invNo = payload?.RefDtls?.InvNo ?? payload?.DocDtls?.No ?? "unknown";
    if (rejectNext.has(invNo)) {
      rejectNext.delete(invNo);
      return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "3095", ErrorMessage: `mock rejection for ${invNo}` }] });
    }
    const irn = crypto.createHash("sha256").update(invNo + payload?.SellerDtls?.Gstin).digest("hex");
    return send(200, { Status: 1, Data: ecbEnc(sess.sek, { Irn: irn, AckNo: Math.floor(Math.random() * 1e12), AckDt: new Date().toISOString().slice(0, 19) }) });
  }

  if (req.url === "/eivital/v1.10/genewb") {
    stats.genewbCalls++;
    if (!payload?.Irn) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "4002", ErrorMessage: "Irn required" }] });
    const ewbNo = "93" + String(Math.floor(Math.random() * 1e10));
    ewbBornAt.set(ewbNo, Date.now());
    return send(200, { Status: 1, Data: ecbEnc(sess.sek, { EwbNo: ewbNo, EwbDt: new Date().toISOString().slice(0, 10), ValidUpto: "2026-09-20 23:59:00" }) });
  }

  // ---- R-29 lifecycle ops (same SEK envelope) ----
  const fail = failAction.get(req.url.split("/").pop());
  const failAndClear = (action) => {
    const details = failAction.get(action);
    if (!details) return false;
    failAction.delete(action);
    send(200, { Status: 0, ErrorDetails: details });
    return true;
  };

  if (req.url === "/eivital/v1.10/vehewb") {
    stats.vehewbCalls++;
    if (failAndClear("VEHEWB")) return;
    if (!payload?.ewbNo) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "4002", ErrorMessage: "ewbNo required" }] });
    if (!payload?.vehicleNo) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "3001", ErrorMessage: "vehicleNo required" }] });
    return send(200, { Status: 1, Data: ecbEnc(sess.sek, { InfoDtls: [{ InfCd: "VEH", Desc: { vehicleNo: payload.vehicleNo } }], WarnDtls: [] }) });
  }

  if (req.url === "/eivital/v1.10/extendvalidity") {
    stats.extendCalls++;
    if (failAndClear("EXTENDVALIDITY")) return;
    if (!payload?.ewbNo) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "4002", ErrorMessage: "ewbNo required" }] });
    if (extended.has(payload.ewbNo)) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "3120", ErrorMessage: "E-way bill already extended once — extension not allowed" }] });
    if (!payload?.remainingDistance || payload.remainingDistance <= 0) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "3011", ErrorMessage: "remainingDistance required" }] });
    extended.add(payload.ewbNo);
    return send(200, { Status: 1, Data: ecbEnc(sess.sek, { ValidUpto: "2026-09-22 23:59:00", WarnDtls: [] }) });
  }

  if (req.url === "/eivital/v1.10/canewb") {
    stats.cancelCalls++;
    if (failAndClear("CANEWB")) return;
    if (!payload?.ewbNo) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "4002", ErrorMessage: "ewbNo required" }] });
    if (!payload?.remark) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "3012", ErrorMessage: "remark required" }] });
    if (expired.has(payload.ewbNo)) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "3105", ErrorMessage: "Cannot cancel — 24 hours have elapsed since generation" }] });
    const born = ewbBornAt.get(payload.ewbNo) ?? Date.now();
    if (Date.now() - born > 24 * 60 * 60 * 1000) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: "3105", ErrorMessage: "Cannot cancel — 24 hours have elapsed since generation" }] });
    return send(200, { Status: 1, Data: ecbEnc(sess.sek, { CanFlag: "Y", CancellingTime: new Date().toISOString() }) });
  }

  return send(404, { error: "unknown mock endpoint" });
});
server.listen(port, () => console.log(`mock IRP on ${port}`));
