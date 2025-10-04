import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { HfInference } from '@huggingface/inference';

export const runtime = 'nodejs';

const MODEL = 'BAAI/bge-small-en-v1.5';
const DIMS = 384;
const TOP_K = 5;
const MIN_SIM = 0.30;
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

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST JSON { question: 'How do I reset my password?' }",
    note: 'BGE embeddings + pgvector match_faq().'
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const question = body?.question?.toString()?.trim();
    if (!question) return NextResponse.json({ ok: false, error: "Provide JSON { question: '...' }" }, { status: 400 });
    if (!process.env.HF_TOKEN) return NextResponse.json({ ok: false, error: 'HF_TOKEN is missing' }, { status: 500 });

    const hf = new HfInference(process.env.HF_TOKEN);

    // Embed query with BGE instruction
    const data = await hf.featureExtraction({
      model: MODEL,
      inputs: QUERY_PREFIX + question,
      // @ts-ignore
      options: { wait_for_model: true },
    });
    const qvec = as1d(data);
    if (qvec.length !== DIMS) throw new Error(`HF dims ${qvec.length} != expected ${DIMS}`);

    const supabase = dbAnon();
    const { data: matches, error } = await supabase.rpc('match_faq', {
      query_embedding: qvec,
      match_count: TOP_K,
      min_sim: MIN_SIM,
    });
    if (error) throw new Error(error.message);

    const results = (matches ?? []).map((r: any) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      similarity: Number(r.similarity?.toFixed(3) ?? 0),
    }));

    const best = results[0];
    return NextResponse.json({
      ok: true,
      found: !!best,
      answer: best?.answer ?? null,
      best_match_question: best?.question ?? null,
      similarity: best?.similarity ?? 0,
      alternatives: results.slice(1, 4),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
