'use client';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabaseBrowser';
import { Auth, ThemeSupa } from '@supabase/auth-ui-react';

export default function LoginPage() {
  const [supabase] = useState(() => browserClient());
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_e, _s) => {
      // Next.js will pick up the session cookie; optionally redirect here
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Sign in</h1>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        providers={['github']}
        redirectTo={typeof window !== 'undefined' ? window.location.origin + '/support' : undefined}
        magicLink
        showLinks={true}
        view="sign_in"
        localization={{ variables: { sign_in: { email_label: 'Email (magic link)' } } }}
      />
      {emailSent && <p className="mt-2 text-sm">Check your email for the magic link.</p>}
    </main>
  );
}
