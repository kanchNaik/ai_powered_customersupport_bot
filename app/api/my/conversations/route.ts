// app/api/my/conversations/route.ts
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

// Small helper to shorten titles in the sidebar
function clip(s: string, n = 64) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

export async function GET() {
  try {
    const supa = await serverClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    // 1) Fetch user conversations
    const { data: convs, error: convErr } = await supa
      .from('conversations')
      .select('id, created_at') // add 'title' here if you have a column
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (convErr) throw new Error(convErr.message);
    if (!convs?.length) return NextResponse.json({ ok: true, items: [] });

    const convIds = convs.map(c => c.id);

    // 2) Fetch latest messages for these conversations
    const { data: msgs, error: msgErr } = await supa
      .from('messages')
      .select('conversation_id, role, content, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false }); // newest first

    if (msgErr) throw new Error(msgErr.message);

    // 3) Build a map of last activity + a reasonable title
    const lastAt = new Map<string, string>();
    const titleFromMsg = new Map<string, string>();

    // newest-first list means first time we see a conversation_id = latest activity
    for (const m of (msgs ?? [])) {
      if (!lastAt.has(m.conversation_id as string)) {
        lastAt.set(m.conversation_id as string, String(m.created_at));
      }
      // title heuristic: prefer latest *user* message; else any message
      if (!titleFromMsg.has(m.conversation_id as string)) {
        const content = String(m.content || '').trim();
        if (content) {
          if (m.role === 'user') titleFromMsg.set(m.conversation_id as string, content);
          else titleFromMsg.set(m.conversation_id as string, content); // fallback
        }
      }
    }

    const items = convs.map(c => {
      const last = lastAt.get(c.id as string) || String(c.created_at);
      const t = titleFromMsg.get(c.id as string) || 'New chat';
      return {
        id: c.id as string,
        title: clip(t),
        last_at: last,
      };
    });

    // 4) Sort by last activity desc
    items.sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
