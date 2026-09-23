import { FormEvent, useState } from "react";
import { post } from "../lib/api";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { username, password });
      window.location.href = "/companies";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 px-4">
      <form onSubmit={submit} className="card shadow-raised w-full max-w-sm p-8">
        <div className="text-center mb-7">
          <div className="text-2xl font-bold text-indigo-700 tracking-tight">zprime</div>
          <div className="text-sm text-slate-500 mt-1.5">Fast, keyboard-first accounting for your business</div>
        </div>
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3.5 py-2.5" role="alert">
            {error}
          </div>
        )}
        <label className="block mb-4">
          <span className="block text-sm font-medium text-slate-600 mb-1.5">Username</span>
          <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} className="w-full" placeholder="admin" />
        </label>
        <label className="block mb-6">
          <span className="block text-sm font-medium text-slate-600 mb-1.5">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" placeholder="••••••••" />
        </label>
        <button disabled={busy} className="btn-primary w-full justify-center">
          {busy ? "Signing in…" : "Sign In"}
        </button>
        <p className="text-xs text-slate-400 text-center mt-5">Default credentials: admin / admin123</p>
      </form>
    </div>
  );
}
