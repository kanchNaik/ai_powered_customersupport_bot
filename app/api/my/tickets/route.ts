import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supa = await serverClient(); // Next 15-safe helper (async)
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    // Filter by user_id (RLS should also enforce this, but we’re explicit)
    const { data, error } = await supa
      .from('tickets')
      .select('id, title, status, priority, created_at')
      .eq('user_id', user.id)
      .order('id', { ascending: false });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, tickets: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
