// R-85: the backup engine — in-app, no host tools.
//
// A backup run is: spawn pg_dump (in-image postgresql16-client, PG* env parsed
// from DATABASE_URL — argv carries no secrets) → gzip to a temp file → sha256
// of the .gz bytes (what gets uploaded and later downloaded) → sidecar
// manifest JSON → multipart upload of both files to the operator's Drive
// folder → retention prune (remote, dump+manifest kept as a pair). A restore
// run is: download dump + manifest → verify sha256 byte-exact (refuse on
// mismatch) → spawn psql against the `postgres` database (terminate other
// connections, drop/recreate the app database, then -f the decompressed dump
// — psql handles the dump's COPY FROM stdin natively). The app's own pool
// connections are terminated by that step; postgres.js recreates sockets
// lazily, proven by the suite querying immediately after a restore.
//
// Concurrency: one run at a time (module-level lock); schedule-driven runs
// are made idempotent across restarts by last_scheduled_date (the in-process
// analogue of the host timer's Persistent=true).
//
// No shell: every child process uses execFile/spawn with an args array; the
// DB password travels only via the child's PGPASSWORD env.

import { spawn, execFile } from "node:child_process";
import { pipeline } from "node:stream/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import { backupRuns, backupSettings, users } from "../db/schema.js";
import { desc, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import * as drive from "../lib/gdrive.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

interface PgTarget {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

function pgTarget(): PgTarget {
  const u = new URL(DATABASE_URL);
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a postgres:// URL");
  }
  return {
    host: u.hostname || "db",
    port: u.port || "5432",
    user: decodeURIComponent(u.username || "zprime"),
    password: decodeURIComponent(u.password || ""),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "zprime",
  };
}

function childEnv(target: PgTarget, database = target.database): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: target.host,
    PGPORT: target.port,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGDATABASE: database,
    PGSSLMODE: "disable",
  };
}

export interface SettingsView {
  clientId: string | null;
  hasClientSecret: boolean;
  // R-28 masking rule: secrets never leave the box — last 4 only, derived
  // server-side, so the UI can show "stored: ••••1234" without the value.
  clientSecretLast4: string | null;
  connected: boolean;
  folderName: string;
  scheduleKind: "off" | "daily" | "weekly";
  scheduleDow: number | null;
  scheduleHhmm: string;
  retentionCount: number;
  enabled: boolean;
  lastRunAt: Date | null;
}

export async function getSettings(): Promise<SettingsView> {
  await ensureRow();
  const [s] = await db.select().from(backupSettings).where(eq(backupSettings.id, 1));
  return {
    clientId: s.clientId,
    hasClientSecret: s.clientSecretEnc != null,
    clientSecretLast4: s.clientSecretEnc ? decryptSecret(s.clientSecretEnc).slice(-4) : null,
    connected: s.refreshTokenEnc != null,
    folderName: s.folderName,
    scheduleKind: s.scheduleKind as SettingsView["scheduleKind"],
    scheduleDow: s.scheduleDow,
    scheduleHhmm: s.scheduleHhmm,
    retentionCount: s.retentionCount,
    enabled: s.enabled,
    lastRunAt: s.lastRunAt,
  };
}

async function ensureRow() {
  await db.insert(backupSettings).values({ id: 1 }).onConflictDoNothing();
}

export interface SettingsPatch {
  clientId?: string;
  clientSecret?: string; // plaintext from the operator; omitted = unchanged (R-28 pattern)
  folderName?: string;
  scheduleKind?: "off" | "daily" | "weekly";
  scheduleDow?: number | null;
  scheduleHhmm?: string;
  retentionCount?: number;
  enabled?: boolean;
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  await ensureRow();
  const values: Record<string, unknown> = {};
  if (patch.clientId !== undefined) values.clientId = patch.clientId || null;
  if (patch.clientSecret !== undefined && patch.clientSecret !== "")
    values.clientSecretEnc = encryptSecret(patch.clientSecret);
  if (patch.folderName !== undefined && patch.folderName.trim() !== "")
    values.folderName = patch.folderName.trim().slice(0, 100);
  if (patch.scheduleKind !== undefined) values.scheduleKind = patch.scheduleKind;
  if (patch.scheduleDow !== undefined) values.scheduleDow = patch.scheduleDow;
  if (patch.scheduleHhmm !== undefined && /^\d{2}:\d{2}$/.test(patch.scheduleHhmm))
    values.scheduleHhmm = patch.scheduleHhmm;
  if (patch.retentionCount !== undefined)
    values.retentionCount = Math.min(365, Math.max(1, Math.trunc(patch.retentionCount)));
  if (patch.enabled !== undefined) values.enabled = patch.enabled;
  if (Object.keys(values).length) {
    await db.update(backupSettings).set(values).where(eq(backupSettings.id, 1));
  }
}

