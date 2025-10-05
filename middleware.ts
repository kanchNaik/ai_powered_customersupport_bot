// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const { pathname } = url;

  // Public routes & static assets to allow without auth
  const PUBLIC_PATHS = new Set([
    '/login',
    '/reset-password',
    '/auth/callback',
    '/api/answer',
    '/api/embed-faq',
  ]);
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/assets') ||
    PUBLIC_PATHS.has(pathname)
  ) {
    return NextResponse.next();
  }

  // Prepare a response we can mutate cookies on
  const res = NextResponse.next();

  // Supabase client for middleware (Edge): implement cookie get/set/remove
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Set on the response so the browser updates cookies
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: '', ...options, maxAge: 0 });
        },
      },
    }
  );

  // Check session
  const { data: { user } } = await supabase.auth.getUser();

  // Not signed in → redirect to /login and preserve intended path
  if (!user) {
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Already signed in but going to /login → bounce to /support
  if (pathname === '/login') {
    url.pathname = '/support';
    url.searchParams.delete('next');
    return NextResponse.redirect(url);
  }

  // Allow through
  return res;
}

export const config = {
  // Protect everything except static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets).*)'],
};
