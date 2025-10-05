'use client';

import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabaseBrowser';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';

export default function LoginPage() {
  const [supabase] = useState(() => browserClient());

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      // you can redirect after sign-in if you want
      // window.location.href = '/support';
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Sign in</h1>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        providers={['github']}      // remove if you don’t want OAuth
        magicLink                   // enables email magic link
        redirectTo={typeof window !== 'undefined' ? `${window.location.origin}/support` : undefined}
      />
    </main>
  );
}
