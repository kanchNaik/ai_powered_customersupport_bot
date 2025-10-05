// app/auth/callback/page.tsx
'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserClient } from '@/lib/supabaseBrowser';

export const dynamic = 'force-dynamic'; // avoid prerender issues on this page
export const runtime = 'edge';           // (optional) works fine on Edge

function parseHash(hash: string) {
  const qs = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return {
    access_token: qs.get('access_token') || undefined,
    refresh_token: qs.get('refresh_token') || undefined,
    type: qs.get('type') || undefined,
    error: qs.get('error') || qs.get('error_description') || undefined,
  };
}

function CallbackInner() {
  const supabase = useMemo(() => browserClient(), []);
  const params = useSearchParams();
  const [msg, setMsg] = useState('Signing you in…');

  useEffect(() => {
    (async () => {
      try {
        const href = window.location.href;
        const code = params.get('code'); // PKCE/OTP code
        const { access_token, refresh_token, type, error } = parseHash(window.location.hash);

        if (error) throw new Error(error);

        // 1) Code flow
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(href);
          if (exErr) throw exErr;
          const next = params.get('next') || '/support';
          window.location.replace(next);
          return;
        }

        // 2) Hash token flow
        if (access_token && refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
          if (setErr) throw setErr;
          const next = params.get('next') || '/support';
          window.location.replace(next);
          return;
        }

        // 3) Verify-only links
        if (type === 'signup' || type === 'email_change') {
          setMsg('Email verified. Redirecting to sign in…');
          setTimeout(() => window.location.replace('/login?verified=1'), 800);
          return;
        }

        throw new Error('No auth tokens found in callback URL');
      } catch (e: any) {
        console.error('[auth-callback]', e?.message || e);
        setMsg('Auth session missing. Redirecting to sign in…');
        setTimeout(() => window.location.replace('/login?error=auth_callback'), 800);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <main className="p-6">{msg}</main>;
}

export default function AuthCallback() {
  return (
    <Suspense fallback={<main className="p-6">Signing you in…</main>}>
      <CallbackInner />
    </Suspense>
  );
}
