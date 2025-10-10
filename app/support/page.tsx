// app/support/page.tsx
import { serverClient } from '@/lib/supabaseServer';
import SupportChatClient from './support-client';

export default async function SupportPage({ searchParams }: { searchParams: { conv?: string } }) {
  const supabase = await serverClient();
  const { data: { user } } = await supabase.auth.getUser(); // may be null (guest)
  return (
    <SupportChatClient
      userId={user?.id ?? ''}                     // empty means guest
      initialConversationId={searchParams.conv ?? ''}
    />
  );
}
