// lib/retrieval.ts
import { dbAnon } from './db';
import { DIMS, embedQuery, type MatchRow } from './llm';

export const TOP_K = 8;
export const MIN_SIM = 0.15;
export const STRONG_SIM = 0.33;
export const MARGIN_ACCEPT = 0.06;

export async function retrieveMatches(question: string) {
  const qvec = await embedQuery(question);
  if (qvec.length !== DIMS) throw new Error('Bad query embedding');

  const supabase = dbAnon();
  const { data, error } = await supabase.rpc('match_faq', {
    query_embedding: qvec,
    match_count: TOP_K,
    min_sim: MIN_SIM,
  });
  if (error) throw new Error(error.message);

  const results = (data ?? []) as MatchRow[];
  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}

export function isConfident(results: MatchRow[]) {
  const best = results[0];
  const second = results[1];
  if (!best) return { ok: false, best: undefined };
  const ok = best.similarity >= STRONG_SIM || (second && best.similarity - second.similarity >= MARGIN_ACCEPT);
  return { ok, best };
}
