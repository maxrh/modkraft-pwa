import { useEffect, useState } from 'react';
import { Image, Images } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const MOSAIC_VIEW_KEY = 'mosaic-view';

export type MosaicView = 'photos' | 'collections';

export function parseView(value: string | null | undefined): MosaicView {
  return value === 'collections' ? 'collections' : 'photos';
}

/**
 * URL ?view= wins.
 * Archive pages: then sessionStorage, else photos.
 * Fotoblog (`pageDefault: collections`): always collections unless URL says otherwise —
 * does not read the shared archive preference.
 */
export function readView(pageDefault: MosaicView = 'photos'): MosaicView {
  try {
    const param = new URLSearchParams(window.location.search).get('view');
    if (param === 'collections' || param === 'photos') {
      return parseView(param);
    }
    if (pageDefault === 'collections') return 'collections';
    return parseView(sessionStorage.getItem(MOSAIC_VIEW_KEY));
  } catch {
    return pageDefault;
  }
}

export function writeView(view: MosaicView, persist = true) {
  if (persist) {
    try {
      sessionStorage.setItem(MOSAIC_VIEW_KEY, view);
    } catch {
      /* private mode */
    }
  }
  window.dispatchEvent(new CustomEvent('mosaic:view', { detail: view }));
}

const VIEWS: { id: MosaicView; label: string; Icon: typeof Image }[] = [
  { id: 'photos', label: 'Fotos', Icon: Image },
  { id: 'collections', label: 'Fotoserier', Icon: Images },
];

interface Props {
  defaultView?: MosaicView;
  /** When false, toggles only affect this page (fotoblog). */
  persist?: boolean;
}

export default function ViewMenu({ defaultView = 'photos', persist = true }: Props) {
  const [view, setView] = useState<MosaicView>(() => readView(defaultView));

  useEffect(() => {
    function onView(event: Event) {
      setView(parseView((event as CustomEvent<string>).detail));
    }
    window.addEventListener('mosaic:view', onView);
    return () => window.removeEventListener('mosaic:view', onView);
  }, []);

  function choose(next: MosaicView) {
    if (next === view) return;
    setView(next);
    writeView(next, persist);
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Visning">
      {VIEWS.map(({ id, label, Icon }) => {
        const selected = view === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            aria-label={label}
            title={label}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon' }),
              'shadow-none',
              selected && 'bg-accent hover:bg-muted',
            )}
            onClick={() => choose(id)}
          >
            <Icon aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