/** OAuth exchange credentials (client id + decrypted secret) — used by the
 *  routes layer for the authorize-URL and the callback's code exchange. */
export async function oauthCreds(): Promise<{ clientId: string; clientSecret: string }> {
  await ensureRow();
  const [s] = await db.select().from(backupSettings).where(eq(backupSettings.id, 1));
  if (!s.clientId || !s.clientSecretEnc) throw new Error("Google Drive is not configured (client credentials missing)");
  return { clientId: s.clientId, clientSecret: decryptSecret(s.clientSecretEnc) };
}

/** Store the OAuth refresh token (callback step) — connect complete. */
export async function storeRefreshToken(refreshToken: string): Promise<void> {
  await ensureRow();
  await db
    .update(backupSettings)
    .set({ refreshTokenEnc: encryptSecret(refreshToken) })
    .where(eq(backupSettings.id, 1));
}

/** Disconnect: best-effort Google-side revocation, then wipe the stored
 *  token (the client secret survives — reconnect is one consent away). */
export async function disconnect(): Promise<void> {
  await ensureRow();
  const [s] = await db.select().from(backupSettings).where(eq(backupSettings.id, 1));
  if (s.refreshTokenEnc) {
    try {
      await drive.revokeToken(decryptSecret(s.refreshTokenEnc));
    } catch {
      // best-effort; local wipe happens regardless
    }
  }
  await db.update(backupSettings).set({ refreshTokenEnc: null }).where(eq(backupSettings.id, 1));
}

async function driveCreds(): Promise<drive.DriveCreds> {
  const [s] = await db.select().from(backupSettings).where(eq(backupSettings.id, 1));
  if (!s.clientId || !s.clientSecretEnc) throw new Error("Google Drive is not configured (client credentials missing)");
  if (!s.refreshTokenEnc) throw new Error("Google Drive is not connected");
  return {
    clientId: s.clientId,
    clientSecret: decryptSecret(s.clientSecretEnc),
    refreshToken: decryptSecret(s.refreshTokenEnc),
  };
}

let inFlight = false;

