'use client';

export default function ThemeToggle() {
  return (
    <button
      aria-label="Toggle theme"
      className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
      onClick={() => {
        const el = document.documentElement;
        const isDark = el.classList.toggle('dark');
        try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch {}
      }}
    >
      Theme
    </button>
  );
}
