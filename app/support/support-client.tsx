'use client';
import { useEffect, useRef, useState } from 'react';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

export default function SupportChatClient({
  initialConversationId = '',
}: {
  initialConversationId?: string;
}) {
  const [conversationId, setConversationId] = useState<string>(initialConversationId);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', content: '👋 I’m ready. Ask me anything about your account or product.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!initialConversationId) {
      const savedConv = localStorage.getItem('support.conversationId') || '';
      const savedMsgs = localStorage.getItem('support.messages');
      if (savedConv) setConversationId(savedConv);
      if (savedMsgs) { try { setMessages(JSON.parse(savedMsgs)); } catch {} }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (conversationId) localStorage.setItem('support.conversationId', conversationId);
    else localStorage.removeItem('support.conversationId');
    localStorage.setItem('support.messages', JSON.stringify(messages));
  }, [conversationId, messages]);

  async function send(msg: string, forceTicket?: boolean) {
    const text = msg.trim();
    if (!text || loading) return;

    setMessages(m => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);

    try {
      const shortHistory = messages.slice(-20);
      const res = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include', // works for logged-in users, harmless for guests
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          forceTicket,
          history: shortHistory,
        }),
      });
      const j = await res.json();

      if (j?.conversationId && !conversationId) setConversationId(j.conversationId);

      if (j?.action === 'login_required') {
        if (j?.ticketDraft) {
          sessionStorage.setItem('support.pendingTicketDraft', JSON.stringify(j.ticketDraft));
        }
        window.location.href = j?.loginUrl || '/login?next=/support&pending=ticket';
        return;
      }

      if (j?.reply) {
        setMessages(m => [...m, { role: 'assistant', content: j.reply }]);
      } else if (j?.error) {
        setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${j.error}` }]);
      }
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e?.message || e}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* visible “loaded” tag */}
      <div className="text-xs text-slate-500 dark:text-slate-400">client loaded ✓</div>

      <div className="h-[60vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 whitespace-pre-wrap shadow-sm
                ${m.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'}`}
            >
              {m.content}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Describe the issue…"
          className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 shadow-sm focus-visible:ring-2"
          disabled={loading}
        />
        <button
          className="rounded-xl bg-indigo-600 text-white px-4 py-2 shadow hover:bg-indigo-700 disabled:opacity-60"
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
        >
          {loading ? '…' : 'Send'}
        </button>
        <button
          className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => send('create ticket', true)}
          disabled={loading}
          title="Create a ticket from this chat"
        >
          Create ticket
        </button>
      </div>
    </div>
  );
}
