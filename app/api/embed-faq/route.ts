import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { HfInference } from '@huggingface/inference';

export const runtime = 'nodejs';

const MODEL = 'BAAI/bge-small-en-v1.5'; // 384-d
const DIMS = 384;
const BATCH = 16;

function dbAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

const truncate = (s: string, max = 1500) => (s.length > max ? s.slice(0, max) : s);

function as2d(a: any): number[][] {
  // HF SDK returns Float32Array | Float32Array[] | number[] | number[][]
  if (Array.isArray(a) && typeof a[0] === 'number') return [a.map(Number)];
  if (Array.isArray(a) && Array.isArray(a[0])) return (a as any[]).map((row) => Array.from(row as any).map(Number));
  if (a instanceof Float32Array) return [Array.from(a)];
  if (Array.isArray(a) && a[0] instanceof Float32Array) return (a as any[]).map((row) => Array.from(row as Float32Array));
  throw new Error('Unexpected embedding shape from HF');
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'POST to backfill faq.embedding (vector(384)). Use ?force=true to recompute all.',
    model: MODEL
  });
}

export async function POST(req: Request) {
  try {
    if (!process.env.HF_TOKEN) return NextResponse.json({ ok: false, error: 'HF_TOKEN is missing' }, { status: 500 });

    const supabase = dbAdmin();
    const hf = new HfInference(process.env.HF_TOKEN);
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';

    if (force) {
      const { error: clr } = await supabase.from('faq').update({ embedding: null }).gte('id', 0);
      if (clr) throw new Error(clr.message);
    }

    const { data: rows, error } = await supabase
      .from('faq')
      .select('id, question, answer')
      .is('embedding', null)
      .limit(2000);
    if (error) throw new Error(error.message);
    if (!rows?.length) return NextResponse.json({ ok: true, updated: 0, note: 'Nothing to embed' });

    const texts = rows.map((r) => truncate(`${r.question}\n${r.answer}`, 1500));

    let updated = 0;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batchTexts = texts.slice(i, i + BATCH);
      const batchRows = rows.slice(i, i + BATCH);

      // Pass an array of strings to get array-of-vectors back
      const data = await hf.featureExtraction({
        model: MODEL,
        inputs: batchTexts,
        // @ts-ignore – options is supported by the API
        options: { wait_for_model: true },
      });

      const vectors = as2d(data);
      if (!vectors[0] || vectors[0].length !== DIMS) {
        throw new Error(`HF dims ${vectors[0]?.length} != expected ${DIMS}`);
      }

      for (let j = 0; j < batchRows.length; j++) {
        const { error: upErr } = await supabase.from('faq').update({ embedding: vectors[j] }).eq('id', batchRows[j].id);
        if (upErr) throw new Error(upErr.message);
        updated++;
      }
    }

    return NextResponse.json({ ok: true, updated, model: MODEL });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
