import { NextResponse } from 'next/server';
import { retrieveMatches, isConfident } from '@/lib/retrieval';
import { polishAnswer } from '@/lib/llm';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const question = String(body?.question ?? '').trim();
    if (!question) return NextResponse.json({ ok:false, error:'Missing question' }, { status:400 });

    const results = await retrieveMatches(question);
    const { ok: confident, best } = isConfident(results);

    if (!confident || !best) {
      return NextResponse.json({
        ok: true, found: false,
        message: "I’m not fully sure based on the current FAQs.",
        suggestions: results.slice(0,3).map(r=>({ id:r.id, question:r.question, similarity:+r.similarity.toFixed(3) }))
      });
    }

    const context = results.slice(0,3);
    const answer = await polishAnswer(question, context);
    return NextResponse.json({
      ok: true, found: true, answer,
      best_match: { id: best.id, question: best.question, similarity: +best.similarity.toFixed(3) },
      sources: context.map(r=>({ id:r.id, question:r.question, similarity:+r.similarity.toFixed(3) }))
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message ?? 'Unknown error' }, { status:500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok:true, usage:"POST { question }" });
}
