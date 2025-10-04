import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function admin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Default to the dataset/file you shared; override with ?repo=...&file=...
const DEFAULT_REPO = 'MakTek/Customer_support_faqs_dataset';
const DEFAULT_FILE = 'train_expanded.json';

// Simple JSONL parser (one JSON object per line)
function parseJSONL(text: string): { question: string; answer: string }[] {
  const rows: { question: string; answer: string }[] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || !s.startsWith('{')) continue;
    try {
      const obj = JSON.parse(s);
      if (obj.question && obj.answer) rows.push({ question: obj.question, answer: obj.answer });
    } catch {
      // ignore malformed lines
    }
  }
  return rows;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST /api/import-hf?force=true",
    params: {
      repo: "optional, default MakTek/Customer_support_faqs_dataset",
      file: "optional, default train_expanded.json"
    },
    note: "Dataset is JSONL with fields: question, answer (Apache-2.0)."
  });
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const repo = searchParams.get('repo') || DEFAULT_REPO;
    const file = searchParams.get('file') || DEFAULT_FILE;
    const force = searchParams.get('force') === 'true';

    // Hugging Face raw file URL
    const rawUrl = `https://huggingface.co/datasets/${repo}/raw/main/${file}`;

    const r = await fetch(rawUrl);
    if (!r.ok) return NextResponse.json({ ok: false, error: `Fetch failed: ${r.status} ${r.statusText}` }, { status: 502 });

    const text = await r.text();
    const rows = parseJSONL(text);
    if (rows.length === 0) return NextResponse.json({ ok: false, error: 'No valid rows parsed' }, { status: 400 });

    const supabase = admin();

    if (force) {
      const { error: delErr } = await supabase.from('faq').delete().gte('id', 0);
      if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }

    // Upsert on question to avoid duplicates if re-running
    const { error } = await supabase.from('faq').upsert(rows, { onConflict: 'question' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, inserted: rows.length, repo, file, force });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
