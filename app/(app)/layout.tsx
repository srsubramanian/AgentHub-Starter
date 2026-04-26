export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <h1 className="text-sm font-semibold">AgentHub Starter</h1>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
