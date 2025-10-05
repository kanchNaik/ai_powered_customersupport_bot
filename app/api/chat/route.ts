import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { dbAnon } from '@/lib/db';
import { retrieveMatches, isConfident } from '@/lib/retrieval';
import { polishAnswer, askForClarification, summarizeForTicket } from '@/lib/llm';

export const runtime = 'nodejs';

function serverClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: () => cookieStore }
  );
}

function looksLikeTicketRequest(s: string) {
  const t = s.toLowerCase();
  return /open.*ticket|create.*ticket|raise.*ticket|support ticket|file a ticket|escalate/.test(t);
}

export async function POST(req: Request) {
  try {
    const supaUser = serverClient();
    const { data: { user } } = await supaUser.auth.getUser();
    if (!user) return NextResponse.json({ ok:false, error:'Unauthorized' }, { status:401 });

    const body = await req.json().catch(() => null);
    const message = String(body?.message ?? '').trim();
    let conversationId = String(body?.conversationId ?? '');
    if (!message) return NextResponse.json({ ok:false, error:'Missing message' }, { status:400 });

    // ensure conversation
    if (!conversationId) {
      const { data, error } = await supaUser.from('conversations')
        .insert({ user_id: user.id })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      conversationId = data!.id;
    }

    // append user message
    const ins = await supaUser.from('messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message
    });
    if (ins.error) throw new Error(ins.error.message);

    // ticket path
    if (looksLikeTicketRequest(message) || body?.forceTicket === true) {
      const { data: hist, error: histErr } = await supaUser
        .from('messages').select('role,content')
        .eq('conversation_id', conversationId).order('id').limit(30);
      if (histErr) throw new Error(histErr.message);

      const summary = await summarizeForTicket(hist ?? []);
      const { data: ticket, error: tErr } = await supaUser
        .from('tickets')
        .insert({ conversation_id: conversationId, user_id: user.id,
                  title: summary.title, summary: summary.summary, status: 'new', priority: 'normal' })
        .select('id, title, status, priority, created_at')
        .single();
      if (tErr) throw new Error(tErr.message);

      await supaUser.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: `I've created ticket #${ticket.id}: ${ticket.title}.`
      });

      return NextResponse.json({
        ok:true, conversationId, action:'ticket_created',
        ticket, reply: `I've created ticket #${ticket.id}: ${ticket.title}.`
      });
    }

    // retrieval
    const results = await retrieveMatches(message);
    const { ok: confident } = isConfident(results);

    if (confident) {
      const ctx = results.slice(0,3);
      const reply = await polishAnswer(message, ctx);
      await supaUser.from('messages').insert({ conversation_id: conversationId, role:'assistant', content: reply });
      return NextResponse.json({
        ok:true, conversationId, action:'answer', reply,
        sources: ctx.map(r=>({ id:r.id, similarity:+r.similarity.toFixed(3), question:r.question }))
      });
    }

    // clarify
    const follow = await askForClarification(message);
    const reply = `${follow}\n\nIf you'd like, I can create a support ticket for you now — just say "create ticket".`;
    await supaUser.from('messages').insert({ conversation_id: conversationId, role:'assistant', content: reply });
    return NextResponse.json({
      ok:true, conversationId, action:'clarify', reply,
      suggestions: results.slice(0,3).map(r=>({ id:r.id, similarity:+r.similarity.toFixed(3), question:r.question }))
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message ?? 'Unknown error' }, { status:500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok:true,
    usage:{
      start:`POST /api/chat { "message": "It is not working" }`,
      continue:`POST /api/chat { "conversationId":"<uuid>", "message":"details..." }`,
      ticket:`POST /api/chat { "conversationId":"<uuid>", "message":"create ticket" }`
    }
  });
}
