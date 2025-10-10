// app/support/support-client.tsx
'use client';
import { useEffect, useRef, useState } from 'react';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

export default function SupportChatClient({
  userId = '',
  initialConversationId = '',
}: {
  userId?: string;                      // 👈 optional
  initialConversationId?: string;
}) {
  // ... existing state/logic ...

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {userId ? (
            <>signed in as <span className="font-mono">{userId.slice(0, 8)}…</span></>
          ) : (
            <>you’re chatting as <span className="font-medium">guest</span></>
          )}
        </div>
        {/* rest of your header buttons */}
      </div>

      {/* rest of your component unchanged */}
    </div>
  );
}
