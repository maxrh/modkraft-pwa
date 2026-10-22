import { useEffect, useState } from 'react';
import { parseView, readView, type MosaicView } from '@/components/ViewMenu';

interface Props {
  count: number;
  seriesCount: number;
  /** When false, always show the photos count (no view toggle on this page). */
  showView?: boolean;
  defaultView?: MosaicView;
}

function formatCount(count: number, seriesCount: number, view: MosaicView) {
  const fotoWord = count === 1 ? 'foto' : 'fotos';
  const seriesWord = seriesCount === 1 ? 'fotoserie' : 'fotoserier';

  if (view === 'collections') {
    return `${seriesCount.toLocaleString('da-DK')} ${seriesWord}`;
  }
  return `${count.toLocaleString('da-DK')} ${fotoWord} fra ${seriesCount.toLocaleString('da-DK')} ${seriesWord}`;
}

export default function MosaicCountLabel({
  count,
  seriesCount,
  showView = false,
  defaultView = 'photos',
}: Props) {
  const [view, setView] = useState<MosaicView>(() =>
    showView ? readView(defaultView) : 'photos',
  );

  useEffect(() => {
    if (!showView) return;
    function onView(event: Event) {
      setView(parseView((event as CustomEvent<string>).detail));
    }
    window.addEventListener('mosaic:view', onView);
    return () => window.removeEventListener('mosaic:view', onView);
  }, [showView]);

  return (
    <span className="tabular-nums">
      {formatCount(count, seriesCount, showView ? view : 'photos')}
    </span>
  );
}
