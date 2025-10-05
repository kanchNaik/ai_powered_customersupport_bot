// app/api/chat/route.ts
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabaseServer';
import { retrieveMatches, isConfident } from '@/lib/retrieval';
import { polishAnswer, askForClarification, summarizeForTicket } from '@/lib/llm';

export const runtime = 'nodejs';

type ChatPostBody = {
  message?: string;
  conversationId?: string;
  forceTicket?: boolean;
};

function looksLikeTicketRequest(s: string) {
  const t = s.toLowerCase();
  return /open.*ticket|create.*ticket|raise.*ticket|support ticket|file a ticket|escalate/.test(t);
}

export async function POST(req: Request) {
  try {
    // Auth (reads Supabase session from cookies via serverClient helper)
    const supa = await serverClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as ChatPostBody;
    const message = String(body?.message ?? '').trim();
    let conversationId = String(body?.conversationId ?? '').trim();

    if (!message) {
      return NextResponse.json({ ok: false, error: 'Missing message' }, { status: 400 });
    }

    // Ensure a conversation row exists for this user
    if (!conversationId) {
      const { data: conv, error: convErr } = await supa
        .from('conversations')
        .insert({ user_id: user.id })
        .select('id')
        .single();
      if (convErr) throw new Error(convErr.message);
      conversationId = conv!.id as string;
    }

    // Append the user's message
    const ins = await supa.from('messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
    });
    if (ins.error) throw new Error(ins.error.message);

    // Ticket creation path (explicit user intent or forced by client)
    if (looksLikeTicketRequest(message) || body?.forceTicket === true) {
      const { data: hist, error: histErr } = await supa
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('id', { ascending: true })
        .limit(50);
      if (histErr) throw new Error(histErr.message);

      const summary = await summarizeForTicket(hist ?? []);
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

      // Confirm in chat
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

    // RAG retrieval (uses public RPC on faq; not tied to the user)
    const results = await retrieveMatches(message);
    const { ok: confident } = isConfident(results);

    if (confident) {
      const ctx = results.slice(0, 3);
      const reply = await polishAnswer(message, ctx);

      await supa.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: reply,
      });

      return NextResponse.json({
        ok: true,
        conversationId,
        action: 'answer',
        reply,
        sources: ctx.map((r) => ({
          id: r.id,
          question: r.question,
          similarity: Number(r.similarity.toFixed(3)),
        })),
      });
    }

    // Not confident → ask clarifying questions + offer ticket creation
    const followup = await askForClarification(message);
    const nudge =
      `${followup}\n\n` +
      `If you'd like, I can create a support ticket for you now — just say "create ticket".`;

    await supa.from('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: nudge,
    });

    return NextResponse.json({
      ok: true,
      conversationId,
      action: 'clarify',
      reply: nudge,
      suggestions: results.slice(0, 3).map((r) => ({
        id: r.id,
        question: r.question,
        similarity: Number(r.similarity.toFixed(3)),
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: {
      start: `POST /api/chat { "message": "It is not working" }`,
      continue: `POST /api/chat { "conversationId": "<uuid>", "message": "More details..." }`,
      ticket: `POST /api/chat { "conversationId": "<uuid>", "message": "create ticket" }`,
    },
  });
}
