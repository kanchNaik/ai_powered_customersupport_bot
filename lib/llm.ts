// lib/llm.ts
import Groq from 'groq-sdk';

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

export type TicketDraft = {
  title: string;
  summary: string;
  severity?: 'low' | 'normal' | 'high' | 'critical';
  environment?: string;
  steps?: string[];
  faq_refs?: number[];
};

function parseJsonLoose(s: string): any {
  // Try fenced JSON first
  const fence = /```json([\s\S]*?)```/i.exec(s);
  const raw = fence ? fence[1] : s;
  // Trim to first/last brace if needed
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  const slice = first >= 0 && last >= 0 ? raw.slice(first, last + 1) : raw;
  try { return JSON.parse(slice); } catch { return null; }
}

function messagesToPlain(chat: ChatMsg[], limit = 50): string {
  const tail = chat.slice(-limit);
  return tail.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
}

function inferFaqRefs(chat: ChatMsg[]): number[] {
  const set = new Set<number>();
  for (const m of chat) {
    const re = /\[FAQ-(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(m.content)) !== null) {
      set.add(Number(match[1]));
    }
  }
  return [...set];
}

function heuristicTitle(chat: ChatMsg[]): string {
  const text = messagesToPlain(chat, 20).toLowerCase();
  if (text.includes('price adjustment')) return 'Price adjustment request within 7-day window';
  if (text.includes('refund')) return 'Refund request';
  if (text.includes('password')) return 'Password reset/login issue';
  if (text.includes('2fa') || text.includes('two-factor')) return '2FA setup/verification issue';
  if (text.includes('billing') || text.includes('invoice')) return 'Billing/invoice question';
  return 'Support request';
}

function buildSummaryText(d: TicketDraft): string {
  const lines: string[] = [];
  lines.push(`Issue: ${d.title}`);
  if (d.severity) lines.push(`Severity: ${d.severity}`);
  if (d.environment) lines.push(`Environment: ${d.environment}`);
  if (d.summary) lines.push('', d.summary.trim());
  if (d.steps?.length) {
    lines.push('', 'Steps / Context:');
    for (const s of d.steps) lines.push(`- ${s}`);
  }
  if (d.faq_refs?.length) lines.push('', `FAQ refs: ${d.faq_refs.map(n => `#${n}`).join(', ')}`);
  return lines.join('\n');
}

/**
 * Summarize the conversation into a structured ticket.
 * Falls back to heuristics if LLM fails.
 */
export async function summarizeForTicket(chat: ChatMsg[]): Promise<TicketDraft> {
  const faqRefs = inferFaqRefs(chat);
  const groqKey = process.env.GROQ_API_KEY;
  const base: TicketDraft = {
    title: heuristicTitle(chat),
    summary: '',
    severity: 'normal',
    environment: undefined,
    steps: [],
    faq_refs: faqRefs,
  };

  if (!groqKey) {
    // Fallback summary if no LLM
    const tail = messagesToPlain(chat, 12);
    return {
      ...base,
      summary:
        `Auto-summary (fallback):\n` +
        `The user needs help related to: ${base.title}.\n` +
        `Recent conversation:\n${tail}`,
      steps: ['Review conversation log', 'Respond according to policy'],
    };
  }

  const groq = new Groq({ apiKey: groqKey });
  const convo = messagesToPlain(chat, 50);

  const prompt = `
You are creating an internal support ticket from the chat transcript below.
Produce STRICT JSON with this shape:

{
  "title": "concise, specific issue (max 90 chars)",
  "summary": "2-5 sentences: what the user needs, key constraints, any policy references",
  "severity": "low|normal|high|critical",
  "environment": "web|ios|android|api|unknown",
  "steps": ["bullet 1", "bullet 2", "bullet 3"],
  "faq_refs": [135, 209]
}

Rules:
- Ground ONLY in the transcript; do not invent order IDs or dates.
- If not stated, use "unknown" or omit.
- Prefer a task-like title ("Price adjustment request within 7 days") over "Create new ticket".
- Extract any FAQ ids mentioned like [FAQ-123] into faq_refs (unique, numeric).
- If the user asked to "create ticket", include the preceding intent as context.
- Keep JSON under 1200 chars.
`;

  const messages = [
    { role: 'system' as const, content: prompt.trim() },
    { role: 'user' as const, content: `Transcript:\n${convo}` },
  ];

  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 700,
      messages,
    });
    const text = resp.choices?.[0]?.message?.content ?? '';
    const obj = parseJsonLoose(text);

    // Validate & merge with base
    const draft: TicketDraft = {
      ...base,
      title: obj?.title || base.title,
      summary: obj?.summary || base.summary,
      severity: ['low', 'normal', 'high', 'critical'].includes(obj?.severity) ? obj.severity : base.severity,
      environment: obj?.environment || 'unknown',
      steps: Array.isArray(obj?.steps) ? obj.steps.slice(0, 10) : [],
      faq_refs: Array.isArray(obj?.faq_refs) ? [...new Set(obj.faq_refs.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)))] : faqRefs,
    };

    // Build a human-friendly summary block the agent will see
    draft.summary = buildSummaryText(draft);
    return draft;
  } catch {
    // LLM failure → sensible fallback
    const tail = messagesToPlain(chat, 12);
    return {
      ...base,
      summary:
        `Auto-summary (fallback):\n` +
        `The user needs help related to: ${base.title}.\n` +
        `Recent conversation:\n${tail}`,
      steps: ['Review conversation log', 'Respond according to policy'],
    };
  }
}
