// R-75: the Reports menu — an in-between page mirroring the Gateway's Reports
// pane (same single source of truth, lib/gatewayMenu.ts). Created for the
// operator's back-navigation report: the browser back arrow and Esc previously
// jumped from a report straight to the Gateway because no Reports surface
// existed to land on between the two. The Gateway's pane remains the
// keyboard-first surface (letters/arrows/Enter); this page is the mouse-first
// sibling — and Esc/Back from a report now lands here, so the second Back
// returns to the Gateway exactly as the operator expects.
import { Link, useParams } from "react-router-dom";
import Shell from "../components/Shell";
import { useCompany } from "../store";
import { buildGatewayMenu } from "../lib/gatewayMenu";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";

interface VoucherTypeRow { id: number; name: string; category: string; functionKey: string | null; }

export default function ReportsMenu() {
  const { cid } = useParams();
  const { company } = useCompany();
  // The Gateway builds its Reports pane from the account/inventory voucher
  // types (the Vouchers pane consumes them); the Reports pane itself is
  // static, but the build signature must match — feed it the same query.
  const { data: voucherTypes } = useQuery({
    queryKey: ["voucher-types", cid],
    queryFn: () => get<VoucherTypeRow[]>(`/api/c/${cid}/voucher-types`),
  });
  const acct = (voucherTypes ?? []).filter((v) => v.category === "Accounting" || v.category === "Inventory");
  const reports = buildGatewayMenu(cid ?? "", acct).find((s) => s.title === "Reports")?.items ?? [];

  return (
    <Shell
      title="Reports"
      breadcrumb={[{ label: "Gateway", to: `/company/${cid}` }, { label: "Reports" }]}
    >
      <div className="max-w-md">
        <div className="card p-2">
          <div className="px-2 pt-1 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Reports — {company?.name ?? ""}
          </div>
          <ul data-testid="reports-menu">
            {reports.map((it) => (
              <li key={it.to}>
                <Link to={it.to} className="fkey-item !min-h-[2.25rem] !px-2 !rounded-md" title={it.hint || undefined}>
                  {it.letter ? (
                    <span className="fkey-chip">{it.letter}</span>
                  ) : it.chord ? (
                    <span className="fkey-chip w-auto px-1.5">{it.chord}</span>
                  ) : (
                    <span className="w-[1.7rem] shrink-0" aria-hidden />
                  )}
                  <span className="flex-1 truncate">{it.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-2 pt-2 pb-1 text-xs text-slate-400">
            Esc or the browser back arrow returns here from any report; Esc again returns to the Gateway.
          </div>
        </div>
      </div>
    </Shell>
  );
}
