// app/support/page.tsx
export const dynamic = 'force-dynamic'; // don't prerender, always render fresh

import SupportChatClient from './support-client';

export default function SupportPage({
  searchParams,
}: {
  searchParams?: { conv?: string };
}) {
  const conv = searchParams?.conv ?? '';
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Support chat</h1>
      <SupportChatClient initialConversationId={conv} />
    </div>
  );
}
