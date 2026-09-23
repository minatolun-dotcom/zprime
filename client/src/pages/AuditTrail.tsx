import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Shell from "../components/Shell";
import { Card, ErrorBanner, PageHead } from "../components/ui";
import { get } from "../lib/api";

// R-20: company-wide audit timeline — one row per voucher lifecycle event,
// newest first. Read-only: every row is server-recorded provance (R-18), so
// the page has no actions, no filters beyond action/date-cursor, and no
// client-side security role. Deleted vouchers (voucher_id NULL — the trail
// outlives the row) render unlinked with their snapshot from `detail`.
const ACTION_STYLES: Record<string, string> = {
  create: "bg-green-100 text-green-700",
  edit: "bg-blue-100 text-blue-700",
  cancel: "bg-red-100 text-red-600",
  uncancel: "bg-teal-100 text-teal-700",
  delete: "bg-slate-200 text-slate-600",
};

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  edit: "Edited",
  cancel: "Cancelled",
  uncancel: "Uncancelled",
  delete: "Deleted",
};

export default function AuditTrail() {
  const { cid } = useParams();
  const [action, setAction] = useState("");

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["audit-trail", cid, action],
    queryFn: () =>
      get<any[]>(`/api/c/${cid}/audit?limit=200${action ? `&action=${action}` : ""}`),
  });

  return (
    <Shell
      title="Audit Trail"
      breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Audit Trail" }]}
    >
      <PageHead
        title="Audit Trail"
        sub="Every voucher lifecycle event recorded by the server — who did what, when. Newest first."
        actions={
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="text-sm py-2"
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            <option value="create">Created</option>
            <option value="edit">Edited</option>
            <option value="cancel">Cancelled</option>
            <option value="uncancel">Uncancelled</option>
            <option value="delete">Deleted</option>
          </select>
        }
      />
      {error !== undefined && <ErrorBanner error={error} />}
      <Card>
        {isLoading ? (
          <div className="px-5 py-8 text-sm text-slate-400">Loading…</div>
        ) : !rows || rows.length === 0 ? (
          <div className="px-5 py-10 text-sm text-slate-400 leading-relaxed">
            No audit events yet — events appear as vouchers are created, edited, cancelled or deleted.
          </div>
        ) : (
          <table className="report-table">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2.5 px-4 font-semibold tracking-wide">When</th>
                <th className="py-2.5 px-4 font-semibold tracking-wide">Action</th>
                <th className="py-2.5 px-4 font-semibold tracking-wide">Voucher</th>
                <th className="py-2.5 px-4 font-semibold tracking-wide">Detail</th>
                <th className="py-2.5 px-4 font-semibold tracking-wide">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_STYLES[e.action] ?? "bg-slate-100 text-slate-600"}`}>
                      {ACTION_LABELS[e.action] ?? e.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    {e.voucherId ? (
                      <Link
                        to={`/company/${cid}/voucher/${e.voucherId}/edit`}
                        className="text-indigo-600 hover:underline"
                      >
                        {e.voucherTypeName ?? "Voucher"} #{e.voucherNumber}
                      </Link>
                    ) : (
                      <span className="text-slate-400" title={e.detail ?? ""}>
                        (deleted)
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-slate-500">{e.detail ?? ""}</td>
                  <td className="py-2.5 px-4 text-slate-500">{e.actorUsername ?? "system"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Shell>
  );
}
