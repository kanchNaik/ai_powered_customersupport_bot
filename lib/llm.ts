// lib/llm.ts
import { HfInference } from '@huggingface/inference';
import Groq from 'groq-sdk';

export const EMBED_MODEL = 'BAAI/bge-small-en-v1.5';
export const DIMS = 384;
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

function as1d(a: unknown): number[] {
  if (Array.isArray(a) && typeof a[0] === 'number') return (a as number[]).map(Number);
  if (Array.isArray(a) && Array.isArray(a[0])) return (a[0] as number[]).map(Number);
  if (a instanceof Float32Array) return Array.from(a);
  if (Array.isArray(a) && a[0] instanceof Float32Array) return Array.from(a[0] as Float32Array);
  throw new Error('Unexpected embedding shape from HF');
}

export async function embedQuery(text: string): Promise<number[]> {
  const token = process.env.HF_TOKEN!;
  const hf = new HfInference(token);
  const data = await hf.featureExtraction({
    model: EMBED_MODEL,
    inputs: QUERY_PREFIX + text,
    options: { wait_for_model: true },
  });
  const vec = as1d(data);
  if (vec.length !== DIMS) throw new Error(`HF dims ${vec.length} != expected ${DIMS}`);
  return vec;
}

export type MatchRow = { id: number; question: string; answer: string; similarity: number };

export function buildAnswerPrompt(userQ: string, ctx: MatchRow[]) {
  const context = ctx.map(p => `[FAQ-${p.id}] Q: ${p.question}\nA: ${p.answer}`).join('\n\n');
  return {
    system: `You are a support assistant. Answer ONLY using the provided FAQs.
- Be concise (<= 4 sentences).
- Cite facts with [FAQ-<id>].
- If unsure, say you're not fully sure and list up to 3 close FAQs.`,
    user: `User question: ${userQ}\n\nContext FAQs:\n${context}`
  };
}

export async function polishAnswer(userQ: string, ctx: MatchRow[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY!;
  const groq = new Groq({ apiKey });
  const { system, user } = buildAnswerPrompt(userQ, ctx);
  const chat = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
  });
  return chat.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function askForClarification(userQ: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY!;
  const groq = new Groq({ apiKey });
  const system = `You are a support triage assistant. Ask for the minimum details to reproduce a problem. Return 1–2 short questions.`;
  const user   = `User said: "${userQ}". Ask focused follow-ups (steps, exact error text, environment).`;
  const chat = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    temperature: 0.2,
    max_tokens: 120,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
  });
  return chat.choices?.[0]?.message?.content?.trim() ?? 'Could you share exact steps, error message, and your browser/OS?';
}

export async function summarizeForTicket(history: { role: string; content: string }[]) {
  const apiKey = process.env.GROQ_API_KEY!;
  const groq = new Groq({ apiKey });
  const system = `You are an internal support tool. Produce a crisp ticket title and summary from chat.
Title <= 12 words. Summary 4–8 bullet points (steps, error text, environment, severity). Return JSON { "title": "...", "summary": "..." }`;
  const user = `Chat transcript:\n${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`;
  const chat = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    temperature: 0.2,
    max_tokens: 300,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
  });
  const text = chat.choices?.[0]?.message?.content ?? '';
  try { return JSON.parse(text); }
  catch {
    return { title: 'Support ticket from chat', summary: text.slice(0, 1000) };
  }
}
