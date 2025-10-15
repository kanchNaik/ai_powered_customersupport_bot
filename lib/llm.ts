// lib/llm.ts
import Groq from 'groq-sdk';
import { HfInference } from '@huggingface/inference';

/* =========================
   Embeddings (HF: BGE small)
   ========================= */
export const EMBED_MODEL = 'BAAI/bge-small-en-v1.5';
export const DIMS = 384;
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

function as1d(a: unknown): number[] {
  if (Array.isArray(a) && typeof a[0] === 'number') return (a as number[]).map(Number);
  if (Array.isArray(a) && Array.isArray(a[0])) return (a[0] as number[]).map(Number);
  if (a instanceof Float32Array) return Array.from(a);
  if (Array.isArray(a) && a[0] instanceof Float32Array) return Array.from(a[0] as Float32Array);
  throw new Error('Unexpected embedding shape from HF');
}

export async function embedQuery(q: string): Promise<number[]> {
  const key = process.env.HF_TOKEN;
  if (!key) throw new Error('HF_TOKEN is missing');
  const hf = new HfInference(key);
  const data = await hf.featureExtraction({
    model: EMBED_MODEL,
    inputs: QUERY_PREFIX + q,
    // options is supported; no ts-ignore needed
    options: { wait_for_model: true },
  });
  const vec = as1d(data);
  if (vec.length !== DIMS) throw new Error(`HF dims ${vec.length} != expected ${DIMS}`);
  return vec;
}

/* ==============
   Shared Types
   ============== */
export type MatchRow = { id: number; question: string; answer: string; similarity: number };
export type Passage = { id: number; question: string; answer: string; similarity: number };
export type ChatMsg = { role: 'user' | 'assistant'; content: string };
export type TicketDraft = {
  title: string;
  summary: string;
  severity?: 'low' | 'normal' | 'high' | 'critical';
  environment?: 'web' | 'ios' | 'android' | 'api' | 'unknown';
  steps?: string[];
  faq_refs?: number[];
};

/* =========================
   Small parsing / utilities
   ========================= */
function parseJsonLoose(s: string): any {
  const fenced = /```json([\s\S]*?)```/i.exec(s);
  const raw = fenced ? fenced[1] : s;
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  const slice = first >= 0 && last >= 0 ? raw.slice(first, last + 1) : raw;
  try { return JSON.parse(slice); } catch { return null; }
}

function toTranscript(chat: ChatMsg[]): string {
  return chat.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
}

function messagesToPlain(chat: ChatMsg[], limit = 50): string {
  const tail = chat.slice(-limit);
  return toTranscript(tail);
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
  for (const m of chat) for (const id of inferFaqRefsFromText(m.content)) set.add(id);
  return [...set];
}

/* =========================
   Answering (citations)
   ========================= */
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

export const LLM_MODEL = 'llama-3.1-8b-instant'; // Groq

