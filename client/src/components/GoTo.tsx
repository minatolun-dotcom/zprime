import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoToItem } from "../lib/gatewayMenu";

/**
 * R-54 Option B: TallyPrime's Alt+G "Go To" — a command palette over every
 * Gateway destination (reports, masters, vouchers, utilities, Day Book).
 * Type-to-filter (label then section), ↑/↓ + Enter to navigate, Esc closes
 * (captured here so Shell's history-back never sees it). Mouse-friendly:
 * rows are clickable and hovering sets the highlight.
 */
export default function GoTo({ open, items, onClose }: {
  open: boolean;
  items: GoToItem[];
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items.slice(0, 12);
    const scored = items
      .map((it) => {
        const label = it.label.toLowerCase();
        const section = it.section.toLowerCase();
        let score = -1;
        if (label.startsWith(query)) score = 0;             // best: label prefix
        else if (label.includes(query)) score = 1;          // label substring
        else if (section.startsWith(query)) score = 2;      // section prefix ("reports" → all reports)
        else if (section.includes(query)) score = 3;        // section substring
        return { it, score };
      })
      .filter((x) => x.score >= 0)
      // stable, human ordering: rank, then shorter label (closer match), then A→Z
      .sort((a, b) => a.score - b.score || a.it.label.length - b.it.label.length || a.it.label.localeCompare(b.it.label));
    return scored.slice(0, 12).map((x) => x.it);
  }, [q, items]);

  useEffect(() => {
    if (open) {
      setQ("");
      setHl(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => setHl(0), [q]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture on window: claims Esc before the page/Shell layers; stopPropagation
    // keeps it from reaching Shell's bubble-phase history-back either.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  const commit = (it: GoToItem | undefined) => {
    if (!it) return;
    onClose();
    nav(it.to);
  };

  const inputKeys = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHl((h) => (results.length ? (h + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHl((h) => (results.length ? (h - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(results[hl]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/30" data-testid="goto-overlay">
      <div
        className="card shadow-raised w-[min(560px,92vw)] overflow-hidden"
        role="dialog"
        aria-label="Go To"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2 border-b border-slate-100">
          <input
            ref={inputRef}
            data-testid="goto-input"
            className="w-full text-base outline-none placeholder:text-slate-400"
            placeholder="Go To: report, master, voucher…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={inputKeys}
          />
        </div>
        <ul className="max-h-[50vh] overflow-auto py-1" data-testid="goto-results">
          {results.length === 0 && (
            <li className="px-4 py-3 text-sm text-slate-400">No matching destination — Esc to close.</li>
          )}
          {results.map((it, i) => (
            <li key={it.to + it.label}>
              <button
                className={`w-full text-left px-4 py-2 flex items-center gap-2 text-sm ${i === hl ? "bg-indigo-50 !text-indigo-800" : ""}`}
                onMouseEnter={() => setHl(i)}
                onClick={() => commit(it)}
              >
                {it.letter && <span className="fkey-chip !min-w-[1.7rem] !px-0 shrink-0">{it.letter}</span>}
                <span className="flex-1 truncate">{it.label}</span>
                <span className="text-xs text-slate-400">{it.section}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-1.5 border-t border-slate-100 text-xs text-slate-400">
          type to filter · ↑ ↓ move · Enter opens · Esc closes
        </div>
      </div>
    </div>
  );
}
