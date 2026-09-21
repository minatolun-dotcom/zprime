import { useEffect, useRef, useState } from "react";

export interface Option { id: number; name: string; }

export default function TypeAhead({
  items, value, onPick, placeholder, inputRef, className = "", createLabel, onCreate,
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

  const canCreate = Boolean(createLabel && onCreate && open && text.trim());

  return (
    <div className="relative" ref={boxRef}>
      <input
        ref={inputRef}
        className={`w-full ${className}`}
        value={text}
        placeholder={placeholder}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi(Math.min(hi + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
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
    </div>
  );
}
