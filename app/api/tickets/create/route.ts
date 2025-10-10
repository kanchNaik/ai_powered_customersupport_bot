// app/api/tickets/create/route.ts
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supa = await serverClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? '').slice(0, 200);
    const summary = String(body?.summary ?? '').slice(0, 8000);
    const conversationId = String(body?.conversationId ?? '');

    if (!title || !summary) {
      return NextResponse.json({ ok: false, error: 'Missing title/summary' }, { status: 400 });
    }

    const { data: ticket, error } = await supa
      .from('tickets')
      .insert({
        user_id: user.id,
        conversation_id: conversationId || null,
        title,
        summary,
        status: 'new',
        priority: 'normal',
      })
      .select('id, title, status, priority, created_at')
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, ticket });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
