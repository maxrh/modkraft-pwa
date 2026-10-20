import { useEffect, useMemo, useState } from 'react';
import {
  fetchCollections,
  fetchStatus,
  type CollectionSummary,
} from './matchApi';

type Filter = 'all' | 'gaps' | 'suggested';

export default function MatchHome() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fotobaseRoot, setFotobaseRoot] = useState('');
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('gaps');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchStatus();
        if (cancelled) return;
        setApiOk(true);
        setFotobaseRoot(status.fotobaseRoot);
        const list = await fetchCollections();
        if (cancelled) return;
        setCollections(list);
      } catch (err) {
        if (cancelled) return;
        setApiOk(false);
        setApiError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'gaps') return collections.filter((c) => c.gaps > 0);
    if (filter === 'suggested') return collections.filter((c) => c.suggested > 0);
    return collections;
  }, [collections, filter]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading match status…</p>;
  }

  if (!apiOk) {
    return (
      <div className="max-w-xl space-y-3 rounded border border-border p-4 text-sm">
        <p className="font-medium">Match API not available</p>
        <p className="text-muted-foreground">
          Local only. With <code className="text-foreground">npm run dev</code> the match API should
          start on port 4322. If not, run <code className="text-foreground">npm run match:api</code>.
        </p>
        {apiError && <p className="text-xs text-muted-foreground">{apiError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Photo match</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Local workbench · fotobase: {fotobaseRoot || '—'}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {(
            [
              ['gaps', 'Has gaps'],
              ['suggested', 'Has suggestions'],
              ['all', 'All'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={
                filter === id
                  ? 'rounded bg-foreground px-3 py-1.5 text-background'
                  : 'rounded border border-border px-3 py-1.5 hover:bg-muted'
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Series</th>
              <th className="py-2 pr-3 font-medium">Photographers</th>
              <th className="py-2 pr-3 font-medium tabular-nums">Matched</th>
              <th className="py-2 pr-3 font-medium tabular-nums">Imported</th>
              <th className="py-2 pr-3 font-medium tabular-nums">Suggested</th>
              <th className="py-2 pr-3 font-medium tabular-nums">Gaps</th>
              <th className="py-2 pr-3 font-medium tabular-nums">Skipped</th>
              <th className="py-2 font-medium tabular-nums">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-border/60 hover:bg-muted/40">
                <td className="py-2 pr-3">
                  <a href={`/match/${c.id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                    {c.title}
                  </a>
                  <div className="text-xs text-muted-foreground">{c.id}</div>
                </td>
                <td className="max-w-[14rem] py-2 pr-3 text-xs text-muted-foreground">
                  {(c.photographers ?? []).length > 0
                    ? c.photographers.join(', ')
                    : '—'}
                </td>
                <td className="py-2 pr-3 tabular-nums">{c.matched}</td>
                <td className="py-2 pr-3 tabular-nums">{c.imported ?? 0}</td>
                <td className="py-2 pr-3 tabular-nums">{c.suggested}</td>
                <td className="py-2 pr-3 tabular-nums">{c.gaps}</td>
                <td className="py-2 pr-3 tabular-nums">{c.skipped}</td>
                <td className="py-2 tabular-nums">{c.total}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-muted-foreground">
                  No collections match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
