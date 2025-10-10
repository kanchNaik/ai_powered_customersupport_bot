'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabaseBrowser';

export default function AuthButton() {
  const supabase = useMemo(() => browserClient(), []);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      // initial check
      const { data: { user } } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
      setLoading(false);

      // keep in sync with future logins/logouts
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setEmail(session?.user?.email ?? null);
      });
      unsub = () => sub.subscription.unsubscribe();
    })();
    return () => unsub();
  }, [supabase]);

  async function logout() {
    await supabase.auth.signOut();
    // Send user somewhere public to avoid middleware bounce
    router.push('/support');
    router.refresh();
  }

  if (loading) {
    return (
      <span className="rounded px-3 py-1 text-sm opacity-70">
        …
      </span>
    );
  }

  if (email) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400">
          {email}
        </span>
        <button
          onClick={logout}
          className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Log out"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <a
      href="/login?next=/support"
      className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
      aria-label="Log in"
    >
      Log in
    </a>
  );
}