/** Run a backup. Returns metadata for the API + history row. */
export async function runBackup(trigger: "schedule" | "manual", actorId: number): Promise<{ fileName: string; size: number; sha256: string; driveFileId: string }> {
  if (inFlight) throw new Error("A backup or restore is already running");
  inFlight = true;
  const startedAt = new Date();
  const target = pgTarget();
  const gzPath = path.join(os.tmpdir(), `zprime-backup-${crypto.randomBytes(6).toString("hex")}.sql.gz`);
  try {
    // pg_dump → gzip → temp file (streamed; the dump never sits in memory).
    // The run succeeds only when BOTH the pipeline completed AND the process
    // exited 0 — a non-zero pg_dump is a failed backup even if stdout ended.
    const { createGzip } = await import("node:zlib");
    await new Promise<void>((resolve, reject) => {
      let streamDone = false;
      let closeCode: number | null = null;
      let settled = false;
      const decide = () => {
        if (settled || !streamDone || closeCode === null) return;
        settled = true;
        if (closeCode === 0) resolve();
        else reject(new Error(`pg_dump exited with code ${closeCode}`));
      };
      const child = spawn("pg_dump", [], { env: childEnv(target) });
      child.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
      child.stderr.on("data", (d) => {
        const msg = String(d);
        if (/error|warning/i.test(msg)) console.error(`[backup] pg_dump: ${msg.trim().slice(0, 300)}`);
      });
      child.on("close", (code) => { closeCode = code; decide(); });
      pipeline(child.stdout, createGzip(), fs.createWriteStream(gzPath))
        .then(() => { streamDone = true; decide(); })
        .catch((e) => { if (!settled) { settled = true; reject(e instanceof Error ? e : new Error(String(e))); } });
    });
    // Read back the bytes we will upload — the sha256 covers exactly those.
    const gzBytes = await fs.promises.readFile(gzPath);
    const sha256 = crypto.createHash("sha256").update(gzBytes).digest("hex");
    // Second-resolution stamps collide on rapid successive runs (retention
    // bursts, tests) — a shared name would merge two pairs in the Drive
    // folder and corrupt retention/restore pairing. Add a uniqueness tail.
    const stamp = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${crypto.randomBytes(2).toString("hex")}`;
    const baseName = `zprime-${stamp}`;
    const dumpName = `${baseName}.sql.gz`;
    const manifestName = `${baseName}.manifest.json`;
    const manifest = Buffer.from(
      JSON.stringify(
        {
          app: "zprime",
          created_at: new Date().toISOString(),
          format: "pg_dump plain sql, gzipped",
          file: dumpName,
          bytes: gzBytes.length,
          sha256,
          pg_dump_version: await pgDumpVersion(),
        },
        null,
        2,
      ),
    );

    const creds = await driveCreds();
    const folderId = await drive.ensureFolder(creds, (await getSettings()).folderName);
    const dumpFileId = await drive.uploadFile(creds, folderId, dumpName, "application/gzip", gzBytes);
    await drive.uploadFile(creds, folderId, manifestName, "application/json", manifest);

    await pruneRemote(creds, folderId);

    const finishedAt = new Date();
    await db.insert(backupRuns).values({
      kind: "backup", trigger, status: "ok", startedAt, finishedAt,
      fileName: dumpName, fileSize: gzBytes.length, sha256, driveFileId: dumpFileId, actorId,
    });
    await db.update(backupSettings).set({ lastRunAt: finishedAt }).where(eq(backupSettings.id, 1));
    return { fileName: dumpName, size: gzBytes.length, sha256, driveFileId: dumpFileId };
  } catch (err: any) {
    await db.insert(backupRuns).values({
      kind: "backup", trigger, status: "error", startedAt, finishedAt: new Date(),
      error: String(err?.message ?? err).slice(0, 500), actorId,
    }).catch(() => undefined);
    throw err;
  } finally {
    await fs.promises.rm(gzPath, { force: true }).catch(() => undefined);
    inFlight = false;
  }
}

async function pgDumpVersion(): Promise<string> {
  return new Promise((resolve) => {
    execFile("pg_dump", ["--version"], (err, stdout) => resolve(err ? "unknown" : String(stdout).trim()));
  });
}

/** Remote retention: list the folder, group dump+manifest by base name, keep
 *  the newest N pairs, delete the rest (never the folder itself). */
async function pruneRemote(creds: drive.DriveCreds, folderId: string): Promise<void> {
  const [s] = await db.select().from(backupSettings).where(eq(backupSettings.id, 1));
  const keep = Math.max(1, s.retentionCount);
  const files = await drive.listFiles(creds, folderId);
  const byBase = new Map<string, drive.DriveFileInfo[]>();
  for (const f of files) {
    const base = f.name.replace(/\.(sql\.gz|manifest\.json)$/, "");
    if (!/^zprime-\d{4}-\d{2}-\d{2}T/.test(base)) continue;
    const list = byBase.get(base) ?? [];
    list.push(f);
    byBase.set(base, list);
  }
  const bases = [...byBase.keys()].sort().reverse(); // newest first
  for (const base of bases.slice(keep)) {
    for (const f of byBase.get(base) ?? []) {
      await drive.deleteFile(creds, f.id).catch(() => undefined);
    }
  }
}

/** Restore a named backup (the operator picks the dump from the remote list).
 *  The dump is downloaded, byte-verified against its manifest, and only then
 *  applied. Returns the run metadata. */
export async function restoreBackup(baseName: string, actorId: number): Promise<{ fileName: string; sha256: string }> {
  if (inFlight) throw new Error("A backup or restore is already running");
  inFlight = true;
  const startedAt = new Date();
  const target = pgTarget();
  const gzPath = path.join(os.tmpdir(), `zprime-restore-${crypto.randomBytes(6).toString("hex")}.sql.gz`);
  const sqlPath = `${gzPath.slice(0, -3)}.sql`;
  try {
    const creds = await driveCreds();
    const folderId = await drive.ensureFolder(creds, (await getSettings()).folderName);
    const files = await drive.listFiles(creds, folderId);
    const dump = files.find((f) => f.name === `${baseName}.sql.gz`);
    const manifest = files.find((f) => f.name === `${baseName}.manifest.json`);
    if (!dump || !manifest) throw new Error("Backup pair not found in the Drive folder");
    const manifestBytes = await drive.downloadFile(creds, manifest.id);
    const meta = JSON.parse(manifestBytes.toString("utf8")) as { file?: string; sha256?: string };
    if (meta.file !== dump.name || !meta.sha256) throw new Error("Manifest does not match this dump — refusing to restore");
    const dumpBytes = await drive.downloadFile(creds, dump.id);
    const actual = crypto.createHash("sha256").update(dumpBytes).digest("hex");
    if (actual !== meta.sha256) {
      throw new Error(`Integrity check FAILED (sha256 mismatch: expected ${meta.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…) — refusing to restore`);
    }
    await fs.promises.writeFile(gzPath, dumpBytes);

    // Decompress, then hand the plain SQL to psql (COPY FROM stdin is native).
    const gzData = await fs.promises.readFile(gzPath);
    const { gunzipSync } = await import("node:zlib");
    const sqlText = gunzipSync(gzData).toString("utf8");
    // pg_dump from a NEWER major client emits GUC SETs the target server may
    // not know — pg_dump 17+ writes `SET transaction_timeout = 0;` in the
    // preamble and a PG16 server rejects the parameter, aborting the restore
    // at line 13 (before any data; the preamble carries none). Strip exactly
    // that line. With the in-image client (postgresql16-client on a
    // postgres:16 DB) this is a byte-level no-op.
    const filtered = sqlText.replace(/^SET transaction_timeout[^\n]*$/gm, "");
    await fs.promises.writeFile(sqlPath, filtered);

    // Kill other connections, drop, recreate — from the `postgres` database.
    await psql(target, "postgres", [
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target.database}' AND pid <> pg_backend_pid();`,
      `DROP DATABASE IF EXISTS "${target.database}";`,
      `CREATE DATABASE "${target.database}";`,
    ]);
    await psql(target, target.database, [], sqlPath);

    const finishedAt = new Date();
    await db.insert(backupRuns).values({
      kind: "restore", trigger: "manual", status: "ok", startedAt, finishedAt,
      fileName: dump.name, fileSize: dumpBytes.length, sha256: meta.sha256, driveFileId: dump.id, actorId,
    });
    // settings row is restored from the dump — no bookkeeping needed here.
    return { fileName: dump.name, sha256: meta.sha256 };
  } catch (err: any) {
    // The live DB may be gone if we failed mid-restore — recreate empty so the
    // app keeps booting (migrations re-apply at next start; the operator is
    // told loudly). Never leave the instance without a database.
    try {
      await psql(target, "postgres", [`CREATE DATABASE "${target.database}";`]);
    } catch {
      // already exists or cannot connect — nothing more we can do here
    }
    await db.insert(backupRuns).values({
      kind: "restore", trigger: "manual", status: "error", startedAt, finishedAt: new Date(),
      error: String(err?.message ?? err).slice(0, 500), actorId,
    }).catch(() => undefined);
    throw err;
  } finally {
    await fs.promises.rm(gzPath, { force: true }).catch(() => undefined);
    await fs.promises.rm(sqlPath, { force: true }).catch(() => undefined);
    inFlight = false;
  }
}

