// R-13 (F-13-1): in-memory login attempt limiter.
//
// Key: client IP + exact username (both dimensions — rotating either one
// blunts the attack, and exact-username matching means an attacker cannot
// lock out a victim's account by misspelling the username).
//
// Policy: 10 failures in a 10-minute sliding window locks that (ip, username)
// pair until the oldest failure ages out of the window. A successful login
// resets the pair. The threshold is deliberately above anything the
// regression suites do (each suite boots its own server, and no suite fires
// more than a couple of failed logins).
//
// In-memory state is intentional: zprime is a single-process deployment
// (no multi-worker/multi-node topology exists), and persisting attempt
// history would be scope creep. State resets on restart — acceptable and
// documented in README.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;

const failures = new Map<string, number[]>(); // key -> timestamps of failures

function sweep(ts: number[]): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  const kept = ts.filter((t) => t > cutoff);
  return kept.length === ts.length ? ts : kept;
}

export function loginKey(ip: string, username: string): string {
  // "\n" separator: usernames cannot contain newlines (zod string does allow
  // them, but a newline would merely create a distinct key, not a collision
  // with another user's — separators in either half cannot cross-match).
  return `${ip}\n${username}`;
}

export function isLoginLocked(key: string): boolean {
  const ts = failures.get(key);
  if (!ts || ts.length === 0) return false;
  const kept = sweep(ts);
  if (kept.length === 0) {
    failures.delete(key);
    return false;
  }
  failures.set(key, kept);
  return kept.length >= MAX_FAILURES;
}

export function recordLoginFailure(key: string): void {
  const ts = sweep(failures.get(key) ?? []);
  ts.push(Date.now());
  failures.set(key, ts);
}

export function resetLoginFailures(key: string): void {
  failures.delete(key);
}

/** Seconds until the oldest failure in the window ages out (for Retry-After). */
export function loginRetryAfterSeconds(key: string): number {
  const ts = sweep(failures.get(key) ?? []);
  if (ts.length === 0) return 0;
  const retryAt = ts[0] + WINDOW_MS;
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}

// Test hook: clear all state (used by suites that share a server across
// scenario blocks). Not used by the app.
export function _resetAllLoginState(): void {
  failures.clear();
}
