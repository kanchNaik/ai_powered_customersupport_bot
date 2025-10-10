// lib/llm.ts
import Groq from 'groq-sdk';

/** ---------- Shared Types ---------- */
export type Passage = {
  id: number;
  question: string;
  answer: string;
  similarity: number;
};

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

export type TicketDraft = {
  title: string;
  summary: string; // final human-readable block (includes FAQ refs)
  severity?: 'low' | 'normal' | 'high' | 'critical';
  environment?: string;
  steps?: string[];
  faq_refs?: number[];
};

/** ---------- Utilities ---------- */
function parseJsonLoose(s: string): any {
  const fenced = /```json([\s\S]*?)```/i.exec(s);
  const raw = fenced ? fenced[1] : s;
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  const slice = first >= 0 && last >= 0 ? raw.slice(first, last + 1) : raw;
  try { return JSON.parse(slice); } catch { return null; }
}

function messagesToPlain(chat: ChatMsg[], limit = 50): string {
  const tail = chat.slice(-limit);
  return tail.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
}

function inferFaqRefsFromText(text: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const re = /\[FAQ-(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    if (Number.isFinite(id) && !seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

function inferFaqRefsFromChat(chat: ChatMsg[]): number[] {
  const set = new Set<number>();
  for (const m of chat) {
    for (const id of inferFaqRefsFromText(m.content)) set.add(id);
  }
  return [...set];
}

/** ---------- Answering with citations ---------- */
function buildAnswerPrompt(userQ: string, passages: Passage[]) {
  const context = passages
    .map(p => `[FAQ-${p.id}] Q: ${p.question}\nA: ${p.answer}`)
    .join('\n\n');

  const system = `You are a helpful support assistant.
Answer ONLY using the provided FAQs. Be concise (1–3 short paragraphs).
Cite facts with [FAQ-<id>] at the end of sentences where used.
If the context does not contain the answer, say you’re not sure and suggest relevant FAQs. Never invent info.`;

  const user = `User question:
${userQ}

Context FAQs:
${context}`;

  return { system, user };
}

/** Exported: generate a concise, cited answer. */
export async function polishAnswer(userQ: string, passages: Passage[]): Promise<string> {
  const hasGroq = !!process.env.GROQ_API_KEY;
  if (!passages?.length) return `I’m not fully sure based on the current FAQs.`;

  // LLM path (preferred)
  if (hasGroq) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
    const { system, user } = buildAnswerPrompt(userQ, passages.slice(0, 3));
    const resp = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    if (text) return text;
  }

  // Fallback: stitch the top passage with a citation
  const top = passages[0];
  const cited = `${top.answer} [FAQ-${top.id}]`;
  return cited;
}

/** ---------- Clarifying question when confidence is low ---------- */
export async function askForClarification(userQ: string): Promise<string> {
  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const system = `Ask ONE short clarifying question to resolve the user's issue. 
No preamble. Keep it under 18 words.`;
    const user = `User said: "${userQ}"\nWhat is the single most useful follow-up question?`;
    const resp = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 60,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    if (text) return text.replace(/^[“"]|[”"]$/g, '');
  }
  // Fallback generic follow-up
  return `Could you share a bit more detail (what you tried, exact error/message, and your account email)?`;
}

/** ---------- Ticket Summarization (with FAQ refs in summary) ---------- */
function heuristicTitle(chat: ChatMsg[]): string {
  const text = messagesToPlain(chat, 20).toLowerCase();
  if (text.includes('price adjustment')) return 'Price adjustment request within 7-day window';
  if (text.includes('password')) return 'Password reset/login issue';
  if (text.includes('refund')) return 'Refund request';
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

/** Exported: summarize the conversation into a structured ticket draft. */
export async function summarizeForTicket(chat: ChatMsg[]): Promise<TicketDraft> {
  const faqRefs = inferFaqRefsFromChat(chat);
  const base: TicketDraft = {
    title: heuristicTitle(chat),
    summary: '',
    severity: 'normal',
    environment: 'unknown',
    steps: [],
    faq_refs: faqRefs,
  };

  // If no LLM key, fallback but still include refs in the final summary
  if (!process.env.GROQ_API_KEY) {
    const tail = messagesToPlain(chat, 12);
    const draft: TicketDraft = {
      ...base,
      summary:
        `The user needs help related to: ${base.title}.\n\n` +
        `Recent conversation:\n${tail}`,
      steps: ['Review conversation log', 'Respond according to policy'],
    };
    draft.summary = buildSummaryText(draft);
    return draft;
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const convo = messagesToPlain(chat, 50);

  const system = `
Create an internal support ticket from the chat transcript.

Return STRICT JSON:
{
  "title": "concise issue (max 90 chars)",
  "summary": "2-5 sentences: what the user needs, key constraints, policy refs if any",
  "severity": "low|normal|high|critical",
  "environment": "web|ios|android|api|unknown",
  "steps": ["bullet 1", "bullet 2"],
  "faq_refs": [135, 209]
}

Rules:
- Ground ONLY in transcript; do not invent order IDs or dates.
- If not stated, use "unknown" or omit.
- Prefer a task-like title (e.g., "Price adjustment request within 7 days"), never "Create New Ticket".
- Extract numbers from tokens like [FAQ-123] into faq_refs (unique).
- Keep JSON under 1200 chars.
`.trim();

  const resp = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    temperature: 0.2,
    max_tokens: 700,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Transcript:\n${convo}` },
    ],
  });

  const text = resp.choices?.[0]?.message?.content ?? '';
  const obj = parseJsonLoose(text) ?? {};

  const mergedRefs = Array.from(
    new Set([
      ...faqRefs,
      ...(Array.isArray(obj.faq_refs)
        ? obj.faq_refs.map((n: any) => Number(n)).filter(Number.isFinite)
        : []),
    ])
  );

  const draft: TicketDraft = {
    ...base,
    title: obj.title || base.title,
    summary: obj.summary || base.summary,
    severity: ['low', 'normal', 'high', 'critical'].includes(obj.severity)
      ? obj.severity
      : base.severity,
    environment: obj.environment || base.environment,
    steps: Array.isArray(obj.steps) ? obj.steps.slice(0, 10) : [],
    faq_refs: mergedRefs,
  };

  // Build the final human-friendly summary string INCLUDING FAQ refs
  draft.summary = buildSummaryText(draft);
  return draft;
}
