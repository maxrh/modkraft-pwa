import { useEffect, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  CalendarArrowDown,
  CalendarArrowUp,
  Shuffle,
  type LucideIcon,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const MOSAIC_SORT_KEY = 'mosaic-sort';

export type SortMode = 'shuffle' | 'alpha' | 'date';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  mode: SortMode;
  dir: SortDir;
}

const MODES: { id: SortMode; label: string }[] = [
  { id: 'shuffle', label: 'Bland' },
  { id: 'alpha', label: 'Alfabetisk' },
  { id: 'date', label: 'Dato' },
];

export function sortToken(state: SortState): string {
  return state.mode === 'shuffle' ? 'shuffle' : `${state.mode}:${state.dir}`;
}

export function parseSort(value: string | null | undefined): SortState {
  if (!value || value === 'shuffle') return { mode: 'shuffle', dir: 'asc' };
  const [mode, dir] = value.split(':');
  if (mode === 'alpha') return { mode: 'alpha', dir: dir === 'desc' ? 'desc' : 'asc' };
  if (mode === 'date' || value === 'date') return { mode: 'date', dir: dir === 'asc' ? 'asc' : 'desc' };
  return { mode: 'shuffle', dir: 'asc' };
}

/** Page default (e.g. fotoblog date:asc) wins when persist is off; else sessionStorage. */
export function readSort(defaultSort = 'shuffle', persist = true): SortState {
  if (!persist) return parseSort(defaultSort);
  try {
    const stored = sessionStorage.getItem(MOSAIC_SORT_KEY);
    if (stored) return parseSort(stored);
  } catch {
    /* private mode */
  }
  return parseSort(defaultSort);
}

function iconFor(id: SortMode, state: SortState): LucideIcon {
  if (id === 'shuffle') return Shuffle;
  if (id === 'alpha') {
    return state.mode === 'alpha' && state.dir === 'desc' ? ArrowDownZA : ArrowDownAZ;
  }
  return state.mode === 'date' && state.dir === 'asc' ? CalendarArrowUp : CalendarArrowDown;
}

function labelFor(id: SortMode, state: SortState): string {
  if (id === 'alpha' && state.mode === 'alpha' && state.dir === 'desc') return 'Alfabetisk, Å–A';
  if (id === 'alpha') return 'Alfabetisk, A–Å';
  if (id === 'date' && state.mode === 'date' && state.dir === 'asc') return 'Ældste først';
  if (id === 'date') return 'Nyeste først';
  return 'Bland';
}

interface SortUiProps {
  defaultSort?: string;
  persist?: boolean;
}

export function SortLabel({ defaultSort = 'shuffle', persist = true }: SortUiProps) {
  const [sort, setSort] = useState<SortState>(() => readSort(defaultSort, persist));

  useEffect(() => {
    function onSort(event: Event) {
      setSort(parseSort((event as CustomEvent<string>).detail));
    }
    window.addEventListener('mosaic:sort', onSort);
    return () => window.removeEventListener('mosaic:sort', onSort);
  }, []);

  return <span>{labelFor(sort.mode, sort)}</span>;
}

export default function SortMenu({ defaultSort = 'shuffle', persist = true }: SortUiProps) {
  const [sort, setSort] = useState<SortState>(() => readSort(defaultSort, persist));

  function choose(id: SortMode) {
    const next: SortState =
      id === 'shuffle'
        ? { mode: 'shuffle', dir: 'asc' }
        : sort.mode === id
          ? { mode: id, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { mode: id, dir: id === 'date' ? 'desc' : 'asc' };
    setSort(next);
    const token = sortToken(next);
    if (persist) {
      try {
        sessionStorage.setItem(MOSAIC_SORT_KEY, token);
      } catch {
        /* private mode */
      }
    }
    window.dispatchEvent(new CustomEvent('mosaic:sort', { detail: token }));
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Sortering">
      {MODES.map((item) => {
        const Icon = iconFor(item.id, sort);
        const selected = item.id === sort.mode;
        const label = labelFor(item.id, sort);
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected}
            aria-label={label}
            title={label}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon' }),
              'shadow-none',
              selected && 'bg-accent hover:bg-muted',
            )}
            onClick={() => choose(item.id)}
          >
            <Icon aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
