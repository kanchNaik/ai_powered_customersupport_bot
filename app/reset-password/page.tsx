// app/reset-password/page.tsx
'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { browserClient } from '@/lib/supabaseBrowser';

export default function ResetPasswordPage() {
  const supabase = useMemo(() => browserClient(), []);
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const href = window.location.href; // includes ?code=...
        // 1) Exchange the code in the URL for a session
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(href);
        if (exErr) throw exErr;

        // 2) Verify we now have a session
        const { data: s } = await supabase.auth.getSession();
        if (!s?.session) throw new Error('Auth session missing after exchange');

        setReady(true);
      } catch (e: any) {
        console.error('[reset-password]', e?.message || e);
        setErr('Auth session missing. Please click the latest reset link from your email again.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onUpdate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setLoading(true);
    try {
      if (!pw || pw !== confirm) throw new Error('Passwords do not match');

      // Must still have a session at submit time
      const { data: s } = await supabase.auth.getSession();
      if (!s?.session) throw new Error('Auth session missing');

      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;

      setMsg('Password updated. Redirecting to sign in…');
      setTimeout(() => window.location.assign('/login'), 1200);
    } catch (e: any) {
      setErr(e?.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Set new password</h1>

      {err && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      {msg && <div className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-700">{msg}</div>}

      {!err && !ready && <div className="text-sm opacity-70">Preparing your reset session…</div>}

      {ready && !err && (
        <form onSubmit={onUpdate} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm">New password</label>
            <input
              className="w-full rounded border px-3 py-2"
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm">Confirm new password</label>
            <input
              className="w-full rounded border px-3 py-2"
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <button type="button" className="rounded border px-2 text-sm" onClick={() => setShow(s => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
          <div>
            <button className="rounded border px-4 py-2 hover:bg-gray-50" disabled={loading} type="submit">
              {loading ? '…' : 'Update password'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
