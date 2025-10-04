'use client';

import { useState } from 'react';

export default function Home() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  async function ask() {
    setLoading(true);
    setRes(null);
    const r = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: q })
    });
    const j = await r.json();
    setRes(j);
    setLoading(false);
  }
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Support Bot — FAQ Answer</h1>
      <div className="flex gap-2">
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Ask a question…" className="flex-1 border rounded px-3 py-2"/>
        <button onClick={ask} disabled={!q || loading} className="border rounded px-4">{loading ? '…' : 'Ask'}</button>
      </div>
      {res && (
        <div className="border rounded p-4">
          <div className="text-sm opacity-70 mb-2">score: {res.score}</div>
          {res.found ? (
            <>
              <div className="font-medium mb-1">Answer</div>
              <div className="mb-3">{res.answer}</div>
            </>
          ) : <div className="text-yellow-700">Not confident. Here are close matches:</div>}
          {res.alternatives?.length > 0 && (
            <ul className="list-disc pl-5">
              {res.alternatives.map((a:any)=>(
                <li key={a.id} className="opacity-80">{a.question} <span className="text-xs">({a.score})</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
