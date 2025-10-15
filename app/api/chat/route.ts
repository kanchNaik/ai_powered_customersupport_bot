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
  history?: ChatMsg[]; // client can send local history when anonymous
};

function looksLikeTicketRequest(s: string) {
  const t = s.toLowerCase();
  return /open.*ticket|create.*ticket|raise.*ticket|support ticket|file a ticket|escalate/.test(t);
}

function sevToPriority(sev?: string) {
  if (sev === 'critical') return 'urgent';
  if (sev === 'high') return 'high';
  return 'normal';
}

const TICKET_INTENT_RE =
  /(open|create|raise|file|escalate).{0,20}ticket|^create ticket$|^open ticket$/i;

function mergeAndCleanHistory(dbHist: ChatMsg[], clientHist: ChatMsg[]): ChatMsg[] {
  // 1) merge
  const merged = [...(dbHist || []), ...(clientHist || [])];

  // 2) dedupe by role+content
  const seen = new Set<string>();
  const deduped: ChatMsg[] = [];
  for (const m of merged) {
    const key = `${m.role}|${m.content.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push({ role: m.role, content: m.content.trim() });
    }
  }

  // 3) drop pure “create/open ticket” commands so the LLM sees the real issue
  const cleaned = deduped.filter(m => !TICKET_INTENT_RE.test(m.content.toLowerCase()));

  // 4) keep the last 60 turns max
  return cleaned.slice(-60);
}


export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ChatPostBody;
    const message = String(body?.message ?? '').trim();
    let conversationId = String(body?.conversationId ?? '').trim();
    const history = Array.isArray(body?.history) ? (body.history as ChatMsg[]) : [];

    if (!message) {
      return NextResponse.json({ ok: false, error: 'Missing message' }, { status: 400 });
    }

    // Try to read user; DO NOT require it for normal chat
    const supa = await serverClient();
    const {
      data: { user },
    } = await supa.auth.getUser();

    const wantsTicket = looksLikeTicketRequest(message) || body?.forceTicket === true;

    // ---------- ANONYMOUS PATH (no user) ----------
    if (!user) {
      if (!wantsTicket) {
        // Stateless RAG answer
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
            sources: ctx.map((r) => ({
              id: r.id,
              question: r.question,
              similarity: Number(r.similarity.toFixed(3)),
            })),
          });
        } else {
          const followup = await askForClarification(message);
          const nudge =
            `${followup}\n\nIf you'd like, I can create a support ticket — just click "Create ticket".`;
          return NextResponse.json({
            ok: true,
            conversationId: null,
            action: 'clarify',
            reply: nudge,
            suggestions: results.slice(0, 3).map((r) => ({
              id: r.id,
              question: r.question,
              similarity: Number(r.similarity.toFixed(3)),
            })),
          });
        }
      }

      // Ticket requested but not logged in → summarize local history + current msg
      const anonHistory: ChatMsg[] = [...history, { role: 'user', content: message }];
      const draft = await summarizeForTicket(anonHistory); // { title, summary, severity, ... }

      return NextResponse.json({
        ok: true,
        action: 'login_required',
        reply:
          'Please sign in to create a ticket. You’ll be brought back here and I’ll finish the ticket automatically.',
        loginUrl: '/login?next=/support&pending=ticket', // ⬅️ returns to /support after login
        ticketDraft: { title: draft.title, summary: draft.summary },
      });
    }

    // ---------- AUTH’D PATH (user exists) ----------
    // Ensure a conversation exists if you want persistence for signed-in users
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
  // Load DB history
  const { data: hist, error: histErr } = await supa
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('id', { ascending: true })
    .limit(500);
  if (histErr) throw new Error(histErr.message);

  // Merge with client-sent history (helps when user chatted as guest before login)
  const clientHist = Array.isArray(body?.history) ? (body.history as ChatMsg[]) : [];
  const merged = mergeAndCleanHistory((hist ?? []) as ChatMsg[], clientHist);

  // If merged is empty (edge case), fall back to at least the current message
  const contextForTicket = merged.length ? merged : [{ role: 'user', content: message }];

  const draft = await summarizeForTicket(contextForTicket);

  const { data: ticket, error: tErr } = await supa
    .from('tickets')
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      title: draft.title,
      summary: draft.summary,     // includes steps + FAQ refs
      status: 'new',
      priority: (draft.severity === 'critical') ? 'urgent' :
                (draft.severity === 'high')     ? 'high'   : 'normal',
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
      await supa
        .from('messages')
        .insert({ conversation_id: conversationId, role: 'assistant', content: reply });

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

    const followup = await askForClarification(message);
    const nudge =
      `${followup}\n\nIf you'd like, I can create a support ticket — just say "create ticket".`;
    await supa
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'assistant', content: nudge });

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
