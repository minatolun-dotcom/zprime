import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Shell from "../components/Shell";
import { Card, ErrorBanner, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { useHotkeys } from "../lib/hotkeys";

export default function ImportXml() {
  const { cid } = useParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [xmlText, setXmlText] = useState("");

  const doImport = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      let res: any;
      if (pasteMode) {
        res = await api(`/api/c/${cid}/import/xml`, { method: "POST", body: JSON.stringify({ xml: xmlText }) });
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error("Choose an XML file first");
        const fd = new FormData();
        fd.append("file", file);
        res = await api(`/api/c/${cid}/import/xml`, { method: "POST", body: fd });
      }
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  useHotkeys({ Escape: () => window.history.back() }, []);

  return (
    <Shell title="XML Import" breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "XML Import" }]}>
      <PageHead title="Import from XML" sub="Bring masters and vouchers in from an accounting XML export" />
      <ErrorBanner error={error} />

      <Card className="p-4 max-w-2xl">
        <div className="flex gap-2 mb-3">
          <button className={`btn ${pasteMode ? "btn-ghost" : "btn-primary"}`} onClick={() => setPasteMode(false)}>Upload file</button>
          <button className={`btn ${pasteMode ? "btn-primary" : "btn-ghost"}`} onClick={() => setPasteMode(true)}>Paste XML</button>
        </div>

        {!pasteMode ? (
          <input ref={fileRef} type="file" accept=".xml,text/xml" className="block w-full" />
        ) : (
          <textarea rows={8} className="w-full font-mono text-[11px]" placeholder="Paste the contents of your XML export (ENVELOPE → BODY → IMPORTDATA → REQUESTDATA…)" value={xmlText} onChange={(e) => setXmlText(e.target.value)} />
        )}

        <button className="btn-primary mt-3" disabled={busy} onClick={doImport}>
          {busy ? "Importing…" : "Start Import"}
        </button>

        <div className="mt-4 text-[12px] text-slate-500 leading-relaxed">
          <b>How it works:</b> export your masters (groups, ledgers, stock items, units, godowns) and/or vouchers
          as <b>XML</b> from your existing accounting software, then upload the file here.
          <br />The importer maps the standard 28 reserved account groups, ledgers with GSTIN &amp; opening balances,
          stock items with units, godowns, vouchers (all accounting + inventory types) and bill-wise references.
          Duplicates (same type/date/number) are skipped.
        </div>
      </Card>

      {result && (
        <Card className="p-4 max-w-2xl mt-4">
          <div className="text-[13px] font-semibold mb-2 text-green-700">Import complete</div>
          <table className="report-table">
            <tbody>
              <tr><td>Groups created</td><td className="num">{result.groups}</td></tr>
              <tr><td>Ledgers created</td><td className="num">{result.ledgers}</td></tr>
              <tr><td>Units created</td><td className="num">{result.units}</td></tr>
              <tr><td>Stock items created</td><td className="num">{result.items}</td></tr>
              <tr><td>Godowns created</td><td className="num">{result.godowns}</td></tr>
              <tr><td>Vouchers imported</td><td className="num font-semibold">{result.vouchers}</td></tr>
              <tr><td>Skipped (duplicates / non-create)</td><td className="num">{result.skipped}</td></tr>
            </tbody>
          </table>
          {result.errors?.length > 0 && (
            <div className="mt-3 text-[12px] text-amber-700">
              <b>Warnings:</b>
              <ul className="list-disc pl-4">{result.errors.slice(0, 10).map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </Card>
      )}
    </Shell>
  );
}
