'use client';
import { useEffect, useMemo } from 'react';
import { browserClient } from '@/lib/supabaseBrowser';
import { useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const supabase = useMemo(() => browserClient(), []);
  const params = useSearchParams();

  useEffect(() => {
    (async () => {
      try {
        // Supabase will parse the code from the current URL
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) throw error;
        const next = params.get('next') || '/support';
        window.location.replace(next);
      } catch (e) {
        console.error('[auth-callback]', e);
        window.location.replace('/login?error=auth_callback');
      }
    })();
  }, [params, supabase]);

  return <main className="p-6">Signing you in…</main>;
}
