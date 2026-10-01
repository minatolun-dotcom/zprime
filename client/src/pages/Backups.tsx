import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { Card, ErrorBanner, Field, PageHead } from "../components/ui";
import { get, post, put } from "../lib/api";
import { currentCid } from "../store";

// R-85: in-app backups to Google Drive (UpdraftPlus-style) — deployment-level,
// admin-gated server-side (every /api/backups/* answers a neutral 404 for
// non-admins, mirrored here by the same not-found card the company gate uses).
// Secrets follow the R-28 masking rule: the client secret is stored encrypted
// server-side, shown as last-4 only, and travels ONLY when the operator retypes it.

interface BackupSettings {
  clientId: string | null;
  hasClientSecret: boolean;
  clientSecretLast4: string | null;
  connected: boolean;
  folderName: string;
  scheduleKind: "off" | "daily" | "weekly";
  scheduleDow: number | null;
  scheduleHhmm: string;
  retentionCount: number;
  enabled: boolean;
  lastRunAt: string | null;
}

interface BackupRun {
  id: number;
  kind: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  fileName: string | null;
  fileSize: number | null;
  sha256: string | null;
  error: string | null;
}

interface RemoteBackup {
  base: string;
  createdTime: string;
  size: number | null;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtSize(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtWhen(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function Backups() {
  const qc = useQueryClient();
  const settingsKey = ["backup-settings"];
  const { data: settings, error: settingsErr } = useQuery({
    queryKey: settingsKey,
    queryFn: () => get<BackupSettings>("/api/backups/settings"),
    retry: false,
  });
  const { data: runs } = useQuery({
    queryKey: ["backup-runs"],
    queryFn: () => get<BackupRun[]>("/api/backups/runs"),
    enabled: !!settings,
  });
  const { data: remote } = useQuery({
    queryKey: ["backup-remote"],
    queryFn: () => get<RemoteBackup[]>("/api/backups/remote"),
    enabled: !!settings?.connected,
  });

  // OAuth round-trip: Google redirects back to /backups?backups=<msg|connected>.
  // Surface it once, then strip the query so a refresh doesn't re-show it.
  const [oauthMsg, setOauthMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const b = q.get("backups");
    if (!b) return;
    setOauthMsg(b === "connected" ? { ok: true, text: "Google Drive connected." } : { ok: false, text: b });
    q.delete("backups");
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  const [form, setForm] = useState<any>({});
  useEffect(() => {
    if (settings)
      setForm({
        clientId: settings.clientId ?? "",
        folderName: settings.folderName,
        scheduleKind: settings.scheduleKind,
        scheduleDow: settings.scheduleDow ?? 0,
        scheduleHhmm: settings.scheduleHhmm,
        retentionCount: settings.retentionCount,
        enabled: settings.enabled,
      });
  }, [settings?.clientId, settings?.folderName, settings?.scheduleKind, settings?.scheduleDow, settings?.scheduleHhmm, settings?.retentionCount, settings?.enabled]);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy("save");
    try {
      const body: any = {
        clientId: form.clientId,
        folderName: form.folderName,
        scheduleKind: form.scheduleKind,
        scheduleDow: form.scheduleKind === "weekly" ? Number(form.scheduleDow) : null,
        scheduleHhmm: form.scheduleHhmm,
        retentionCount: Number(form.retentionCount),
        enabled: !!form.enabled,
      };
      if (form.clientSecret) body.clientSecret = form.clientSecret; // omitted = keep stored (R-28)
      await put("/api/backups/settings", body);
      setForm({ ...form, clientSecret: "" });
      setMsg({ ok: true, text: "Backup settings saved." });
      qc.invalidateQueries({ queryKey: settingsKey });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setMsg(null);
    setBusy("connect");
    try {
      const { url } = await post<{ url: string }>("/api/backups/oauth/start", { returnTo: "/backups" });
      window.location.href = url; // Google consent → callback → redirect back here
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not start the Google connection" });
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Google Drive? Scheduled backups stop until you reconnect. The backups already in Drive stay there.")) return;
    setMsg(null);
    setBusy("disconnect");
    try {
      await post("/api/backups/disconnect", {});
      setMsg({ ok: true, text: "Google Drive disconnected — the stored connection token was revoked and wiped." });
      qc.invalidateQueries({ queryKey: settingsKey });
      qc.invalidateQueries({ queryKey: ["backup-remote"] });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Disconnect failed" });
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setMsg(null);
    setBusy("run");
    try {
      const out = await post<any>("/api/backups/run", {});
      setMsg({ ok: true, text: `Backup uploaded: ${out.fileName} (${fmtSize(out.size)}). Retention keeps the newest ${form.retentionCount} pairs in Drive.` });
      qc.invalidateQueries({ queryKey: ["backup-runs"] });
      qc.invalidateQueries({ queryKey: ["backup-remote"] });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Backup failed" });
      qc.invalidateQueries({ queryKey: ["backup-runs"] });
    } finally {
      setBusy(null);
    }
  };

  // ---- restore: typed confirmation (client gate; the route independently
  // requires confirm === "RESTORE" in the body) ----
  const [restoreFor, setRestoreFor] = useState<RemoteBackup | null>(null);
  const [restoreWord, setRestoreWord] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const doRestore = async () => {
    if (!restoreFor || restoreWord !== "RESTORE") return;
    setRestoreMsg(null);
    setRestoreBusy(true);
    try {
      await post("/api/backups/restore", { base: restoreFor.base, confirm: "RESTORE" });
      setRestoreMsg({
        ok: true,
        text: `Restored from ${restoreFor.base}. The database was replaced — reloading the app…`,
      });
      setTimeout(() => window.location.reload(), 1800);
    } catch (err) {
      setRestoreMsg({ ok: false, text: err instanceof Error ? err.message : "Restore failed" });
      setRestoreBusy(false);
    }
  };

  // Non-admins get the same neutral 404 card the company gate shows (no
  // admin-flag existence leak).
  if (settingsErr) {
    return (
      <Shell title="Backups">
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="text-[15px] font-medium text-slate-700">Backups not found</div>
            <div className="text-[12px] text-slate-500">It may have been removed, or you may not have access to it.</div>
            <a href="/companies" className="btn-primary inline-block">Back to Companies</a>
          </div>
        </div>
      </Shell>
    );
  }

  const connected = !!settings?.connected;
  const redirectUri = `${window.location.origin}/api/backups/oauth/callback`;

  return (
    <Shell title="Backups" breadcrumb={[{ label: "Gateway", to: `/company/${currentCid()}` }, { label: "Backups" }]}>
      <PageHead
        title="Backups"
        sub="Automatic backups of the entire deployment to your own Google Drive — with in-app restore. Nothing else to install on the host."
      />
      <ErrorBanner error={oauthMsg && !oauthMsg.ok ? oauthMsg.text : ""} />
      {oauthMsg?.ok && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 text-green-800 text-sm px-4 py-2.5">{oauthMsg.text}</div>}
      {msg && <div className={`mb-4 rounded-lg border text-sm px-4 py-2.5 ${msg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{msg.text}</div>}

      {/* ---- Google Drive connection ---- */}
      <Card className="p-6 max-w-3xl" testId="backup-drive-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-slate-700">Google Drive</div>
            <p className="text-xs text-slate-500 leading-relaxed mt-1 max-w-xl">
              Backups upload to a <span className="font-mono">{form.folderName || "zprime-backups"}</span> folder in your own Google account, via
              Google's own sign-in (no third-party service sees your data). zprime uses the least-privilege{" "}
              <span className="font-mono">drive.file</span> scope: it can only see files it created itself.
            </p>
          </div>
          <span
            data-testid="backup-connection-chip"
            className={`shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium ${connected ? "border-green-300 bg-green-50 text-green-700" : "border-slate-300 bg-slate-50 text-slate-500"}`}
          >
            {connected ? "● Connected" : "Not connected"}
          </span>
        </div>

        {/* One-time GCP wizard */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <button type="button" className="text-sm text-indigo-600 hover:underline" onClick={() => setShowWizard(!showWizard)} data-testid="wizard-toggle">
            {showWizard ? "Hide" : "Show"} one-time Google Cloud setup (≈10 minutes, free)
          </button>
          {showWizard && (
            <ol className="mt-3 space-y-2 text-xs text-slate-600 leading-relaxed list-decimal pl-5" data-testid="backup-wizard">
              <li>
                Open <span className="font-mono">console.cloud.google.com</span> → create a project (any name, e.g. <i>zprime backups</i>).
              </li>
              <li>APIs &amp; Services → Library → search <b>Google Drive API</b> → <b>Enable</b>.</li>
              <li>
                APIs &amp; Services → <b>OAuth consent screen</b> → External → fill app name and your email → Save.
                <div className="mt-1 rounded border border-amber-200 bg-amber-50 text-amber-800 px-2.5 py-1.5">
                  <b>Important:</b> set the publishing status to <b>“In production”</b>. A consent screen left in “Testing” expires the connection
                  every 7 days (Google's rule). No Google review is needed for this backup scope.
                </div>
              </li>
              <li>
                Credentials → Create credentials → <b>OAuth client ID</b> → Web application. Under <b>Authorized redirect URIs</b> paste exactly:
                <div className="mt-1 flex items-center gap-2">
                  <code className="font-mono text-[11px] bg-slate-100 rounded px-2 py-1 break-all flex-1" data-testid="redirect-uri">{redirectUri}</code>
                  <button type="button" className="btn-ghost text-xs shrink-0" onClick={() => navigator.clipboard?.writeText(redirectUri)}>Copy</button>
                </div>
                <div className="mt-1 text-slate-400">(Works as-is on <span className="font-mono">http://localhost</span> deployments. A LAN-IP deployment does the one-time consent from the server machine's browser, or serves HTTPS.)</div>
              </li>
              <li>Copy the <b>Client ID</b> and <b>Client secret</b> below → Save → press <b>Connect Google Drive</b>.</li>
            </ol>
          )}
        </div>

        <form onSubmit={saveSettings} className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Google Cloud Client ID">
            <input className="w-full" value={form.clientId ?? ""} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder="xxxxx.apps.googleusercontent.com" data-testid="backup-client-id" />
          </Field>
          <Field label={settings?.clientSecretLast4 ? `Client Secret (stored: ••••${settings.clientSecretLast4} — retype to change)` : "Google Cloud Client Secret"}>
            <input className="w-full" type="password" value={form.clientSecret ?? ""} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} autoComplete="new-password" data-testid="backup-client-secret" />
          </Field>
          <Field label="Drive folder name">
            <input className="w-full" value={form.folderName ?? ""} onChange={(e) => setForm({ ...form, folderName: e.target.value })} data-testid="backup-folder" />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
            <button type="submit" className="btn-primary" disabled={busy === "save"} data-testid="backup-save">Save settings</button>
            <button type="button" className="btn-secondary" onClick={connect} disabled={busy === "connect" || !form.clientId || !settings?.hasClientSecret} data-testid="connect-drive">
              {busy === "connect" ? "Redirecting…" : connected ? "Reconnect Google Drive" : "Connect Google Drive"}
            </button>
            {connected && (
              <button type="button" className="btn-ghost" onClick={disconnect} disabled={busy === "disconnect"} data-testid="disconnect-drive">
                Disconnect
              </button>
            )}
          </div>
        </form>
      </Card>

      {/* ---- Schedule ---- */}
      <Card className="p-6 max-w-3xl mt-5">
        <div className="text-sm font-semibold text-slate-700 mb-1">Schedule</div>
        <p className="text-xs text-slate-500 leading-relaxed mb-4">
          Automatic backups fire only when Drive is connected and the schedule is enabled. Retention keeps the newest pairs and deletes older
          ones from Drive.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Frequency">
            <select className="w-full" value={form.scheduleKind ?? "off"} onChange={(e) => setForm({ ...form, scheduleKind: e.target.value })} data-testid="backup-kind">
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
          {form.scheduleKind === "weekly" && (
            <Field label="Day of week">
              <select className="w-full" value={String(form.scheduleDow ?? 0)} onChange={(e) => setForm({ ...form, scheduleDow: Number(e.target.value) })} data-testid="backup-dow">
                {DOW.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Time of day (server time)">
            <input className="w-full" type="time" value={form.scheduleHhmm ?? "02:30"} onChange={(e) => setForm({ ...form, scheduleHhmm: e.target.value })} data-testid="backup-hhmm" />
          </Field>
          <Field label="Keep this many backups in Drive">
            <input className="w-full" type="number" min={1} max={365} value={form.retentionCount ?? 14} onChange={(e) => setForm({ ...form, retentionCount: e.target.value })} data-testid="backup-retention" />
          </Field>
          <label className="sm:col-span-2 flex items-center gap-2.5 text-sm text-slate-700 select-none" data-testid="backup-enabled-label">
            <input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} data-testid="backup-enabled" />
            Enable the schedule
          </label>
        </div>
        <p className="text-xs text-slate-400 mt-3">Save settings applies the schedule. Last run: {fmtWhen(settings?.lastRunAt)}</p>
      </Card>

      {/* ---- Run now + history ---- */}
      <Card className="p-6 max-w-3xl mt-5">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <div className="text-sm font-semibold text-slate-700">Backup runs</div>
          <button type="button" className="btn-primary" onClick={runNow} disabled={busy === "run" || !connected} data-testid="run-now">
            {busy === "run" ? "Backing up…" : "Back up now"}
          </button>
        </div>
        {!connected && <p className="text-xs text-slate-500 mb-3">Connect Google Drive to enable backups.</p>}
        {(runs ?? []).length > 0 ? (
          <table className="w-full text-sm" data-testid="runs-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="py-2 font-semibold">Started</th>
                <th className="py-2 font-semibold">Kind</th>
                <th className="py-2 font-semibold">Status</th>
                <th className="py-2 font-semibold">File</th>
                <th className="py-2 font-semibold">Size</th>
                <th className="py-2 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2 whitespace-nowrap">{fmtWhen(r.startedAt)}</td>
                  <td className="py-2">
                    {r.kind}
                    {r.kind === "connect" || r.kind === "disconnect" ? "" : ` · ${r.trigger}`}
                  </td>
                  <td className="py-2">
                    <span className={r.status === "ok" ? "text-green-700" : "text-red-600"}>{r.status}</span>
                  </td>
                  <td className="py-2 font-mono text-xs max-w-[220px] truncate" title={r.fileName ?? ""}>{r.fileName ?? "—"}</td>
                  <td className="py-2 whitespace-nowrap">{r.kind === "backup" || r.kind === "restore" ? fmtSize(r.fileSize) : "—"}</td>
                  <td className="py-2 text-xs text-slate-500 max-w-[260px] truncate" title={r.error ?? r.sha256 ?? ""}>{r.error ?? (r.sha256 ? r.sha256.slice(0, 12) + "…" : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-slate-500">No runs yet.</p>
        )}
      </Card>

      {/* ---- Remote backups + restore ---- */}
      <Card className="p-6 max-w-3xl mt-5">
        <div className="text-sm font-semibold text-slate-700 mb-1">Backups in Google Drive</div>
        <p className="text-xs text-slate-500 leading-relaxed mb-4">
          Restoring <b>replaces the entire database</b> with the backup's contents — everything recorded since that backup is lost. Every restore
          is verified byte-for-byte against the backup's checksum before anything is touched.
        </p>
        {(remote ?? []).length > 0 ? (
          <table className="w-full text-sm" data-testid="remote-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="py-2 font-semibold">Backup</th>
                <th className="py-2 font-semibold">Created</th>
                <th className="py-2 font-semibold">Size</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {(remote ?? []).map((b) => (
                <tr key={b.base} className="border-t border-slate-100">
                  <td className="py-2 font-mono text-xs">{b.base}</td>
                  <td className="py-2 whitespace-nowrap">{fmtWhen(b.createdTime)}</td>
                  <td className="py-2 whitespace-nowrap">{fmtSize(b.size)}</td>
                  <td className="py-2 text-right">
                    <button type="button" className="text-indigo-600 hover:underline" onClick={() => { setRestoreFor(b); setRestoreWord(""); setRestoreMsg(null); }} data-testid={`restore-${b.base}`}>
                      Restore…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-slate-500">{connected ? "No backups in Drive yet — press “Back up now”." : "Connect Google Drive to see and restore your backups."}</p>
        )}
      </Card>

      {/* ---- Restore confirmation modal ---- */}
      {restoreFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !restoreBusy) setRestoreFor(null); }}>
          <div className="card w-full max-w-md p-5 space-y-4" data-testid="restore-confirm-modal">
            <div>
              <div className="text-base font-semibold text-slate-800">Restore from {restoreFor.base}?</div>
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mt-2 leading-relaxed">
                This REPLACES the entire current database with the backup's contents. Work recorded after this backup disappears. The app
                reloads after the restore completes.
              </div>
            </div>
            <ErrorBanner error={restoreMsg && !restoreMsg.ok ? restoreMsg.text : ""} />
            {restoreMsg?.ok && <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 text-sm px-4 py-2.5">{restoreMsg.text}</div>}
            <Field label='Type RESTORE to confirm (the checksum is verified before anything changes)'>
              <input className="w-full font-mono" value={restoreWord} onChange={(e) => setRestoreWord(e.target.value)} placeholder="RESTORE" data-testid="restore-confirm-input" />
            </Field>
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn-ghost text-sm" onClick={() => setRestoreFor(null)} disabled={restoreBusy}>Cancel</button>
              <button type="button" className="btn-primary text-sm" onClick={doRestore} disabled={restoreWord !== "RESTORE" || restoreBusy} data-testid="restore-confirm-go">
                {restoreBusy ? "Restoring…" : "Restore now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
