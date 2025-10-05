import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabaseServer';
import SupportChatClient from './support-client';

export default async function SupportPage() {
  const supabase = serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return <SupportChatClient userId={user.id} />;
}
