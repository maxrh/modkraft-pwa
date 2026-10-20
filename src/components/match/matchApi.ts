/** Cloudflare Vite middleware swallows /match-api; call the local server. */
const API_BASE =
  typeof window !== 'undefined' && import.meta.env.DEV
    ? `http://127.0.0.1:${import.meta.env.PUBLIC_MATCH_API_PORT || '4322'}`
    : '';

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export type CollectionSummary = {
  id: string;
  title: string;
  photographers: string[];
  total: number;
  matched: number;
  imported: number;
  suggested: number;
  unmatched: number;
  skipped: number;
  gaps: number;
};

export type MatchImage = {
  imageId: string;
  filename: string;
  originalFilename: string;
  credit: string | null;
  width: number | null;
  height: number | null;
  siteHref: string;
  siteSrc: string;
  siteThumb: string;
  status: 'matched' | 'imported' | 'suggested' | 'unmatched' | 'skipped' | 'rejected';
  path: string | null;
  paths: string[];
  source: string | null;
  suggestion: { path: string; paths: string[]; source: string; matchClass: string } | null;
  decision: { status: string; path?: string; at?: string } | null;
};

export type SuggestedFolder = {
  path: string;
  name: string;
  count: number;
  reason?: 'matched' | 'date';
  datePrefix?: string;
};

export type CollectionDetail = {
  id: string;
  title: string;
  photographers: string[];
  collectionDay?: string | null;
  images: MatchImage[];
  duplicatePaths: { path: string; imageIds: string[] }[];
  defaultFotobaseDir: string | null;
  suggestedFolders: SuggestedFolder[];
};

export type FotobaseListing = {
  root: string;
  dir: string;
  relative: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  images: { name: string; path: string; previewUrl: string }[];
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `${res.status} ${url}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchStatus() {
  return getJson<{ ok: boolean; fotobaseRoot: string; fotobaseExists: boolean }>(
    apiUrl('/match-api/status'),
  );
}

export async function fetchCollections() {
  const data = await getJson<{ collections: CollectionSummary[] }>(
    apiUrl('/match-api/collections'),
  );
  return data.collections;
}

export async function fetchCollection(id: string) {
  return getJson<CollectionDetail>(
    apiUrl(`/match-api/collection/${encodeURIComponent(id)}`),
  );
}

export async function fetchFotobase(dir?: string | null) {
  const q = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  return getJson<FotobaseListing>(apiUrl(`/match-api/fotobase${q}`));
}

export function fotobaseImageUrl(filePath: string) {
  return apiUrl(`/match-api/fotobase-image?path=${encodeURIComponent(filePath)}`);
}

export type FotobaseMeta = {
  path: string;
  width: number | null;
  height: number | null;
  format: string | null;
};

export async function fetchFotobaseMeta(filePath: string) {
  return getJson<FotobaseMeta>(
    apiUrl(`/match-api/fotobase-meta?path=${encodeURIComponent(filePath)}`),
  );
}

export async function postDecision(body: {
  collectionId: string;
  imageId: string;
  status?: 'confirmed' | 'keep' | 'rejected' | 'skipped' | 'imported';
  path?: string;
  paths?: string[];
  clear?: boolean;
}) {
  const res = await fetch(apiUrl('/match-api/decision'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `decision failed ${res.status}`);
  }
  return res.json();
}
