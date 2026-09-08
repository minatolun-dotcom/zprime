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
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="text-center mb-5">
          <div className="text-2xl font-bold text-indigo-700 tracking-tight">zprime</div>
          <div className="text-[12px] text-slate-500 mt-1">Fast, keyboard-first accounting for your business</div>
        </div>
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-[13px] px-3 py-2">{error}</div>}
        <label className="block mb-3">
          <span className="block text-[12px] font-medium text-slate-600 mb-1">Username</span>
          <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} className="w-full" placeholder="admin" />
        </label>
        <label className="block mb-4">
          <span className="block text-[12px] font-medium text-slate-600 mb-1">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" placeholder="••••••••" />
        </label>
        <button disabled={busy} className="btn-primary w-full justify-center">
          {busy ? "Signing in…" : "Sign In"}
        </button>
        <p className="text-[11px] text-slate-400 text-center mt-4">Default credentials: admin / admin123</p>
      </form>
    </div>
  );
}