function psql(target: PgTarget, database: string, statements: string[], file?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-v", "ON_ERROR_STOP=1", "--quiet"];
    for (const st of statements) args.push("-c", st);
    if (file) args.push("-f", file);
    execFile("psql", args, { env: childEnv(target, database), maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`psql failed: ${String(stderr || err.message).slice(0, 400)}`));
      } else {
        resolve(String(stdout));
      }
    });
  });
}

/** List remote backups (newest first): base name + the two Drive files. */
export async function listRemote(): Promise<{ base: string; createdTime: string; size: number | null; dumpFileId: string; manifestFileId: string; sha256: string | null }[]> {    const creds = await driveCreds();
    const folderId = await drive.ensureFolder(creds, (await getSettings()).folderName);
    const files = await drive.listFiles(creds, folderId);
  const byBase = new Map<string, drive.DriveFileInfo[]>();
  for (const f of files) {
    const base = f.name.replace(/\.(sql\.gz|manifest\.json)$/, "");
    if (!/^zprime-\d{4}-\d{2}-\d{2}T/.test(base)) continue;
    const list = byBase.get(base) ?? [];
    list.push(f);
    byBase.set(base, list);
  }
  return [...byBase.entries()]
    .filter(([, pair]) => pair.length === 2)
    .map(([base, pair]) => {
      const dump = pair.find((f) => f.name.endsWith(".sql.gz"))!;
      const manifest = pair.find((f) => f.name.endsWith(".manifest.json"))!;
      return { base, createdTime: dump.createdTime, size: dump.size ? parseInt(dump.size, 10) : null, dumpFileId: dump.id, manifestFileId: manifest.id, sha256: null };
    })
    .sort((a, b) => b.base.localeCompare(a.base));
}

