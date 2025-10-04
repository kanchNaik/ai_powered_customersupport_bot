import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// BGE (384-d)
const MODEL = 'BAAI/bge-small-en-v1.5';
const DIMS = 384;
const BATCH = 16;
const HF_URL = `https://api-inference.huggingface.co/pipeline/feature-extraction/${MODEL}`;

function dbAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// keep inputs modest to avoid model/payload issues
const truncate = (s: string, max = 1500) => (s.length > max ? s.slice(0, max) : s);

function normOut(out: any): number[][] {
  // HF feature-extraction returns number[] or number[][]
  if (Array.isArray(out) && typeof out[0] === 'number') return [out.map(Number)];
  if (Array.isArray(out) && Array.isArray(out[0]) && typeof out[0][0] === 'number') {
    return out.map((row: any[]) => row.map(Number));
  }
  throw new Error('Unexpected HF output shape');
}

async function hfEmbed(texts: string[]): Promise<number[][]> {
  const r = await fetch(HF_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
  });

  const body = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`HF ${r.status} ${r.statusText}: ${body.slice(0, 400)}`);

  const json = body ? JSON.parse(body) : null;
  const vecs = normOut(json);
  if (vecs[0]?.length !== DIMS) {
    throw new Error(`HF dims ${vecs[0]?.length} != expected ${DIMS}`);
  }
  return vecs.length === texts.length ? vecs : Array(texts.length).fill(vecs[0]);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'POST to backfill faq.embedding (vector(384)). ?force=true recomputes all.',
    model: MODEL,
  });
}

export async function POST(req: Request) {
  try {
    if (!process.env.HF_TOKEN) {
      return NextResponse.json({ ok: false, error: 'HF_TOKEN is missing' }, { status: 500 });
    }

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

    // BGE: no prefix needed for docs
    const texts = rows.map(r => truncate(`${r.question}\n${r.answer}`, 1500));

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
