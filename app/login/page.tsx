'use client';
import { useEffect, useMemo, useState } from 'react';
import { browserClient } from '@/lib/supabaseBrowser';

type Mode = 'sign_in' | 'sign_up' | 'forgot';

export default function LoginPage() {
  const supabase = useMemo(() => browserClient(), []);
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // After login/sign-up/reset, redirect to ?next=/something or /support
  function redirectNext() {
    const url = new URL(window.location.href);
    const next = url.searchParams.get('next') || '/support';
    window.location.assign(next);
  }

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      redirectNext();
    } catch (e: any) {
      setErr(e?.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setLoading(true);
    try {
      if (!password || password !== confirm) throw new Error('Passwords do not match');
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // If you require email confirm, the link will land on /reset-password where they can set a new pw
          emailRedirectTo: `${window.location.origin}/reset-password`,
        },
      });
      if (error) throw error;
      setMsg('Sign-up successful. Check your email to confirm if required.');
      setMode('sign_in');
    } catch (e: any) {
      setErr(e?.message || 'Sign-up failed');
    } finally {
      setLoading(false);
    }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setMsg('Password reset email sent. Check your inbox.');
      setMode('sign_in');
    } catch (e: any) {
      setErr(e?.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      <div className="flex gap-2 text-sm">
        <button className={`border rounded px-3 py-1 ${mode==='sign_in' ? 'bg-gray-100' : ''}`} onClick={()=>setMode('sign_in')}>Sign in</button>
        <button className={`border rounded px-3 py-1 ${mode==='sign_up' ? 'bg-gray-100' : ''}`} onClick={()=>setMode('sign_up')}>Sign up</button>
        <button className={`border rounded px-3 py-1 ${mode==='forgot' ? 'bg-gray-100' : ''}`} onClick={()=>setMode('forgot')}>Forgot password</button>
      </div>

      {err && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      {msg && <div className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-700">{msg}</div>}

      {mode === 'sign_in' && (
        <form onSubmit={onSignIn} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm">Email</label>
            <input className="w-full rounded border px-3 py-2" type="email" autoComplete="email"
              value={email} onChange={e=>setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm">Password</label>
            <div className="flex gap-2">
              <input className="w-full rounded border px-3 py-2" type={showPw ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={e=>setPassword(e.target.value)} required />
              <button type="button" className="rounded border px-2 text-sm" onClick={()=>setShowPw(s=>!s)}>
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <button className="rounded border px-4 py-2 hover:bg-gray-50" disabled={loading} type="submit">
            {loading ? '…' : 'Sign in'}
          </button>
        </form>
      )}

      {mode === 'sign_up' && (
        <form onSubmit={onSignUp} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm">Email</label>
            <input className="w-full rounded border px-3 py-2" type="email" autoComplete="email"
              value={email} onChange={e=>setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm">Password</label>
            <input className="w-full rounded border px-3 py-2" type={showPw ? 'text' : 'password'} autoComplete="new-password"
              value={password} onChange={e=>setPassword(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm">Confirm password</label>
            <input className="w-full rounded border px-3 py-2" type={showPw ? 'text' : 'password'} autoComplete="new-password"
              value={confirm} onChange={e=>setConfirm(e.target.value)} required />
          </div>
          <div>
            <button type="button" className="rounded border px-2 text-sm mr-2" onClick={()=>setShowPw(s=>!s)}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <button className="rounded border px-4 py-2 hover:bg-gray-50" disabled={loading} type="submit">
            {loading ? '…' : 'Create account'}
          </button>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={onForgot} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm">Email</label>
            <input className="w-full rounded border px-3 py-2" type="email" autoComplete="email"
              value={email} onChange={e=>setEmail(e.target.value)} required />
          </div>
          <button className="rounded border px-4 py-2 hover:bg-gray-50" disabled={loading} type="submit">
            {loading ? '…' : 'Send reset link'}
          </button>
        </form>
      )}
    </main>
  );
}
