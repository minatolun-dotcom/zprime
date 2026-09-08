import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/api";
import { Card, ErrorBanner, Field, PageHead } from "../components/ui";
import { Company, CURRENT_CID_KEY } from "../store";
import { fyStart } from "../lib/format";

interface CompaniesResponse extends Array<Company> {}

export default function Companies() {
  const qc = useQueryClient();
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => get<CompaniesResponse>("/api/companies") });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", gstin: "", state: "Maharashtra", stateCode: "27", address: "", city: "", pincode: "",
    financialYearStart: fyStart(new Date().toISOString().slice(0, 10)),
    booksBeginFrom: fyStart(new Date().toISOString().slice(0, 10)),
  });

  const open = (c: Company) => {
    localStorage.setItem(CURRENT_CID_KEY, String(c.id));
    window.location.href = `/company/${c.id}`;
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const c = await post<Company>("/api/companies", {
        ...form,
        mailingName: form.name,
      });
      qc.invalidateQueries({ queryKey: ["companies"] });
      open(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    }
  };

  return (
    <div className="h-full overflow-auto bg-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <PageHead
          title="Select Company"
          sub="Choose a company to work with, or create a new one."
          actions={
            <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
              {showForm ? "Cancel" : "+ Create Company"}
            </button>
          }
        />
        <ErrorBanner error={error} />

        {showForm && (
          <Card className="p-4 mb-5">
            <form onSubmit={create} className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Company Name *">
                  <input required className="w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
              </div>
              <Field label="GSTIN">
                <input className="w-full" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} placeholder="27AAAAA0000A1Z5" />
              </Field>
              <Field label="State">
                <select className="w-full" value={form.stateCode} onChange={(e) => {
                  const opt = e.target.selectedOptions[0];
                  setForm({ ...form, stateCode: opt.value, state: opt.dataset.name ?? "" });
                }}>
                  {STATES.map((s) => (
                    <option key={s.code} value={s.code} data-name={s.name}>{`${s.code} - ${s.name}`}</option>
                  ))}
                </select>
              </Field>
              <Field label="Address">
                <input className="w-full" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <Field label="City">
                <input className="w-full" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
              <Field label="Pincode">
                <input className="w-full" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
              </Field>
              <Field label="Financial Year Begins From" hint="Indian FY: 1 April – 31 March">
                <input type="date" className="w-full" value={form.financialYearStart} onChange={(e) => setForm({ ...form, financialYearStart: e.target.value, booksBeginFrom: e.target.value })} />
              </Field>
              <Field label="Books Begin From">
                <input type="date" className="w-full" value={form.booksBeginFrom} onChange={(e) => setForm({ ...form, booksBeginFrom: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <button className="btn-primary">Create & Open</button>
              </div>
            </form>
          </Card>
        )}

        <div className="space-y-2">
          {(companies ?? []).map((c) => (
            <Card key={c.id} className="p-4 flex items-center gap-4 cursor-pointer hover:border-indigo-300 hover:shadow" onClick={() => open(c)}>
              <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold">
                {c.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-medium text-slate-800">{c.name}</div>
                <div className="text-[12px] text-slate-500">
                  FY from {c.financialYearStart}{c.gstin ? ` · GSTIN ${c.gstin}` : ""}{c.state ? ` · ${c.state}` : ""}
                </div>
              </div>
              <span className="text-slate-300">→</span>
            </Card>
          ))}
          {companies && companies.length === 0 && !showForm && (
            <Card className="p-8 text-center text-slate-500 text-[13px]">
              No companies yet. Create your first company to get started.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const STATES = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" }, { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" }, { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" }, { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" }, { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "27", name: "Maharashtra" }, { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" }, { code: "35", name: "Andaman & Nicobar Islands" },
  { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];
