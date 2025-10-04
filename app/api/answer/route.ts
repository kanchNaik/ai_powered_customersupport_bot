import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { HfInference } from '@huggingface/inference';
import Groq from 'groq-sdk';

export const runtime = 'nodejs';

// Embeddings (BGE small, 384-d)
const EMBED_MODEL = 'BAAI/bge-small-en-v1.5';
const DIMS = 384;

// Retrieval
const TOP_K = 5;
const MIN_SIM = 0.30;   // minimum to consider relevant
const STRONG_SIM = 0.45; // if below this, we’ll return “not confident”

// LLM
const LLM_MODEL = 'llama-3.1-8b-instant'; // fast + free-friendly

const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

function dbAnon() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function as1d(a: any): number[] {
  if (Array.isArray(a) && typeof a[0] === 'number') return a.map(Number);
  if (Array.isArray(a) && Array.isArray(a[0])) return (a[0] as any[]).map(Number);
  if (a instanceof Float32Array) return Array.from(a);
  if (Array.isArray(a) && a[0] instanceof Float32Array) return Array.from(a[0] as Float32Array);
  throw new Error('Unexpected embedding shape from HF');
}

async function embedQuery(q: string): Promise<number[]> {
  if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN is missing');
  const hf = new HfInference(process.env.HF_TOKEN);
  const data = await hf.featureExtraction({
    model: EMBED_MODEL,
    inputs: QUERY_PREFIX + q,
    // @ts-ignore
    options: { wait_for_model: true },
  });
  const vec = as1d(data);
  if (vec.length !== DIMS) throw new Error(`HF dims ${vec.length} != expected ${DIMS}`);
  return vec;
}

function buildPrompt(userQ: string, passages: Array<{id:number, question:string, answer:string, similarity:number}>) {
  const context = passages.map(p =>
    `[FAQ-${p.id}] Q: ${p.question}\nA: ${p.answer}`
  ).join('\n\n');

  return {
    system: `You are a support assistant. Answer ONLY using the provided FAQs.
- Be concise (1–3 short paragraphs or fewer).
- If not enough info, say you’re not sure and suggest the closest FAQs.
- Cite facts with [FAQ-<id>] tokens at the end of sentences where used.
- Never fabricate.`,
    user: `User question: ${userQ}

Context FAQs:
${context}

Instructions:
1) Answer the user's question as accurately as possible using the context.
2) If unsure (context weak), say "I’m not fully sure" and list up to 3 relevant FAQs by id.
3) Include citations like [FAQ-12] after claims grounded in a specific FAQ.`
  };
}

async function llmAnswer(userQ: string, ctx: Array<{id:number, question:string, answer:string, similarity:number}>) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is missing');
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const { system, user } = buildPrompt(userQ, ctx);

  const chat = await groq.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  return chat.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST JSON { question: 'How do I reset my password?' }",
    note: "Embeds query (BGE) → pgvector match → LLM writes answer with [FAQ-id] citations."
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const question = body?.question?.toString()?.trim();
    if (!question) return NextResponse.json({ ok: false, error: "Provide JSON { question: '...' }" }, { status: 400 });

    // 1) Embed query
    const qvec = await embedQuery(question);

    // 2) Retrieve via pgvector
    const supabase = dbAnon();
    const { data, error } = await supabase.rpc('match_faq', {
      query_embedding: qvec,
      match_count: TOP_K,
      min_sim: MIN_SIM,
    });
    if (error) throw new Error(error.message);

    const results = (data ?? []).map((r: any) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      similarity: Number(r.similarity ?? 0),
    })).sort((a,b) => b.similarity - a.similarity);

    const best = results[0];
    if (!best) {
      return NextResponse.json({
        ok: true,
        found: false,
        message: "I couldn’t find anything relevant in the FAQs.",
        alternatives: []
      });
    }

    // 3) If top hit is weak, don’t hallucinate
    if (best.similarity < STRONG_SIM) {
      return NextResponse.json({
        ok: true,
        found: false,
        message: "I’m not fully sure based on the current FAQs.",
        suggestions: results.slice(0, 3).map(r => ({
          id: r.id, question: r.question, similarity: Number(r.similarity.toFixed(3))
        })),
      });
    }

    // 4) Let LLM write a concise answer using top-3 as context
    const contextForLLM = results.slice(0, 3);
    const answer = await llmAnswer(question, contextForLLM);

    return NextResponse.json({
      ok: true,
      found: true,
      answer,
      best_match: {
        id: best.id,
        question: best.question,
        similarity: Number(best.similarity.toFixed(3)),
      },
      sources: contextForLLM.map(r => ({
        id: r.id,
        question: r.question,
        similarity: Number(r.similarity.toFixed(3)),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
