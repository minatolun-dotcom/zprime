/**
 * RFC 4180-compliant CSV serialization with spreadsheet formula-injection
 * protection. Used by every report view's "Export CSV" button (R-66 spread it
 * across all of them) plus the Day Book and Audit Trail lists.
 *
 - Fields containing a comma, double quote, CR or LF are quoted; embedded
   quotes are doubled ("").
 - Values that could execute as spreadsheet formulas (=, +, -, @ prefix) are
   neutralized with a leading apostrophe — EXCEPT values that are plain
   negative numbers (e.g. "-1234.56"), which are legitimate accounting data.
 - A UTF-8 BOM is prepended by the caller's Blob so Excel reads Unicode.
 */

const FORMULA_CHARS = new Set(["=", "+", "@"]);

export function csvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);

  // Formula-injection guard: leading = + @ always; leading - only when NOT a
  // plain number (so real negatives like -1234.56 survive untouched).
  if (s.length > 0) {
    const first = s[0];
    if (FORMULA_CHARS.has(first)) s = `'${s}`;
    else if (first === "-" && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    else if (first === "\t" || first === "\r") s = `'${s}`;
  }

  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvBody(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [
    headers.map(csvField).join(","),
    ...rows.map((r) => r.map(csvField).join(",")),
  ];
  return lines.join("\r\n");
}

/**
 * Build and download a CSV file. Optional `meta` rows (R-66) are written as
 * plain CSV lines above the table — report name, period, context — followed
 * by a blank separator, so spreadsheets show provenance above the data.
 */
export function csvDownload(name: string, headers: string[], rows: (string | number | null | undefined)[][], meta?: (string | number | null | undefined)[][]) {
  const body = "\uFEFF" + [
    ...(meta ?? []).map((r) => r.map(csvField).join(",")),
    ...(meta?.length ? [""] : []),
    csvBody(headers, rows),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download any text blob (R-24: the generated e-invoice JSON). */
export function textDownload(name: string, text: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
