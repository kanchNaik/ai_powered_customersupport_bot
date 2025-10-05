// app/support/support-client.tsx
'use client';
import { useEffect, useRef, useState } from 'react';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

export default function SupportChatClient({ userId }: { userId: string }) {
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const c = localStorage.getItem('support.conversationId') || '';
    const m = localStorage.getItem('support.messages');
    if (c) setConversationId(c);
    if (m) try { setMessages(JSON.parse(m)); } catch {}
  }, []);
  useEffect(() => {
    conversationId
      ? localStorage.setItem('support.conversationId', conversationId)
      : localStorage.removeItem('support.conversationId');
    localStorage.setItem('support.messages', JSON.stringify(messages));
  }, [conversationId, messages]);

  async function send(msg: string, forceTicket?: boolean) {
    const text = msg.trim(); if (!text || loading) return;
    setMessages(m => [...m, { role: 'user', content: text }]);
    setLoading(true); setInput('');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text, forceTicket }),
      });
      const j = await r.json();
      if (j?.conversationId && !conversationId) setConversationId(j.conversationId);
      if (j?.reply) setMessages(m => [...m, { role: 'assistant', content: j.reply }]);
      else if (j?.error) setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${j.error}` }]);
    } catch (e:any) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e?.message || e}` }]);
    } finally { setLoading(false); }
  }

  function newConversation() {
    setConversationId(''); setMessages([]);
    localStorage.removeItem('support.conversationId');
    localStorage.removeItem('support.messages');
  }

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Support Chat</h1>
        <div className="text-xs opacity-70">signed in</div>
      </header>

      <div className="flex items-center gap-3 text-sm">
        <div className="rounded bg-gray-100 px-2 py-1">
          Conversation: <span className="font-mono">{conversationId || 'new'}</span>
        </div>
        <button className="rounded border px-3 py-1 hover:bg-gray-50" onClick={newConversation} disabled={loading}>
          New chat
        </button>
        <a href="/tickets" className="ml-auto rounded border px-3 py-1 hover:bg-gray-50">My tickets</a>
      </div>

      <div className="h-[60vh] overflow-y-auto rounded border p-4 space-y-3 bg-white">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[80%] whitespace-pre-wrap rounded px-3 py-2 ${
              m.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        <div ref={endRef} />
        {!messages.length && (
          <div className="text-center text-sm opacity-60">
            Describe your issue (e.g., “it’s not working”). I’ll try to help; I can also create a support ticket.
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Describe the issue…"
          className="flex-1 rounded border px-3 py-2"
          disabled={loading}
        />
        <button className="rounded border px-4 py-2 hover:bg-gray-50" onClick={() => send(input)} disabled={loading || !input.trim()}>
          {loading ? '…' : 'Send'}
        </button>
        <button className="rounded border px-4 py-2 hover:bg-gray-50" onClick={() => send('create ticket', true)} disabled={loading}>
          Create ticket
        </button>
      </div>
    </main>
  );
}
