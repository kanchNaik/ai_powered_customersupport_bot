import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

// Lightweight token-based rate limit (optional)
const RATE_TOKEN = process.env.RATE_TOKEN; // set this in Vercel if you want to require a header

// Build a read-only client (anon key)
function db() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// simple tokenization + Jaccard similarity
function tokenize(s: string) {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 1));
}
function jaccard(a: Set<string>, b: Set<string>) {
  const inter = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : inter.size / union.size;
}

export async function POST(req: Request) {
  try {
    if (RATE_TOKEN) {
      const h = req.headers.get('x-rate-token');
      if (h !== RATE_TOKEN) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => null);
    const question = body?.question?.toString()?.trim();
    if (!question) {
      return NextResponse.json({ ok: false, error: "Provide JSON { question: '...' }" }, { status: 400 });
    }

    const client = db();
    // Try to fetch a narrowed candidate set using ILIKE on the most informative tokens
    const tokens = [...tokenize(question)];
    const topTokens = tokens.slice(0, 4); // cap to keep the query short

    let candidates: any[] = [];
    if (topTokens.length > 0) {
      const likeParts = topTokens.map(t => `question.ilike.%${t}%,answer.ilike.%${t}%`).join(',');
      const { data, error } = await client
        .from('faq')
        .select('id,question,answer')
        .or(likeParts)
        .limit(100);
      if (error) throw new Error(error.message);
      candidates = data ?? [];
    }

    // Fallback: if nothing matched, pull a small batch (your table is small)
    if (candidates.length === 0) {
      const { data, error } = await client
        .from('faq')
        .select('id,question,answer')
        .limit(150);
      if (error) throw new Error(error.message);
      candidates = data ?? [];
    }

    // Rank by Jaccard token overlap
    const qTokens = tokenize(question);
    const ranked = candidates
      .map(r => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        score: jaccard(qTokens, tokenize(`${r.question} ${r.answer}`))
      }))
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) {
      return NextResponse.json({ ok: true, found: false, message: "No FAQs available." });
    }

    const best = ranked[0];
    const threshold = 0.12; // tweakable; below this we say “not sure”
    const found = best.score >= threshold;

    return NextResponse.json({
      ok: true,
      found,
      answer: found ? best.answer : null,
      best_match_question: best.question,
      score: +best.score.toFixed(3),
      alternatives: ranked.slice(1, 4).map(r => ({
        id: r.id, question: r.question, score: +r.score.toFixed(3)
      }))
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST JSON { question: 'How do I reset my password?' } to this endpoint.",
    tip: "Add header x-rate-token if RATE_TOKEN is set."
  });
}
