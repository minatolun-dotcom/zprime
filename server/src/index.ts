import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { existsSync } from "node:fs";
import { runMigrations } from "./db/index.js";
import authPlugin, { hashPassword } from "./plugins/auth.js";
import { db } from "./db/index.js";
import { users, companies, irpCredentials } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./lib/crypto.js";

import authRoutes from "./routes/auth.js";
import companyRoutes from "./routes/companies.js";
import masterRoutes from "./routes/masters.js";
import voucherRoutes from "./routes/vouchers.js";
import reportRoutes from "./routes/reports.js";
import payrollRoutes from "./routes/payroll.js";
import importRoutes from "./routes/import.js";
import bankingRoutes from "./routes/banking.js";

const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });

// Raw-body parser for XML imports: accounting exports are POSTed as
// application/xml or text/xml, which Fastify would otherwise reject with 415.
const XML_RE = /^(application|text)\/xml(\s*;|$)/;
app.addContentTypeParser(XML_RE, { parseAs: "string", bodyLimit: 64 * 1024 * 1024 }, (_req, body, done) => {
  done(null, body);
});

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(multipart);
await app.register(authPlugin);

app.get("/api/health", async () => ({ ok: true }));

// Global error sanitizer. Everything reaching the client is either an intended
// 4xx (statusCode set by bad()/pgFriendly) or a generic 500 with NO internals —
// no SQL, no stack traces, no paths, no driver messages.
app.setErrorHandler((err: any, req, reply) => {
  const status = (err as any)?.statusCode ?? (err as any)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return reply.code(status).send({ error: err.message });
  }
  const isBodyParse = String((err as any)?.code ?? "").startsWith("FST_ERR");
  if (isBodyParse) return reply.code(400).send({ error: "Malformed request" });
  console.error(`[zprime] 500 on ${req.method} ${req.url}:`, err);
  return reply.code(500).send({ error: "Internal server error" });
});

// Query-string date filters: reject malformed values with 400 instead of a raw
// SQL "invalid input syntax for type date" 500 deep in the driver.
app.addHook("onRequest", async (req) => {
  const q = (req.query as any) ?? {};
  const re = /^\d{4}-\d{2}-\d{2}$/;
  for (const k of ["from", "to", "asOf", "refDate"]) {
    const v = q[k];
    if (v === undefined || v === "") continue;
    const s = String(v);
    if (!re.test(s)) throw Object.assign(new Error(`Invalid date in query: ${k}`), { statusCode: 400 });
    const dt = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== s) {
      throw Object.assign(new Error(`Invalid date in query: ${k}`), { statusCode: 400 });
    }
  }
});

await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(companyRoutes, { prefix: "/api" });
await app.register(masterRoutes, { prefix: "/api/c/:cid" });
await app.register(voucherRoutes, { prefix: "/api/c/:cid" });
await app.register(reportRoutes, { prefix: "/api/c/:cid/reports" });
await app.register(payrollRoutes, { prefix: "/api/c/:cid" });
await app.register(importRoutes, { prefix: "/api/c/:cid/import" });
await app.register(bankingRoutes, { prefix: "/api/c/:cid" });

// Serve built client (production/Docker, or repo root when run from source)
const clientDistCandidates = [
  process.env.CLIENT_DIST,
  path.resolve(process.cwd(), "../client/dist"),
  path.resolve(process.cwd(), "client/dist"),
].filter(Boolean) as string[];
const clientDist = clientDistCandidates.find((p) => existsSync(p));
if (clientDist) {
  await app.register(fastifyStatic, { root: clientDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);

await runMigrations();

// Seed default admin user if none exists
const existing = await db.select({ id: users.id }).from(users).limit(1);
if (existing.length === 0) {
  // R-09 (B-08): the first-boot admin password must come from the operator.
  // The old "admin123" fallback seeded well-known credentials on every fresh
  // deployment. When users already exist this variable is irrelevant.
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.trim() === "") {
    throw new Error(
      "Refusing to seed the admin user: ADMIN_PASSWORD is not set. " +
        "Set it in .env (cp .env.example .env) and restart.",
    );
  }
  await db.insert(users).values({
    username: process.env.ADMIN_USER ?? "admin",
    passwordHash: hashPassword(adminPassword),
  });
  console.log(`Created default admin user: ${process.env.ADMIN_USER ?? "admin"}`);
}

// R-28 boot check: encrypted credentials must be readable with the current
// IRP_ENC_KEY before serving traffic — a missing/rotated key must fail fast
// (R-09 posture), never surface as request-time 500s.
const irpCount = await db.$count(irpCredentials);
if (irpCount > 0) {
  const probe = await db.select({ blob: irpCredentials.clientSecretEnc }).from(irpCredentials).limit(1);
  try {
    decryptSecret(probe[0].blob);
  } catch {
    throw new Error(
      "IRP credentials exist but cannot be decrypted with the current IRP_ENC_KEY " +
        "(missing or rotated). Restore the key in .env — refusing to start to avoid silent corruption.",
    );
  }
}

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`zprime running on http://localhost:${PORT}`);
