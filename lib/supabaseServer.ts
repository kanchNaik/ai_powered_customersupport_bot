// lib/supabaseServer.ts
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export function serverClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // For Server Components, only `get` is actually used.
      // In Route Handlers/Actions, Supabase may call set/remove during auth flows.
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // In Server Components, cookies() is read-only; ignore set/remove there.
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            /* no-op in RSC */
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options, maxAge: 0 });
          } catch {
            /* no-op in RSC */
          }
        },
      },
    }
  );
}
