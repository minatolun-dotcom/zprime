import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { Card, ErrorBanner, Field, PageHead } from "../components/ui";
import { get, put } from "../lib/api";
import { useCompany } from "../store";
import { useHotkeys } from "../lib/hotkeys";

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

  useHotkeys({ Escape: () => window.history.back() }, []);

  const F = (name: string, label: string, extra: any = {}) => (
    <Field label={label}>
      <input className="w-full" value={form[name] ?? ""} onChange={(e) => setForm({ ...form, [name]: e.target.value })} {...extra} />
    </Field>
  );

  return (
    <Shell title="Company Settings" breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Company Settings" }]}>
      <PageHead title="Company Settings" sub="Company profile used across vouchers, GST reports and printing" />
      <ErrorBanner error={error} />
      {saved && <div className="mb-3 rounded border border-green-200 bg-green-50 text-green-800 text-[13px] px-3 py-2">Saved.</div>}
      <Card className="p-4 max-w-3xl">
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
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
          <div className="col-span-2">
            <button className="btn-primary">Save</button>
          </div>
        </form>
      </Card>
    </Shell>
  );
}
