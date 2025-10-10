import type { Metadata } from 'next';
import './globals.css';
import { Inter } from 'next/font/google';
import ThemeToggle from './components/theme-toggle';  // ⬅️ use the client component
import AuthButton from './components/auth-button';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Support Assistant',
  description: 'RAG-powered helpdesk chatbot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100`}
      >
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
          <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-950/70 backdrop-blur">
            <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
              <div className="font-semibold">Support Assistant</div>
              <nav className="ml-auto flex items-center gap-2 text-sm">
                <a className="rounded px-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-800" href="/support">Chat</a>
                <a className="rounded px-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-800" href="/dashboard">Dashboard</a>
                <a className="rounded px-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-800" href="/tickets">Tickets</a>
                <AuthButton /> 
                <ThemeToggle />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        </div>

        {/* Set initial theme at first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const m = window.matchMedia('(prefers-color-scheme: dark)').matches;
                const c = localStorage.getItem('theme');
                const dark = c ? c === 'dark' : m;
                document.documentElement.classList.toggle('dark', dark);
              } catch {}
            `,
          }}
        />
      </body>
    </html>
  );
}
