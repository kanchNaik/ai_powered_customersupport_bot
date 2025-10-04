import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// Pick a small, free embedding model (384 dims)
const MODEL = 'intfloat/e5-small-v2';

// HF embedding call
async function embed(text: string): Promise<number[]> {
  const r = await fetch(`https://api-inference.huggingface.co/models/${MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: text,
      options: { wait_for_model: true }
    })
  });
  if (!r.ok) throw new Error(`HF error ${r.status} ${r.statusText}`);
  const out = await r.json();
  // HF can return [dim] or [[dim]]; normalize:
  const vec = Array.isArray(out?.[0]) ? out[0] : out;
  if (!Array.isArray(vec) || vec.length !== 384) throw new Error('Unexpected embedding shape');
  return vec.map(Number);
}

function dbAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "POST here to backfill embeddings for all FAQs.",
    tip: "Set HF_TOKEN in Vercel envs first. Use ?force=true to recompute all."
  });
}

export async function POST(req: Request) {
  try {
    const supabase = dbAdmin();
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';

    // If force, clear existing embeddings
    if (force) {
      const { error: clr } = await supabase.from('faq').update({ embedding: null }).gte('id', 0);
      if (clr) throw new Error(clr.message);
    }

    // Pull rows missing embeddings
    const { data: rows, error } = await supabase
      .from('faq').select('id, question, answer').is('embedding', null).limit(1000);
    if (error) throw new Error(error.message);
    if (!rows?.length) return NextResponse.json({ ok: true, updated: 0, note: 'Nothing to embed' });

    // e5 works best with instruction prefixes:
    //   "passage: " for documents; "query: " for queries
    // Here we embed doc text as "passage: question \n answer"
    for (const row of rows) {
      const text = `passage: ${row.question}\n${row.answer}`;
      const vec = await embed(text);
      const { error: upErr } = await supabase.from('faq')
        .update({ embedding: vec })
        .eq('id', row.id);
      if (upErr) throw new Error(upErr.message);
    }

    return NextResponse.json({ ok: true, updated: rows.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
