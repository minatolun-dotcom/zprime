/** R-64 (Phase B): the one component for keyboard-shortcut visuals.
 *  Wraps the shared .fkey-chip token class; `wide` renders the chord variant
 *  (Alt+S / Alt+O / Ctrl+F7 — auto-width instead of the fixed letter box).
 *  Every shortcut label in the app renders through this so chips stay
 *  consistent and the day the styling changes, it changes once. */
export default function Kbd({ children, wide = false }: { children: string; wide?: boolean }) {
  return <span className={`fkey-chip shrink-0 ${wide ? "!px-1.5" : "!min-w-[1.7rem] !px-0"}`}>{children}</span>;
}