/** Deployment-level audit row for connect/disconnect (backup_runs is the
 *  audit trail for this surface — audit_events is company-scoped). */
export async function recordLifecycle(kind: "connect" | "disconnect", actorId: number, error?: string): Promise<void> {
  await db.insert(backupRuns).values({
    kind, trigger: "manual", status: error ? "error" : "ok",
    startedAt: new Date(), finishedAt: new Date(),
    error: error ? String(error).slice(0, 500) : null, actorId,
  });
}

/** Run history (newest first). */
export async function history(limit = 50) {
  return db.select().from(backupRuns).orderBy(desc(backupRuns.id)).limit(Math.min(200, Math.max(1, limit)));
}

/** Scheduler: fires a due daily/weekly backup. Idempotent per calendar day
 *  via last_scheduled_date (survives restarts; the in-process analogue of
 *  Persistent=true on the host timer). Two modes:
 *   - 'tick'  (every minute): fires when the clock hits the exact HH:MM.
 *   - 'boot'  (shortly after start): catches up when the scheduled time has
 *     already passed TODAY and nothing ran — the app was down at HH:MM.
 *  Called from index.ts. */
export async function scheduleTick(mode: "tick" | "boot" = "tick", now = new Date()): Promise<void> {
  try {
    const [s] = await db.select().from(backupSettings).where(eq(backupSettings.id, 1));
    if (!s || !s.enabled || s.scheduleKind === "off") return;
    if (!s.refreshTokenEnc) return;
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const hhmm = `${hh}:${mm}`;
    const today = now.toISOString().slice(0, 10);
    if (s.lastScheduledDate === today) return;
    if (s.scheduleKind === "weekly") {
      const dow = parseInt(String(now.getDay()), 10);
      if (s.scheduleDow !== dow) return;
    }
    if (mode === "tick" ? hhmm !== s.scheduleHhmm : hhmm < s.scheduleHhmm) return;
    await db.update(backupSettings).set({ lastScheduledDate: today }).where(eq(backupSettings.id, 1));
    const [actor] = await db.select({ id: users.id }).from(users).orderBy(users.id).limit(1);
    await runBackup("schedule", actor?.id ?? 1);
  } catch (err: any) {
    // A rig that drops the schema under a live app (or a transient DB blip)
    // would otherwise repeat this log every 60s: log each DISTINCT failure
    // once, restore the message when a later tick succeeds.
    const msg = String(err?.message ?? err).slice(0, 300);
    if (msg !== lastScheduleError) {
      lastScheduleError = msg;
      console.error(`[backups] scheduled run failed: ${msg}`);
    }
  }
}

let lastScheduleError: string | null = null;

export function startScheduler(): void {
  setInterval(() => void scheduleTick("tick"), 60_000).unref();
  // catch-up tick shortly after boot (a missed 02:30 while the app was down)
  setTimeout(() => void scheduleTick("boot"), 15_000).unref();
}
