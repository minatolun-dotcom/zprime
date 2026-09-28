// R-79: app themes — Light (default) | Dark (proper) | Warm (reading light).
// The active theme is ONE class on <html> (`.dark` / `.warm`); index.css
// remaps the palette variables inside that scope, so every existing component
// re-themes with zero class churn. Applied pre-hydration by a tiny inline
// script in index.html (no flash) and kept in sync here.
export type Theme = "light" | "dark" | "warm";
const KEY = "zprime_theme";
const THEMES: Theme[] = ["light", "dark", "warm"];

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v as Theme) ? (v as Theme) : "light";
  } catch {
    return "light";
  }
}

/** Apply the theme class to <html> (idempotent — safe to call repeatedly). */
export function applyTheme(t: Theme): void {
  const el = document.documentElement;
  el.classList.remove("dark", "warm");
  if (t === "dark") el.classList.add("dark");
  if (t === "warm") el.classList.add("warm");
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable — session-only theme */
  }
}

/** Cycle light → dark → warm → light (the toggle's click path). */
export function nextTheme(t: Theme): Theme {
  return t === "light" ? "dark" : t === "dark" ? "warm" : "light";
}
