export default function DashboardLoading(): React.JSX.Element {
  return (
    <main className="page-shell" aria-busy="true" aria-label="Načítání stránky">
      <div className="flex flex-col gap-3">
        <div className="h-9 w-56 animate-pulse rounded-lg bg-surface-subtle" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-surface-subtle" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="surface h-28 animate-pulse bg-surface-subtle" />
        ))}
      </div>
      <div className="surface h-80 animate-pulse bg-surface-subtle" />
      <span className="sr-only">Načítám aktuální finanční data…</span>
    </main>
  );
}
