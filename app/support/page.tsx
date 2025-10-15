// app/support/page.tsx
import SupportChatClient from './support-client';

export const dynamic = 'force-dynamic'; // render with cookies/session

export default async function SupportPage() {
  // No redirect here—chat is public. Auth is handled client-side.
  return (
    <div className="mx-auto max-w-6xl p-4">
      <SupportChatClient />
    </div>
  );
}
