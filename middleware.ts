// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createMiddlewareClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  // Let Next serve static assets, images, and the two public APIs
  const publicPaths = [
    '/login',
    '/reset-password',
    '/auth/callback', // optional route if you add one later
    '/api/answer',
    '/api/embed-faq',
  ];
  const { pathname } = req.nextUrl;

  // Skip static assets & _next
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/assets') ||
    publicPaths.includes(pathname)
  ) {
    return NextResponse.next();
  }

  // Check session via Supabase
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Force login
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname); // so we can bounce back after login
    return NextResponse.redirect(url);
  }

  // If user is logged in and tries to go to /login, bounce them to /support
  if (user && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/support';
    return NextResponse.redirect(url);
  }

  return res;
}

// Protect everything except static & our public APIs
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets).*)'],
};
