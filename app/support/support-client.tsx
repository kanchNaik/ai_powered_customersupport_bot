'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { browserClient } from '@/lib/supabaseBrowser';

type ChatMsg = { role: 'user' | 'assistant'; content: string };
type ConvItem = { id: string; title: string; last_at: string };

export default function SupportChatClient() {
  const supabase = useMemo(() => browserClient(), []);
  const [authed, setAuthed] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [conversationId, setConversationId] = useState<string>('');
  const [convs, setConvs] = useState<ConvItem[]>([]);
  const [loadingConvs, setLoadingConvs] = useState<boolean>(false);

  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', content: '👋 I’m here. Ask about your account or product.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const didAutoOpen = useRef(false);

  // auth + initial load
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setAuthed(!!user);
      setUserEmail(user?.email ?? null);

      const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
        const isAuthed = !!session?.user;
        setAuthed(isAuthed);
        setUserEmail(session?.user?.email ?? null);
        if (isAuthed) {
          loadConversations();
        } else {
          // guest mode
          setConvs([]);
          setConversationId('');
          restoreGuest();
        }
      });
      unsub = () => sub.subscription.unsubscribe();

      if (user) {
        loadConversations();
      } else {
        restoreGuest();
      }
    })();
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep view pinned to bottom
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // persist guest messages
  useEffect(() => {
    if (!authed) {
      conversationId
        ? localStorage.setItem('support.conversationId', conversationId)
        : localStorage.removeItem('support.conversationId');
      localStorage.setItem('support.messages', JSON.stringify(messages));
    }
  }, [authed, conversationId, messages]);

  function restoreGuest() {
    const savedMsgs = localStorage.getItem('support.messages');
    if (savedMsgs) {
      try { setMessages(JSON.parse(savedMsgs)); } catch {}
    }
  }

  async function loadConversations() {
    try {
      setLoadingConvs(true);
      const res = await fetch('/api/my/conversations', { credentials: 'include' });
      const j = await res.json();
      if (j?.ok) {
        setConvs(j.items || []);
      }
    } finally {
      setLoadingConvs(false);
    }
  }

  // auto-open latest conversation when authed & list arrives
  useEffect(() => {
    if (authed && !conversationId && convs.length > 0 && !didAutoOpen.current) {
      didAutoOpen.current = true;
      openConversation(convs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, convs]);

  async function openConversation(id: string) {
    if (!id) return;
    setConversationId(id);
    setLoadingConversation(true);
    setMessages([{ role: 'assistant', content: 'Loading conversation…' }]);
    try {
      const res = await fetch(`/api/my/messages?id=${encodeURIComponent(id)}`, { credentials: 'include' });
      const j = await res.json();
      if (j?.ok) {
        const msgs: ChatMsg[] = (j.messages as any[])?.map(m => ({ role: m.role, content: m.content })) || [];
        setMessages(
          msgs.length
            ? msgs
            : [{ role: 'assistant', content: 'This conversation has no messages yet.' }]
        );
      } else {
        setMessages([{ role: 'assistant', content: j?.error || 'Failed to load messages.' }]);
      }
    } catch (e: any) {
      setMessages([{ role: 'assistant', content: `⚠️ ${e?.message || e}` }]);
    } finally {
      setLoadingConversation(false);
    }
  }

  function newChat() {
    setConversationId('');
    setMessages([{ role: 'assistant', content: '🆕 New chat — how can I help?' }]);
    if (!authed) {
      localStorage.removeItem('support.conversationId');
      localStorage.removeItem('support.messages');
    }
    didAutoOpen.current = true; // avoid auto-opening old convs right after New chat
  }

  async function send(msg: string, forceTicket?: boolean) {
    const text = msg.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);

    try {
      const shortHistory = messages.slice(-20);
      const res = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          forceTicket,
          history: shortHistory,
        }),
      });
      const j = await res.json();

      // if server created a new conversation, store it & refresh list
      if (j?.conversationId && !conversationId) {
        setConversationId(j.conversationId);
        if (authed) loadConversations();
      }

      if (j?.action === 'login_required') {
        if (j?.ticketDraft) {
          sessionStorage.setItem('support.pendingTicketDraft', JSON.stringify(j.ticketDraft));
        }
        window.location.href = j?.loginUrl || '/login?next=/support&pending=ticket';
        return;
      }

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

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px,minmax(0,1fr)] gap-4">
      {/* LEFT: Sidebar */}
      <aside className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-sm flex flex-col h-[80vh]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            className="w-full rounded-xl bg-indigo-600 text-white px-3 py-2 hover:bg-indigo-700"
            onClick={newChat}
            disabled={loading}
            title="Start a new conversation"
          >
            + New chat
          </button>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          {authed ? (userEmail || 'signed in') : 'guest (sign in to save)'}
        </div>

        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Chats</div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {!authed && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Sign in to see your previous chats.
            </div>
          )}
          {authed && loadingConvs && (
            <div className="text-xs text-slate-500 dark:text-slate-400">Loading…</div>
          )}
          {authed && !loadingConvs && convs.length === 0 && (
            <div className="text-xs text-slate-500 dark:text-slate-400">No previous chats</div>
          )}
          {authed && convs.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`w-full text-left rounded-lg px-3 py-2 border
                ${conversationId === c.id
                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30'
                  : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              title={c.title}
            >
              <div className="truncate text-sm">{c.title || 'New chat'}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {new Date(c.last_at).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* RIGHT: Chat */}
      <section className="flex flex-col h-[80vh]">
        <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
          {loadingConversation ? (
            <div className="text-sm text-slate-500">Loading conversation…</div>
          ) : (
            messages.map((m, i) => (
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
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="mt-3 flex gap-2">
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

        {!authed && (
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            You’re chatting as a guest. <a className="underline" href="/login?next=/support">Sign in</a> to save and revisit conversations.
          </div>
        )}
      </section>
    </div>
  );
}
