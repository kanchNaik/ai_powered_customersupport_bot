import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// BGE (384-d)
const MODEL = 'BAAI/bge-small-en-v1.5';
const DIMS = 384;
const BATCH = 16;

function dbAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeEmbeddings(out: any): number[][] {
  if (Array.isArray(out) && typeof out[0] === 'number') return [out.map(Number)];
  if (Array.isArray(out) && Array.isArray(out[0]) && typeof out[0][0] === 'number') {
    return out.map((row: any[]) => row.map(Number));
  }
  throw new Error('Unexpected embedding output shape from HF');
}

async function hfEmbed(inputs: string[]): Promise<number[][]> {
  const r = await fetch(`https://api-inference.huggingface.co/models/${MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs, options: { wait_for_model: true } }),
  });
  const body = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`HF ${MODEL} -> ${r.status} ${r.statusText}: ${body.slice(0, 300)}`);
  const json = body ? JSON.parse(body) : null;
  const vecs = normalizeEmbeddings(json);
  if (vecs[0]?.length !== DIMS) throw new Error(`HF ${MODEL} returned ${vecs[0]?.length} dims, expected ${DIMS}`);
  return vecs.length === inputs.length ? vecs : Array(inputs.length).fill(vecs[0]);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "POST to backfill embeddings for faq.embedding (vector(384)). Use ?force=true to recompute all.",
    model: MODEL
  });
}

export async function POST(req: Request) {
  try {
    if (!process.env.HF_TOKEN) return NextResponse.json({ ok: false, error: 'HF_TOKEN is missing' }, { status: 500 });

    const supabase = dbAdmin();
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

    // For documents, BGE does not need a special prefix
    const texts = rows.map(r => `${r.question}\n${r.answer}`);

    let updated = 0;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batchTexts = texts.slice(i, i + BATCH);
      const batchRows = rows.slice(i, i + BATCH);

      const vectors = await hfEmbed(batchTexts);

      for (let j = 0; j < batchRows.length; j++) {
        const { error: upErr } = await supabase
          .from('faq')
          .update({ embedding: vectors[j] })
          .eq('id', batchRows[j].id);
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
