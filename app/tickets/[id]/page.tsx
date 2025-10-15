// app/tickets/[id]/page.tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { serverClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function TicketDetailPage({ params }: { params: { id: string } }) {
  const supa = await serverClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) {
    // optional: redirect('/login?next=/tickets/' + params.id);
    notFound();
  }

  const { data: ticket, error } = await supa
    .from('tickets')
    .select('id, title, summary, status, priority, created_at, conversation_id')
    .eq('id', params.id)
    .eq('user_id', user!.id)
    .single();

  if (error || !ticket) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ticket #{ticket.id}</h1>
        <Link href="/tickets" className="text-sm underline">← Back to tickets</Link>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
        <div className="text-lg font-medium">{ticket.title}</div>
        <div className="text-sm text-slate-600 dark:text-slate-300">
          Status: <span className="font-medium">{ticket.status}</span> ·
          {' '}Priority: <span className="font-medium">{ticket.priority}</span> ·
          {' '}Created: {new Date(String(ticket.created_at)).toLocaleString()}
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800" />

        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {ticket.summary || 'No summary.'}
        </div>

        {ticket.conversation_id && (
          <div className="text-xs text-slate-500">
            Conversation: {ticket.conversation_id}
          </div>
        )}
      </div>
    </div>
  );
}
