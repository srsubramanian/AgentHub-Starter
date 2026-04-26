import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <Link href="/chat" className="text-sm font-semibold hover:opacity-80">
          AgentHub Starter
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/chat"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Chat
          </Link>
          <Link
            href="/admin/health"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Health
          </Link>
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
