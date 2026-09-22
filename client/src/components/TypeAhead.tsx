import { useEffect, useRef, useState } from "react";

export interface Option { id: number; name: string; }

export default function TypeAhead({
  items, value, onPick, placeholder, inputRef, className = "", createLabel, onCreate, dataCol, loading,
}: {
  items: Option[];
  value: string; // selected name
  onPick: (opt: Option | null) => void;
  placeholder?: string;
  inputRef?: any;
  className?: string;
  // R-35: when provided and the typed text matches nothing, the dropdown
  // offers a trailing "＋ Create \"<text>\"" row (Tally-style discoverable
  // path into the quick-create flow). Renders only on zero matches, so
  // existing match-commit behavior/tests are untouched.
  createLabel?: string;
  onCreate?: (text: string) => void;
  // R-36: column tag for the voucher-grid arrow navigation (tbody handler).
  dataCol?: string;
  // R-43 (F-42-1): when the caller's options are still on their initial
  // fetch, zero matches is a lie — the ledger may exist but the list is
  // empty. While true, the create path (create-row + Enter-on-zero-matches)
  // is suppressed and a non-interactive "Loading options…" hint shows
  // instead; after load, R-35 behavior is byte-identical.
  loading?: boolean;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  const matches = open && text
    ? items.filter((i) => i.name.toLowerCase().includes(text.toLowerCase())).slice(0, 8)
    : [];

  const commit = (opt: Option | null) => {
    onPick(opt);
    setText(opt ? opt.name : "");
    setOpen(false);
  };

  // R-43 (F-42-1): loading suppresses the create path entirely — an empty
  // options list during initial fetch must not read as "nothing matches".
  const canCreate = Boolean(!loading && createLabel && onCreate && open && text.trim());

  return (
    <div className="relative" ref={boxRef}>
      <input
        ref={inputRef}
        className={`w-full ${className}`}
        value={text}
        placeholder={placeholder}
        data-col={dataCol}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          // R-36: arrows own the dropdown highlight ONLY when matches are open;
          // stopPropagation keeps the grid's tbody arrow handler from also
          // moving the cell. With zero matches the keys bubble through so the
          // grid can navigate rows.
          if (e.key === "ArrowDown" && matches.length > 0) { e.preventDefault(); e.stopPropagation(); setHi(Math.min(hi + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp" && matches.length > 0) { e.preventDefault(); e.stopPropagation(); setHi(Math.max(hi - 1, 0)); }
          else if (e.key === "Enter") {
            if (matches.length > 0) { e.preventDefault(); commit(matches[hi]); }
            // R-35: Enter with typed text and zero matches opens quick-create
            // instead of silently discarding the text.
            else if (canCreate) { e.preventDefault(); onCreate!(text.trim()); }
            else if (text.trim() === "" && value) { /* keep existing */ }
          }
        }}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 left-0 right-0 top-full bg-white border border-slate-200 rounded shadow-lg max-h-56 overflow-auto">
          {matches.map((m, i) => (
            <div
              key={m.id}
              className={`px-2 py-1.5 text-[13px] cursor-pointer ${i === hi ? "bg-indigo-50 text-indigo-800" : "hover:bg-slate-50"}`}
              onMouseDown={(e) => { e.preventDefault(); commit(m); }}
            >
              {m.name}
            </div>
          ))}
        </div>
      )}
      {open && matches.length === 0 && canCreate && (
        <div
          data-testid="typeahead-create"
          className="absolute z-30 left-0 right-0 top-full bg-white border border-slate-200 rounded shadow-lg px-2 py-1.5 text-[13px] cursor-pointer text-indigo-700 hover:bg-indigo-50"
          onMouseDown={(e) => { e.preventDefault(); onCreate!(text.trim()); }}
        >
          ＋ Create "{text.trim()}"
        </div>
      )}
      {open && loading && matches.length === 0 && !canCreate && (
        <div
          data-testid="typeahead-loading"
          className="absolute z-30 left-0 right-0 top-full bg-white border border-slate-200 rounded shadow-lg px-2 py-1.5 text-[13px] text-slate-400"
        >
          Loading options…
        </div>
      )}
    </div>
  );
}
