import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "./lib/api";

export interface Company {
  id: number; name: string; mailingName: string | null; address: string | null; city: string | null;
  state: string | null; stateCode: string | null; pincode: string | null; phone: string | null;
  email: string | null; gstin: string | null; financialYearStart: string; booksBeginFrom: string;
}

interface CompanyCtx {
  company: Company | undefined;
  companyId: number;
}

const Ctx = createContext<CompanyCtx>({ company: undefined, companyId: 0 });
export const useCompany = () => useContext(Ctx);

export const CURRENT_CID_KEY = "zprime.cid";

export function currentCid(): number {
  return parseInt(localStorage.getItem(CURRENT_CID_KEY) ?? "0", 10);
}

export function CompanyProvider({ children, cid }: { children: any; cid: number }) {
  const q = useQuery({
    queryKey: ["company", cid],
    queryFn: () => get<Company>(`/api/companies/${cid}`),
    enabled: cid > 0,
  });
  // R-03: a stale or unauthorized company URL answers 404 server-side. Show a
  // neutral not-found notice (never "you don't own this company") with a path
  // back to the authorized company list.
  if (q.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="text-[15px] font-medium text-slate-700">Company not found</div>
          <div className="text-[12px] text-slate-500">It may have been removed, or you may not have access to it.</div>
          <a href="/companies" className="btn-primary inline-block">Back to Companies</a>
        </div>
      </div>
    );
  }
  return <Ctx.Provider value={{ company: q.data, companyId: cid }}>{children}</Ctx.Provider>;
}
