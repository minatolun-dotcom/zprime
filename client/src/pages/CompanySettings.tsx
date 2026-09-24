import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { Card, ErrorBanner, Field, PageHead } from "../components/ui";
import { get, put, del } from "../lib/api";
import { useCompany } from "../store";

// R-28: IRP connectivity credentials (opt-in, owner-only). Secrets are stored
// AES-256-GCM encrypted server-side; reads return last-4 masks only, and the
// form only sends a secret when the operator retypes one (never the mask).
export default function CompanySettings() {
  const { cid } = useParams();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["company", cid], queryFn: () => get<any>(`/api/companies/${cid}`) });
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      await put(`/api/companies/${cid}`, form);
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["company", cid] });
      qc.invalidateQueries({ queryKey: ["companies"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };



  const F = (name: string, label: string, extra: any = {}) => (
    <Field label={label}>
      <input className="w-full" value={form[name] ?? ""} onChange={(e) => setForm({ ...form, [name]: e.target.value })} {...extra} />
    </Field>
  );

  // ---- R-28 IRP credentials state ----
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");
  const credsKey = ["irp-creds", cid, env];
  const { data: creds, error: credsLoadErr } = useQuery({ queryKey: credsKey, queryFn: () => get<any[]>(`/api/companies/${cid}/irp-credentials`) });
  const current = (creds ?? []).find((c) => c.environment === env);
  const [irpForm, setIrpForm] = useState<any>({});
  const [irpMsg, setIrpMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setIrpForm(current ? { clientId: current.clientId, gstin: current.gstin, username: current.username, ewbUsername: current.ewbUsername ?? "", publicKeyPem: current.publicKeyPem ?? "", endpointOverride: current.endpointOverride ?? "" } : { clientId: "", gstin: "", username: "", ewbUsername: "", publicKeyPem: "", endpointOverride: "" });
  }, [current?.clientId, current?.gstin, current?.username, current?.ewbUsername, current?.publicKeyPem, current?.endpointOverride, env, creds]);

  const saveIrp = async () => {
    setIrpMsg(null);
    // The server upsert requires both secrets (they are stored encrypted and
    // never read back), so both must be (re)typed on every save — the stored
    // masks are display-only.
    if (!irpForm.clientSecret || !irpForm.password) {
      setIrpMsg({ ok: false, text: "Client secret and password are required — stored values cannot be read back, so retype them" + (current ? " to keep them unchanged." : ".") });
      return;
    }
    try {
      await put(`/api/companies/${cid}/irp-credentials`, {
        environment: env,
        clientId: irpForm.clientId,
        gstin: irpForm.gstin,
        username: irpForm.username,
        clientSecret: irpForm.clientSecret,
        password: irpForm.password,
        // R-30: EWB-portal credentials are OPTIONAL and pair-ruled — both or
        // neither. Omitted pair = stored pair left untouched server-side.
        ewbUsername: irpForm.ewbUsername || null,
        ewbPassword: irpForm.ewbPassword || null,
        publicKeyPem: irpForm.publicKeyPem || null,
        endpointOverride: irpForm.endpointOverride || null,
      });
      setIrpForm({ ...irpForm, clientSecret: "", password: "", ewbPassword: "" });
      setIrpMsg({ ok: true, text: `IRP credentials saved (${env}).` });
      qc.invalidateQueries({ queryKey: credsKey });
    } catch (err) {
      setIrpMsg({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    }
  };

  const removeIrp = async () => {
    setIrpMsg(null);
    try {
      await del(`/api/companies/${cid}/irp-credentials/${env}`);
      setIrpMsg({ ok: true, text: `IRP credentials removed (${env}).` });
      qc.invalidateQueries({ queryKey: credsKey });
    } catch (err) {
      setIrpMsg({ ok: false, text: err instanceof Error ? err.message : "Remove failed" });
    }
  };

  return (
    <Shell title="Company Settings" breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Company Settings" }]}>
      <PageHead title="Company Settings" sub="Company profile used across vouchers, GST reports and printing" />
      <ErrorBanner error={error || (credsLoadErr instanceof Error ? credsLoadErr.message : "")} />
      {saved && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 text-green-800 text-sm px-4 py-2.5">Saved.</div>}
      <Card className="p-6 max-w-3xl">
        <form onSubmit={save} className="grid grid-cols-2 gap-4">
          {F("name", "Company Name *", { required: true })}
          {F("mailingName", "Mailing Name")}
          <div className="col-span-2">{F("address", "Address")}</div>
          {F("city", "City")}
          {F("pincode", "Pincode")}
          {F("state", "State")}
          {F("stateCode", "State Code", { placeholder: "27" })}
          {F("gstin", "GSTIN")}
          {F("phone", "Phone")}
          {F("email", "Email")}
          {F("financialYearStart", "Financial Year Begins", { type: "date" })}
          {F("booksBeginFrom", "Books Begin From", { type: "date" })}
          <label className="col-span-2 flex items-center gap-2.5 text-sm text-slate-700 select-none">
            <input
              type="checkbox"
              checked={!!form["allowNegativeStock"]}
              onChange={(e) => setForm({ ...form, allowNegativeStock: e.target.checked })}
            />
            Allow Negative Stock (permit overselling; stock value may go negative)
          </label>
          <div className="col-span-2">
            <button className="btn-primary">Save</button>
          </div>
        </form>
      </Card>

      <Card className="p-6 max-w-3xl mt-5">
        <PageHead title="IRP / e-Way Bill Connectivity" sub="Optional — submit e-invoices and e-way bills to the IRP directly. Without credentials, generate + download works as before." />
        {irpMsg && (
          <div className={`mb-4 rounded-lg border text-sm px-4 py-2.5 ${irpMsg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{irpMsg.text}</div>
        )}
        <div className="flex gap-2 mb-4 text-sm">
          {(["sandbox", "production"] as const).map((e) => (
            <button key={e} type="button" onClick={() => setEnv(e)} className={`px-3.5 py-2 rounded-md border ${env === e ? "border-indigo-500 bg-indigo-50 font-medium text-indigo-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {e === env ? "● " : ""}{e}
            </button>
          ))}
        </div>
        {/* R-32: the three host facts an operator needs — the sandbox IRP has a
            built-in default; production IRP and the EWB-API always come from
            the operator's IRP/GSP. Full runbook: ONBOARDING_IRP_EWB.md. */}
        <p className="text-xs text-slate-500 leading-relaxed mb-4">
          Hosts: sandbox IRP defaults to einv-apisandbox.nic.in — production IRP and the EWB-API (separate portal) have no default and are taken from the endpoint override (your IRP/GSP's documented host). Setup, first-submit walkthrough and error decode: <span className="font-mono">ONBOARDING_IRP_EWB.md</span> in the repository.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Client ID"><input className="w-full" value={irpForm.clientId ?? ""} onChange={(e) => setIrpForm({ ...irpForm, clientId: e.target.value })} /></Field>
          <Field label="GSTIN (for this credential set)"><input className="w-full" value={irpForm.gstin ?? ""} onChange={(e) => setIrpForm({ ...irpForm, gstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>
          <Field label="Username"><input className="w-full" value={irpForm.username ?? ""} onChange={(e) => setIrpForm({ ...irpForm, username: e.target.value })} /></Field>
          <Field label={current ? `Client Secret (stored: ••••${current.clientSecretLast4 ?? "????"} — retype to change)` : "Client Secret *"}>
            <input className="w-full" type="password" value={irpForm.clientSecret ?? ""} onChange={(e) => setIrpForm({ ...irpForm, clientSecret: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label={current ? `Password (stored: ••••${current.passwordLast4 ?? "????"} — retype to change)` : "Password *"}>
            <input className="w-full" type="password" value={irpForm.password ?? ""} onChange={(e) => setIrpForm({ ...irpForm, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="IRP Public Key PEM (portal download; else IRP_NIC_PUBLIC_KEY env)">
            <textarea className="w-full h-20 font-mono text-xs" value={irpForm.publicKeyPem ?? ""} onChange={(e) => setIrpForm({ ...irpForm, publicKeyPem: e.target.value })} />
          </Field>
          <Field label="Endpoint override (mock/test IRP; production requires it)">
            <input className="w-full" value={irpForm.endpointOverride ?? ""} onChange={(e) => setIrpForm({ ...irpForm, endpointOverride: e.target.value })} placeholder="https://…" />
          </Field>
        </div>
        {/* R-30: the EWB system is a SEPARATE portal (ewaybillgst.gov.in) with
            its own credentials — this pair unlocks DIRECT e-way bill birth for
            B2C invoices (no IRN). Optional: leave blank for B2B-only (IRN path). */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="text-sm font-semibold mb-3">EWB portal (direct e-way bills, B2C)</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="EWB portal username"><input className="w-full" value={irpForm.ewbUsername ?? ""} onChange={(e) => setIrpForm({ ...irpForm, ewbUsername: e.target.value })} /></Field>
            <Field label={current?.ewbPasswordLast4 ? `EWB portal password (stored: ••••${current.ewbPasswordLast4} — retype to change)` : "EWB portal password (optional)"}>
              <input className="w-full" type="password" value={irpForm.ewbPassword ?? ""} onChange={(e) => setIrpForm({ ...irpForm, ewbPassword: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mt-1.5">Leave both blank to keep any stored pair unchanged. The EWB-API host is the same endpoint override above (it serves both portals for the mock; production hosts differ).</p>
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" className="btn-primary" onClick={saveIrp}>Save IRP credentials</button>
          {current && <button type="button" className="btn-secondary" onClick={removeIrp}>Remove ({env})</button>}
        </div>
      </Card>
    </Shell>
  );
}
