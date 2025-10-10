// app/api/chat/route.ts
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabaseServer';
import { retrieveMatches, isConfident } from '@/lib/retrieval';
import { polishAnswer, askForClarification, summarizeForTicket } from '@/lib/llm';

export const runtime = 'nodejs';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

type ChatPostBody = {
  message?: string;
  conversationId?: string;
  forceTicket?: boolean;
  history?: ChatMsg[];  // 👈 client can send local history when anonymous
};

function looksLikeTicketRequest(s: string) {
  const t = s.toLowerCase();
  return /open.*ticket|create.*ticket|raise.*ticket|support ticket|file a ticket|escalate/.test(t);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ChatPostBody;
    const message = String(body?.message ?? '').trim();
    let conversationId = String(body?.conversationId ?? '').trim();
    const history = Array.isArray(body?.history) ? (body!.history as ChatMsg[]) : [];

    if (!message) {
      return NextResponse.json({ ok: false, error: 'Missing message' }, { status: 400 });
    }

    // Try to read user; do NOT require it for normal chat
    const supa = await serverClient();
    const { data: { user } } = await supa.auth.getUser();

    const wantsTicket = looksLikeTicketRequest(message) || body?.forceTicket === true;

    // ---------- ANONYMOUS PATH (no user) ----------
    if (!user) {
      // Normal RAG answer (stateless)
      if (!wantsTicket) {
        const results = await retrieveMatches(message);
        const { ok: confident } = isConfident(results);

        if (confident) {
          const ctx = results.slice(0, 3);
          const reply = await polishAnswer(message, ctx);
          return NextResponse.json({
            ok: true,
            conversationId: null,
            action: 'answer',
            reply,
            sources: ctx.map(r => ({ id: r.id, question: r.question, similarity: Number(r.similarity.toFixed(3)) })),
          });
        } else {
          const followup = await askForClarification(message);
          const nudge = `${followup}\n\nIf you'd like, I can create a support ticket — just click "Create ticket".`;
          return NextResponse.json({
            ok: true,
            conversationId: null,
            action: 'clarify',
            reply: nudge,
            suggestions: results.slice(0, 3).map(r => ({
              id: r.id, question: r.question, similarity: Number(r.similarity.toFixed(3)),
            })),
          });
        }
      }

      // Ticket requested but not logged in → build a draft from local history + current msg
      const anonHistory: ChatMsg[] = [...history, { role: 'user', content: message }];
      const draft = await summarizeForTicket(anonHistory);

      return NextResponse.json({
        ok: true,
        action: 'login_required',
        reply: 'Please sign in to create a ticket. You’ll be brought back here and I’ll finish the ticket automatically.',
        loginUrl: '/login?next=/support&pending=ticket',
        ticketDraft: draft, // { title, summary }
      });
    }

    // ---------- AUTH’D PATH (user exists) ----------
    // Ensure a conversation exists (optional: only if you want persistence for signed-in users)
    if (!conversationId) {
      const { data: conv, error: convErr } = await supa
        .from('conversations')
        .insert({ user_id: user.id })
        .select('id')
        .single();
      if (convErr) throw new Error(convErr.message);
      conversationId = conv!.id as string;
    }

    // Save the user's message
    {
      const ins = await supa.from('messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: message,
      });
      if (ins.error) throw new Error(ins.error.message);
    }

    if (wantsTicket) {
      // Summarize from DB history (best source of truth)
      const { data: hist, error: histErr } = await supa
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('id', { ascending: true })
        .limit(100);
      if (histErr) throw new Error(histErr.message);

      const summary = await summarizeForTicket((hist ?? []) as ChatMsg[]);
      const { data: ticket, error: tErr } = await supa
        .from('tickets')
        .insert({
          conversation_id: conversationId,
          user_id: user.id,
          title: summary.title,
          summary: summary.summary,
          status: 'new',
          priority: 'normal',
        })
        .select('id, title, status, priority, created_at')
        .single();
      if (tErr) throw new Error(tErr.message);

      await supa.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: `I've created ticket #${ticket.id}: ${ticket.title}. Our team will follow up.`,
      });

      return NextResponse.json({
        ok: true,
        conversationId,
        action: 'ticket_created',
        ticket,
        reply: `I've created ticket #${ticket.id}: ${ticket.title}.`,
      });
    }

    // Normal signed-in chat with persistence
    const results = await retrieveMatches(message);
    const { ok: confident } = isConfident(results);

    if (confident) {
      const ctx = results.slice(0, 3);
      const reply = await polishAnswer(message, ctx);
      await supa.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: reply });

      return NextResponse.json({
        ok: true,
        conversationId,
        action: 'answer',
        reply,
        sources: ctx.map(r => ({ id: r.id, question: r.question, similarity: Number(r.similarity.toFixed(3)) })),
      });
    }

    const followup = await askForClarification(message);
    const nudge = `${followup}\n\nIf you'd like, I can create a support ticket — just say "create ticket".`;
    await supa.from('messages').insert({ conversation_id: conversationId, role: 'assistant', content: nudge });

    return NextResponse.json({
      ok: true,
      conversationId,
      action: 'clarify',
      reply: nudge,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: 'POST /api/chat { message, history?: [{role,content}], forceTicket?: true }',
  });
}
