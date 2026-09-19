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
//   GET  /__stats                → { authCalls, genirnCalls, genewbCalls } (test assertions)
//   POST /__reject               → { invoiceNo } — next GENIRN for that number is rejected
//
// Usage: node scripts/mock_irp.js --port 3199 --private-key /tmp/irp_test_key.pem
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";

const args = process.argv.slice(2);
const port = parseInt(args[args.indexOf("--port") + 1] ?? "3199", 10);
const privKeyPath = args[args.indexOf("--private-key") + 1];
const priv = crypto.createPrivateKey(fs.readFileSync(privKeyPath, "utf8"));

const stats = { authCalls: 0, genirnCalls: 0, genewbCalls: 0 };
const sessions = new Map(); // authtoken → { sek: Buffer }
const rejectNext = new Set(); // invoice numbers to reject once

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
  if (req.url === "/__reject") { rejectNext.add(json.invoiceNo); return send(200, { ok: true }); }

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
    return send(200, { Status: 1, Data: ecbEnc(sess.sek, { EwbNo: "93" + String(Math.floor(Math.random() * 1e10)), EwbDt: new Date().toISOString().slice(0, 10), ValidUpto: "2026-09-20 23:59:00" }) });
  }

  return send(404, { error: "unknown mock endpoint" });
});
server.listen(port, () => console.log(`mock IRP on ${port}`));
