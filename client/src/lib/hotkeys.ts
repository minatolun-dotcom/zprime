import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

/**
 * Global accounting-style hotkeys: "F2", "F5", "Alt+F1", "Alt+F6", "Ctrl+A", "Escape", "Enter".
 * Captures function keys (preventing browser defaults) and registers an F-key legend
 * via window.__fkLegend for the ButtonPanel.
 */
export function useHotkeys(map: HotkeyMap, deps: unknown[] = []) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // R-64: multiple useHotkeys instances can be mounted at once (page maps
      // + Shell's global voucher-F-key floor). Capture listeners fire in
      // registration order (children before parents), so the first instance
      // that matches preventDefaults — every later instance must skip the
      // event or the same keypress would navigate twice (duplicate history
      // entries break the Esc-back ladder).
      if (e.defaultPrevented) return;
      const k = e.key;
      let combo: string | null = null;
      if (k.startsWith("F") && /^F\d{1,2}$/.test(k)) {
        combo = e.altKey ? `Alt+${k}` : e.ctrlKey ? `Ctrl+${k}` : e.shiftKey ? `Shift+${k}` : k;
      } else if (e.ctrlKey && (k === "a" || k === "A")) combo = "Ctrl+A";
      else if (e.ctrlKey && (k === "h" || k === "H")) combo = "Ctrl+H";
      else if (e.altKey && /^[0-9]$/.test(k)) combo = `Alt+F${k}`;
      else if (k === "Escape") combo = "Escape";
      // R-54 (Tally reports): +/- next/previous artifact/report date.
      // "=" and "_" are the unshifted siblings of "+" and "-" on US layouts.
      else if (k === "+" || k === "=") combo = "+";
      else if (k === "-" || k === "_") combo = "-";
      else if (k === "Enter" && e.altKey) combo = "Alt+Enter";
      // R-23: single-letter Alt chords (Alt+R reverse-charge toggle). Only when
      // no modifier beyond Alt — avoids swallowing AltGr international layouts.
      else if (e.altKey && !e.ctrlKey && !e.shiftKey && /^[a-z]$/i.test(k)) combo = `Alt+${k.toUpperCase()}`;
      if (combo && ref.current[combo]) {
        e.preventDefault();
        ref.current[combo](e);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Normalise F-key labels for function keys (F5 -> F5 key on keyboard). */
export const fkeyLabel = (fk: string): string => fk;
