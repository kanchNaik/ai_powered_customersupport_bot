// app/tickets/page.tsx
import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabaseServer';
import Link from 'next/link';

export const dynamic = 'force-dynamic'; // always render fresh

export default async function TicketsPage() {
  const supa = await serverClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect('/login?next=/tickets');

  const { data: tickets, error } = await supa
    .from('tickets')
    .select('id, title, status, priority, created_at')
    .eq('user_id', user.id)
    .order('id', { ascending: false });

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold">My tickets</h1>
        <p className="mt-2 text-sm text-red-600">Error: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">My tickets</h1>

      {!tickets?.length ? (
        <p className="text-sm text-slate-500">
          No tickets yet. Create one from <a className="underline" href="/support">Support</a>.
        </p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
  <div className="flex items-center justify-between">
    <Link href={`/tickets/${t.id}`} className="font-medium hover:underline">
      #{t.id} — {t.title}
    </Link>
    <div className="text-xs text-slate-500">
      {new Date(String(t.created_at)).toLocaleString()}
    </div>
  </div>
  <div className="text-sm text-slate-600 dark:text-slate-300">
    Status: {t.status} · Priority: {t.priority}
  </div>
</li>
          ))}
        </ul>
      )}
    </div>
  );
}
