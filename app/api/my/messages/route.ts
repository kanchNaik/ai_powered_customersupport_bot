// app/api/my/messages/route.ts
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const supa = await serverClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });

    // Optional guard: ensure the conversation belongs to the user
    const { data: conv, error: convErr } = await supa
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (convErr) throw new Error(convErr.message);
    if (!conv) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

    const { data: messages, error } = await supa
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', id)
      .order('id', { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, messages: messages ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
