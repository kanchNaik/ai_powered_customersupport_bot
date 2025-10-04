import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// --- config (you can override via query params) ---
const DEFAULT_REPO = 'MakTek/Customer_support_faqs_dataset';
const DEFAULT_FILE = 'train_expanded.json'; // JSONL (one object per line) with {question, answer}

// Optional: require a token so random people can’t import into your DB
function assertAuth(req: Request) {
  const required = process.env.SEED_TOKEN; // set in Vercel envs if you want protection
  if (!required) return;
  const token = req.headers.get('x-seed-token');
  if (token !== required) {
    const res = NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    throw res;
  }
}

function admin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Parse JSONL (newline-delimited JSON) -> {question, answer}[]
function parseJSONL(text: string): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try {
      const o = JSON.parse(s);
      const q = (o.question ?? '').toString().trim();
      const a = (o.answer ?? '').toString().trim();
      if (q && a) out.push({ question: q, answer: a });
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

// Normalize to avoid double-updating same row within one upsert statement
function normKey(q: string) {
  return q.replace(/\s+/g, ' ').trim(); // keep case (you created a case-sensitive unique constraint)
}

function dedupe(rows: { question: string; answer: string }[]) {
  const m = new Map<string, { question: string; answer: string }>();
  for (const r of rows) {
    const key = normKey(r.question);
    if (!m.has(key)) m.set(key, { question: r.question.trim(), answer: r.answer.trim() });
  }
  return Array.from(m.values());
}

async function upsertInChunks(
  supabase: ReturnType<typeof admin>,
  rows: { question: string; answer: string }[]
) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('faq')
      .upsert(chunk, { onConflict: 'question' }); // matches your unique constraint
    if (error) throw new Error(error.message);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST /api/import-hf?force=true",
    params: { repo: `default: ${DEFAULT_REPO}`, file: `default: ${DEFAULT_FILE}` },
    notes: [
      "Requires columns: question, answer",
      "Uses upsert on unique(question); duplicates in the payload are de-duped first",
      "Add SEED_TOKEN env var to protect this route (send header x-seed-token)",
    ],
  });
}

export async function POST(req: Request) {
  try {
    assertAuth(req);

    const { searchParams } = new URL(req.url);
    const repo = searchParams.get('repo') || DEFAULT_REPO;
    const file = searchParams.get('file') || DEFAULT_FILE;
    const force = searchParams.get('force') === 'true';

    const rawUrl = `https://huggingface.co/datasets/${repo}/raw/main/${file}`;
    const r = await fetch(rawUrl);
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: `Fetch failed: ${r.status} ${r.statusText}` },
        { status: 502 }
      );
    }

    const text = await r.text();
    const parsed = parseJSONL(text);
    if (parsed.length === 0) {
      return NextResponse.json({ ok: false, error: 'No valid rows parsed' }, { status: 400 });
    }

    const rows = dedupe(parsed);
    const supabase = admin();

    if (force) {
      const { error: delErr } = await supabase.from('faq').delete().gte('id', 0);
      if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }

    await upsertInChunks(supabase, rows);

    return NextResponse.json({
      ok: true,
      inserted_or_updated: rows.length,
      repo,
      file,
      force,
    });
  } catch (e: any) {
    // If assertAuth threw a Response, return it
    if (e instanceof Response) return e;
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
