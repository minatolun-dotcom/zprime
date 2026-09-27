// R-74: the company's print logo. Bytes live ONLY on
// GET /api/companies/:cid/logo (image/png); the JSON company payload carries
// the presence fact (hasLogo) and this query carries the pixels.
//
// The version counter is MODULE-GLOBAL and bumped by every upload/remove:
// all hook instances (Settings preview, invoice face, report print headers)
// re-render and refetch together — a logo uploaded mid-session appears on
// the very next print without a page reload.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

let LOGO_VERSION = 0;
const listeners = new Set<() => void>();

/** Call after a logo upload or removal — every consumer refetches. */
export function bumpCompanyLogoVersion() {
  LOGO_VERSION += 1;
  for (const l of listeners) l();
}

export function useCompanyLogo(cid: string | number | undefined) {
  const [version, setVersion] = useState(LOGO_VERSION);
  useEffect(() => {
    const l = () => setVersion(LOGO_VERSION);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return useQuery<string | null>({
    queryKey: ["company-logo", cid, version],
    queryFn: async () => {
      if (!cid) return null;
      const res = await fetch(`/api/companies/${cid}/logo?v=${version}`, { credentials: "include" });
      if (res.status === 404) return null; // no logo uploaded — honest absence
      if (!res.ok) throw new Error(`Logo request failed (${res.status})`);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    staleTime: Infinity, // bytes change only via upload/remove, which bump the version
    gcTime: 30 * 60_000,
  });
}
