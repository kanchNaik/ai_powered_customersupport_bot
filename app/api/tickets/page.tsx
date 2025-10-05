import { serverClient } from '@/lib/supabaseServer';
import { redirect } from 'next/navigation';

export default async function TicketsPage() {
  const supa = serverClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect('/login');

  const { data, error } = await supa.from('tickets')
    .select('id,title,status,priority,created_at')
    .order('id', { ascending:false });
  if (error) return <main className="p-6">Error: {error.message}</main>;

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">My Tickets</h1>
      <ul className="space-y-3">
        {(data ?? []).map(t => (
          <li key={t.id} className="border rounded p-3">
            <div className="font-medium">#{t.id} — {t.title}</div>
            <div className="text-sm opacity-75">{t.status} • {t.priority} • {new Date(t.created_at).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