export async function polishAnswer(userQ: string, passages: Passage[]): Promise<string> {
  if (!passages?.length) return `I’m not fully sure based on the current FAQs.`;

  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const { system, user } = buildAnswerPrompt(userQ, passages.slice(0, 3));
    const resp = await groq.chat.completions.create({
      model: LLM_MODEL,
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

  // Fallback: stitch top passage with a citation
  const top = passages[0];
  return `${top.answer} [FAQ-${top.id}]`;
}

export async function askForClarification(userQ: string): Promise<string> {
  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const system = `Ask ONE short clarifying question to resolve the user's issue.
No preamble. Keep it under 18 words.`;
    const user = `User said: "${userQ}"\nWhat is the single most useful follow-up question?`;
    const resp = await groq.chat.completions.create({
      model: LLM_MODEL,
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
  return `Could you share a bit more detail (what you tried, exact error/message, and your account email)?`;
}

/* =========================
   Ticket helpers
   ========================= */
function stripTicketCommands(chat: ChatMsg[]): ChatMsg[] {
  const re = /(open|create|raise|file|escalate).{0,20}ticket|^create ticket$|^open ticket$/i;
  return chat.filter(m => !re.test(m.content.toLowerCase()));
}

function inferEnvironment(chat: ChatMsg[]): 'web' | 'ios' | 'android' | 'api' | 'unknown' {
  const text = chat.map(m => m.content.toLowerCase()).join('  ');
  if (/ios|iphone|ipad|testflight|apple id|safari \(ios\)/.test(text)) return 'ios';
  if (/android|apk|play store|pixel|samsung|chrome \(android\)/.test(text)) return 'android';
  if (/api key|webhook|curl|endpoint|http 4\d\d|json|postman/.test(text)) return 'api';
  if (/browser|chrome|safari|edge|firefox|desktop|laptop|web app/.test(text)) return 'web';
  return 'unknown';
}

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

/* =========================
   Context packing for LLM
   ========================= */
const LLM_MAX_CONTEXT_TOKENS = 8000; // adjust if your Groq model supports more
const LLM_TARGET_OUTPUT_TOKENS = 700;
const SAFETY_TOKENS = 300;

function estimateTokens(s: string): number {
  return Math.ceil((s?.length || 0) / 4); // rough heuristic
}

async function summarizeHeadWithLLM(text: string): Promise<string> {
  if (!process.env.GROQ_API_KEY) {
    return text.slice(0, 4000) + '\n…';
  }
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const system = `
You are compressing an earlier chat segment for a support ticket.
Return 6-10 concise bullets capturing: problem, attempted steps, errors, constraints, and any [FAQ-123] refs you see.
Do not add new facts. Keep exact numbers/IDs/FAQ refs. Keep under ~400 words.
`.trim();
  const resp = await groq.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.2,
    max_tokens: 550,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Earlier chat to compress:\n${text}` },
    ],
  });
  return resp.choices?.[0]?.message?.content?.trim() || text.slice(0, 4000);
}

/**
 * Pack entire conversation up to the LLM input limit.
 * - If it fits, pass full transcript.
 * - If not, summarize the oldest ~70% and keep recent turns verbatim.
 */
export async function packConversationForLLM(fullChat: ChatMsg[]): Promise<string> {
  const budget = LLM_MAX_CONTEXT_TOKENS - LLM_TARGET_OUTPUT_TOKENS - SAFETY_TOKENS;
  const full = toTranscript(fullChat);
  if (estimateTokens(full) <= budget) return full;

  const splitIdx = Math.max(1, Math.floor(fullChat.length * 0.7));
  const head = toTranscript(fullChat.slice(0, splitIdx));
  const tail = toTranscript(fullChat.slice(splitIdx));
  const headSummary = await summarizeHeadWithLLM(head);

  let combined = `Conversation summary so far:\n${headSummary}\n\nRecent messages:\n${tail}`;
  if (estimateTokens(combined) <= budget) return combined;

  // If still too long, keep a suffix of recent messages that fits
  const recent = fullChat.slice(splitIdx);
  let lo = 0, hi = recent.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `Conversation summary so far:\n${headSummary}\n\nRecent messages:\n` +
      toTranscript(recent.slice(mid));
    if (estimateTokens(candidate) > budget) lo = mid + 1;
    else hi = mid;
  }
  return `Conversation summary so far:\n${headSummary}\n\nRecent messages:\n` +
    toTranscript(recent.slice(hi));
}

/* =========================
   Ticket summarization
   ========================= */
export async function summarizeForTicket(chat: ChatMsg[]): Promise<TicketDraft> {
  // Clean conversation and infer environment
  const cleaned = stripTicketCommands(chat);
  const envHint = inferEnvironment(cleaned);
  const faqRefs = inferFaqRefsFromChat(cleaned);

  const base: TicketDraft = {
    title: heuristicTitle(cleaned),
    summary: '',
    severity: 'normal',
    environment: envHint,
    steps: [],
    faq_refs: faqRefs,
  };

  // Fallback (no Groq): include full transcript (truncated by chars)
  if (!process.env.GROQ_API_KEY) {
    const transcript = toTranscript(cleaned);
    const draft: TicketDraft = {
      ...base,
      summary:
        `The user needs help related to: ${base.title}.\n\n` +
        `Recent conversation:\n${transcript.slice(0, 12000)}`,
      steps: ['Review conversation log', 'Respond according to policy'],
    };
    draft.summary = buildSummaryText(draft);
    return draft;
  }

  // Full conversation → pack if needed to fit model input
  const convo = await packConversationForLLM(cleaned);

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const system = `
Create an internal support ticket from the chat transcript.

Return STRICT JSON ONLY:
{
  "title": "concise issue (max 90 chars)",
  "summary": "2-5 sentences: what the user needs, key constraints/policy context",
  "severity": "low|normal|high|critical",
  "environment": "web|ios|android|api|unknown",
  "steps": ["bullet 1", "bullet 2"],
  "faq_refs": [135, 209]
}

Rules:
- Ignore meta commands like "create/open ticket".
- Ground ONLY in the transcript; do NOT invent order IDs or dates.
- If environment is unclear, use "unknown" (you MAY infer from cues).
- Extract [FAQ-123] numbers into faq_refs (unique).
- Keep JSON under 1200 chars.
`.trim();

  const resp = await groq.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.2,
    max_tokens: 700,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Transcript:\n${convo}\n\nHint: environment seen so far = ${envHint}` },
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

  const sev: TicketDraft['severity'] =
    obj.severity && ['low', 'normal', 'high', 'critical'].includes(obj.severity)
      ? obj.severity
      : base.severity;

  const env: TicketDraft['environment'] =
    (obj.environment as TicketDraft['environment']) || base.environment;

  const draft: TicketDraft = {
    ...base,
    title: obj.title || base.title,
    summary: obj.summary || base.summary,
    severity: sev,
    environment: env,
    steps: Array.isArray(obj.steps) ? obj.steps.slice(0, 10) : [],
    faq_refs: mergedRefs,
  };

  draft.summary = buildSummaryText(draft);
  return draft;
}
