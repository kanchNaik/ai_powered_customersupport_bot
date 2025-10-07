'use client';
import { useEffect, useRef, useState } from 'react';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

export default function SupportChatClient({
  userId,
  initialConversationId = '',
}: {
  userId: string;
  initialConversationId?: string;
}) {
  const [conversationId, setConversationId] = useState<string>(initialConversationId);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!initialConversationId) {
      const c = localStorage.getItem('support.conversationId') || '';
      const m = localStorage.getItem('support.messages');
      if (c) setConversationId(c);
      if (m) try { setMessages(JSON.parse(m)); } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    conversationId
      ? localStorage.setItem('support.conversationId', conversationId)
      : localStorage.removeItem('support.conversationId');
    localStorage.setItem('support.messages', JSON.stringify(messages));
  }, [conversationId, messages]);

  async function send(msg: string, forceTicket?: boolean) {
    const text = msg.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setLoading(true);
    setInput('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text, forceTicket }),
      });
      const j = await res.json();
      if (j?.conversationId && !conversationId) setConversationId(j.conversationId);
      if (j?.reply) {
        setMessages((m) => [...m, { role: 'assistant', content: j.reply }]);
      } else if (j?.error) {
        setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${j.error}` }]);
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e?.message || e}` }]);
    } finally {
      setLoading(false);
    }
  }

  function newConversation() {
    setConversationId('');
    setMessages([]);
    localStorage.removeItem('support.conversationId');
    localStorage.removeItem('support.messages');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          signed in as <span className="font-mono">{userId.slice(0, 8)}…</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1">
            Conversation: <span className="font-mono">{conversationId || 'new'}</span>
          </span>
          <button
            className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={newConversation}
            disabled={loading}
          >
            New chat
          </button>
          <a
            href="/tickets"
            className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            My tickets
          </a>
        </div>
      </div>

      <div className="h-[60vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
        {!messages.length && (
          <div className="text-center text-sm text-slate-500 dark:text-slate-400">
            Ask anything (e.g., “reset password”). I’ll cite FAQs, ask follow-ups if unsure,
            or create a ticket when needed.
          </div>
        )}
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
