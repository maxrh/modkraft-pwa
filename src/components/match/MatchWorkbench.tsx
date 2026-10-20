import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchCollection,
  fetchFotobase,
  fetchFotobaseMeta,
  fetchStatus,
  fotobaseImageUrl,
  postDecision,
  type CollectionDetail,
  type FotobaseListing,
  type MatchImage,
} from './matchApi';

type SiteFilter = 'gaps' | 'all';

function basename(p: string | null | undefined) {
  if (!p) return '—';
  return p.replace(/\\/g, '/').split('/').pop() || p;
}

function statusLabel(status: MatchImage['status'], source?: string | null) {
  if (status === 'imported') return 'imported';
  if (status === 'matched') return source === 'keep' ? 'keep' : 'matched';
  if (status === 'suggested') return 'suggested';
  if (status === 'skipped') return 'skipped';
  // rejected + unmatched both show as gap (still in the left list)
  return 'gap';
}

function isGapStatus(status: MatchImage['status']) {
  return status === 'unmatched' || status === 'suggested' || status === 'rejected';
}

export default function MatchWorkbench({ collectionId }: { collectionId: string }) {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [siteFilter, setSiteFilter] = useState<SiteFilter>('gaps');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [candidatePath, setCandidatePath] = useState<string | null>(null);
  const [listing, setListing] = useState<FotobaseListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Original fotobase pixel size by absolute path */
  const [fotoDims, setFotoDims] = useState<Record<string, { width: number; height: number }>>({});

  const reload = useCallback(async () => {
    const data = await fetchCollection(collectionId);
    setDetail(data);
    return data;
  }, [collectionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetchStatus();
        if (cancelled) return;
        setApiOk(true);
        const data = await reload();
        if (cancelled) return;
        const first =
          data.images.find((i) => i.status === 'suggested' || i.status === 'unmatched') ||
          data.images[0];
        setSelectedId(first?.imageId ?? null);
        setCandidatePath(first?.path ?? first?.suggestion?.path ?? null);
        const dir = data.defaultFotobaseDir;
        const list = await fetchFotobase(dir);
        if (cancelled) return;
        setListing(list);
      } catch (err) {
        if (cancelled) return;
        setApiOk(false);
        setApiError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectionId, reload]);

  const selected = useMemo(
    () => detail?.images.find((i) => i.imageId === selectedId) ?? null,
    [detail, selectedId],
  );

  const visibleImages = useMemo(() => {
    if (!detail) return [];
    if (siteFilter === 'gaps') {
      return detail.images.filter((i) => isGapStatus(i.status));
    }
    return detail.images;
  }, [detail, siteFilter]);

  const duplicateWarning = useMemo(() => {
    if (!detail || !candidatePath) return null;
    const hit = detail.duplicatePaths.find((d) => d.path === candidatePath);
    if (!hit) return null;
    const others = hit.imageIds.filter((id) => id !== selectedId);
    if (!others.length) return null;
    return `Also linked to image(s): ${others.join(', ')}`;
  }, [detail, candidatePath, selectedId]);

  const pathChoices = useMemo(() => {
    if (!selected) return candidatePath ? [candidatePath] : [];
    if (selected.paths?.length) return selected.paths;
    if (selected.suggestion?.paths?.length) return selected.suggestion.paths;
    return candidatePath ? [candidatePath] : [];
  }, [selected, candidatePath]);

  useEffect(() => {
    const paths = [...new Set([...(candidatePath ? [candidatePath] : []), ...pathChoices])];
    const missing = paths.filter((p) => !fotoDims[p]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, { width: number; height: number }> = {};
      await Promise.all(
        missing.map(async (p) => {
          try {
            const meta = await fetchFotobaseMeta(p);
            if (meta.width && meta.height) {
              updates[p] = { width: meta.width, height: meta.height };
            }
          } catch {
            /* ignore missing/unreadable */
          }
        }),
      );
      if (cancelled || !Object.keys(updates).length) return;
      setFotoDims((prev) => ({ ...prev, ...updates }));
    })();
    return () => {
      cancelled = true;
    };
  }, [candidatePath, pathChoices, fotoDims]);

  function dimLabel(filePath: string | null | undefined) {
    if (!filePath) return '';
    const d = fotoDims[filePath];
    return d ? `${d.width}×${d.height}` : '';
  }

  function selectImage(img: MatchImage) {
    setSelectedId(img.imageId);
    setCandidatePath(img.path ?? img.suggestion?.path ?? null);
    setMessage(null);
  }

  async function openDir(dir: string | null) {
    try {
      const list = await fetchFotobase(dir);
      setListing(list);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function decide(status: 'confirmed' | 'keep' | 'rejected' | 'skipped') {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      if (status === 'confirmed' || status === 'keep') {
        if (!candidatePath) throw new Error('Pick a fotobase file first');
        await postDecision({
          collectionId,
          imageId: selected.imageId,
          status,
          path: candidatePath,
          paths: selected.paths?.includes(candidatePath)
            ? selected.paths
            : [candidatePath],
        });
      } else if (status === 'rejected') {
        await postDecision({
          collectionId,
          imageId: selected.imageId,
          status: 'rejected',
          path: candidatePath || selected.path || undefined,
          paths:
            candidatePath && selected.paths?.includes(candidatePath)
              ? selected.paths
              : candidatePath
                ? [candidatePath]
                : selected.paths?.length
                  ? selected.paths
                  : undefined,
        });
      } else {
        await postDecision({
          collectionId,
          imageId: selected.imageId,
          status,
        });
      }
      const data = await reload();
      const updated = data.images.find((i) => i.imageId === selected.imageId);
      if (status === 'rejected') {
        // Stay on this image so it remains visible as a gap (not removed from the list).
        if (updated) selectImage(updated);
      } else {
        const next =
          data.images.find(
            (i) => i.imageId !== selected.imageId && isGapStatus(i.status),
          ) || updated;
        if (next) selectImage(next);
      }
      setMessage(`${status} · ${selected.imageId}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearDecision() {
    if (!selected) return;
    setBusy(true);
    try {
      await postDecision({
        collectionId,
        imageId: selected.imageId,
        clear: true,
      });
      const data = await reload();
      const img = data.images.find((i) => i.imageId === selected.imageId);
      if (img) selectImage(img);
      setMessage('cleared decision');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (apiOk === false) {
    return (
      <div className="max-w-xl space-y-3 rounded border border-border p-4 text-sm">
        <p className="font-medium">Match API not available</p>
        <p className="text-muted-foreground">
          Local only. Ensure the API is up (
          <code className="text-foreground">npm run match:api</code> on port 4322).
        </p>
        {apiError && <p className="text-xs text-muted-foreground">{apiError}</p>}
      </div>
    );
  }

  if (!detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm">
            <a href="/match" className="text-muted-foreground no-underline hover:text-foreground">
              ← Match
            </a>
          </p>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight">{detail.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{detail.id}</p>
        </div>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,18rem)]">
        {/* Left: site images */}
        <section className="min-h-0 rounded border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Site
            </span>
            <div className="flex gap-1 text-xs">
              <button
                type="button"
                className={siteFilter === 'gaps' ? 'font-semibold' : 'text-muted-foreground'}
                onClick={() => setSiteFilter('gaps')}
              >
                Gaps
              </button>
              <span className="text-muted-foreground">/</span>
              <button
                type="button"
                className={siteFilter === 'all' ? 'font-semibold' : 'text-muted-foreground'}
                onClick={() => setSiteFilter('all')}
              >
                All
              </button>
            </div>
          </div>
          <ul className="max-h-[70vh] overflow-y-auto">
            {visibleImages.map((img) => (
              <li key={img.imageId}>
                <button
                  type="button"
                  onClick={() => selectImage(img)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/50 ${
                    selectedId === img.imageId ? 'bg-muted' : ''
                  }`}
                >
                  <img
                    src={img.siteThumb}
                    alt=""
                    className="h-10 w-14 shrink-0 object-cover"
                    loading="lazy"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{img.imageId}</span>
                    <span className="block truncate text-muted-foreground">
                      {statusLabel(img.status, img.source)}
                      {img.credit ? ` · ${img.credit}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {visibleImages.length === 0 && (
              <li className="px-3 py-4 text-xs text-muted-foreground">Nothing in this filter.</li>
            )}
          </ul>
        </section>

        {/* Center: compare */}
        <section className="rounded border border-border p-3">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a site image.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <a
                    href={selected.siteHref}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    /foto/…/{selected.imageId}
                  </a>
                  <span className="ml-2 text-muted-foreground">
                    {statusLabel(selected.status, selected.source)}
                    {selected.status === 'matched' && selected.source === 'confirmed'
                      ? ' · confirmed'
                      : selected.status === 'imported'
                        ? ' · hi-res from fotobase'
                        : selected.status !== 'matched' && selected.source
                          ? ` · ${selected.source}`
                          : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.status !== 'imported' && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide('confirmed')}
                        className="rounded bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide('keep')}
                        className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                        title="Correct match, but keep site file (same/adequate size — do not copy)"
                      >
                        Keep site
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide('rejected')}
                        className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide('skipped')}
                        className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        Skip
                      </button>
                    </>
                  )}
                  {selected.decision && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => clearDecision()}
                      className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Site</p>
                  <img
                    src={selected.siteSrc}
                    alt=""
                    className="max-h-[50vh] w-full object-contain bg-muted/30"
                  />
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {selected.originalFilename || selected.filename}
                    {selected.credit ? ` · ${selected.credit}` : ''}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Fotobase candidate</p>
                  {candidatePath ? (
                    <img
                      src={fotobaseImageUrl(candidatePath)}
                      alt=""
                      className="max-h-[50vh] w-full object-contain bg-muted/30"
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center bg-muted/30 text-xs text-muted-foreground">
                      No candidate — pick from the folder pane
                    </div>
                  )}
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {basename(candidatePath)}
                    {dimLabel(candidatePath) ? (
                      <span className="ml-2 whitespace-nowrap tabular-nums">
                        {dimLabel(candidatePath)}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>

              {pathChoices.length > 1 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Candidate files</p>
                  <ul className="space-y-1 text-xs">
                    {pathChoices.map((p) => (
                      <li key={p}>
                        <button
                          type="button"
                          onClick={() => setCandidatePath(p)}
                          className={
                            candidatePath === p
                              ? 'font-semibold'
                              : 'text-muted-foreground hover:text-foreground'
                          }
                        >
                          {basename(p)}
                          {dimLabel(p) ? (
                            <span className="ml-2 font-normal tabular-nums opacity-70">
                              {dimLabel(p)}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {duplicateWarning && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{duplicateWarning}</p>
              )}
            </div>
          )}
        </section>

        {/* Right: fotobase browser */}
        <section className="rounded border border-border">
          <div className="border-b border-border px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fotobase
          </div>
          {(detail.suggestedFolders?.length ?? 0) > 0 && (
            <div className="border-b border-border px-2 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Suggested folders
                {detail.collectionDay ? (
                  <span className="ml-1 font-normal normal-case tracking-normal opacity-80">
                    · near {detail.collectionDay} (±2d)
                  </span>
                ) : null}
              </p>
              <ul className="max-h-44 space-y-0.5 overflow-y-auto text-xs">
                {detail.suggestedFolders.map((f) => {
                  const isOpen = listing?.dir === f.path;
                  const byDate = f.reason === 'date';
                  return (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => openDir(f.path)}
                        className={`w-full truncate rounded px-1 py-0.5 text-left hover:bg-muted/40 ${
                          isOpen ? 'bg-muted font-medium' : 'text-muted-foreground'
                        }`}
                        title={f.path}
                      >
                        {f.name}
                        <span className="ml-1 tabular-nums opacity-70">({f.count})</span>
                        {byDate ? (
                          <span className="ml-1 text-[10px] opacity-60">date</span>
                        ) : (
                          <span className="ml-1 text-[10px] opacity-60">hit</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="border-b border-border px-2 py-2 text-xs">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => openDir(null)}
            >
              root
            </button>
            {listing?.relative
              ? listing.relative.split('/').map((part, i, parts) => {
                  const sep = listing.root.includes('\\') ? '\\' : '/';
                  const full = [listing.root, ...parts.slice(0, i + 1)].join(sep);
                  return (
                    <span key={full}>
                      <span className="text-muted-foreground"> / </span>
                      <button
                        type="button"
                        className="hover:text-foreground"
                        onClick={() => openDir(full)}
                      >
                        {part}
                      </button>
                    </span>
                  );
                })
              : null}
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-2">
            {listing?.parent && (
              <button
                type="button"
                className="mb-2 block w-full rounded border border-border px-2 py-1 text-left text-xs hover:bg-muted/40"
                onClick={() => openDir(listing.parent)}
              >
                ↑ Parent
              </button>
            )}
            <ul className="mb-3 space-y-1">
              {listing?.dirs.map((d) => (
                <li key={d.path}>
                  <button
                    type="button"
                    className="w-full truncate rounded px-1 py-0.5 text-left text-xs hover:bg-muted/40"
                    onClick={() => openDir(d.path)}
                  >
                    [{d.name}]
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              {listing?.images.map((img) => (
                <button
                  key={img.path}
                  type="button"
                  onClick={() => {
                    setCandidatePath(img.path);
                    setMessage(`candidate · ${img.name}`);
                  }}
                  className={`overflow-hidden rounded border text-left ${
                    candidatePath === img.path ? 'border-foreground' : 'border-border'
                  }`}
                >
                  <img
                    src={fotobaseImageUrl(img.path)}
                    alt=""
                    className="aspect-[4/3] w-full object-cover bg-muted/30"
                    loading="lazy"
                  />
                  <span className="block truncate px-1 py-0.5 text-[10px] text-muted-foreground">
                    {img.name}
                  </span>
                </button>
              ))}
            </div>
            {listing && listing.dirs.length === 0 && listing.images.length === 0 && (
              <p className="text-xs text-muted-foreground">Empty folder.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
