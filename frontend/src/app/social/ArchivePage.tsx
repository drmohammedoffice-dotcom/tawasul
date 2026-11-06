import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { archivePost, archiveReel, fetchContentArchive } from '@/api/content';
import { deletePost, deleteReel } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { MediaFrame } from '../ui/MediaFrame';
import { useToast } from '../ui/Toast';

type ArchiveItem = {
  id: string;
  kind: 'post' | 'reel';
  caption?: string | null;
  archivedAt?: string;
  createdAt?: string;
  media?: {
    id?: string;
    mimeType?: string;
    secureUrl?: string | null;
    posterUrl?: string | null;
  } | null;
};

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function ArchivePage() {
  const { t } = useI18n();
  const { push } = useToast();
  const [posts, setPosts] = useState<ArchiveItem[]>([]);
  const [reels, setReels] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const allItems = useMemo(
    () => [
      ...posts.map((p) => ({ ...p, kind: 'post' as const })),
      ...reels.map((r) => ({ ...r, kind: 'reel' as const }))
    ],
    [posts, reels]
  );

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchContentArchive();
      setPosts((data.posts || []).map((p: any) => ({ ...p, kind: 'post' })));
      setReels((data.reels || []).map((r: any) => ({ ...r, kind: 'reel' })));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(allItems.map((i) => `${i.kind}:${i.id}`)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function restoreOne(kind: 'post' | 'reel', id: string) {
    if (kind === 'post') await archivePost(id, false);
    else await archiveReel(id, false);
  }

  async function deleteOne(kind: 'post' | 'reel', id: string) {
    if (kind === 'post') await deletePost(id);
    else await deleteReel(id);
  }

  async function restoreSelected() {
    if (!selected.size) return;
    setBusy(true);
    setError('');
    try {
      for (const key of selected) {
        const [kind, id] = key.split(':') as ['post' | 'reel', string];
        await restoreOne(kind, id);
      }
      push(t('restored'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!window.confirm(t('confirmDeleteSelected'))) return;
    setBusy(true);
    setError('');
    try {
      for (const key of selected) {
        const [kind, id] = key.split(':') as ['post' | 'reel', string];
        await deleteOne(kind, id);
      }
      push(t('deleted'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function restoreItem(item: ArchiveItem) {
    setBusy(true);
    try {
      await restoreOne(item.kind, item.id);
      push(t('restored'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(item: ArchiveItem) {
    if (!window.confirm(t('confirmDeleteForever'))) return;
    setBusy(true);
    try {
      await deleteOne(item.kind, item.id);
      push(t('deleted'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader />;

  function renderGrid(items: ArchiveItem[], emptyKey: 'emptyArchivePosts' | 'emptyArchiveReels') {
    if (!items.length) return <EmptyState title={t(emptyKey)} />;
    return (
      <div className="archive-grid">
        {items.map((item) => {
          const key = `${item.kind}:${item.id}`;
          const checked = selected.has(key);
          const media = item.media;
          return (
            <article key={key} className={`archive-tile ${checked ? 'is-selected' : ''}`}>
              <label className="archive-check">
                <input type="checkbox" checked={checked} onChange={() => toggle(key)} />
              </label>
              <div className={`archive-thumb ${item.kind === 'reel' ? 'is-reel' : ''}`}>
                {media?.id || media?.secureUrl ? (
                  <MediaFrame
                    mediaId={media?.id ?? null}
                    secureUrl={media?.secureUrl ?? null}
                    posterUrl={media?.posterUrl ?? null}
                    mimeType={media?.mimeType ?? null}
                    variant="grid"
                    controls={false}
                  />
                ) : (
                  <div className="archive-thumb-fallback">{item.kind === 'reel' ? t('reels') : t('posts')}</div>
                )}
                {item.kind === 'reel' ? <span className="archive-reel-badge">▷</span> : null}
              </div>
              <div className="archive-meta">
                <p className="archive-caption">{item.caption || item.id.slice(0, 10)}</p>
                <span className="muted tiny">{formatDate(item.archivedAt || item.createdAt)}</span>
              </div>
              <div className="archive-actions">
                <button type="button" className="button button-compact" disabled={busy} onClick={() => void restoreItem(item)}>
                  {t('restore')}
                </button>
                <button
                  type="button"
                  className="button button-ghost button-compact"
                  disabled={busy}
                  onClick={() => void deleteItem(item)}
                >
                  {t('deleteForever')}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div className="archive-page">
      <div className="page-header">
        <Link className="button button-ghost button-compact" to="/profile">
          {t('back')}
        </Link>
        <h1>{t('archive')}</h1>
      </div>
      {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}
      <p className="muted">{t('archiveHint')}</p>

      <div className="archive-toolbar">
        <button type="button" className="button button-ghost button-compact" onClick={selectAll} disabled={!allItems.length}>
          {t('selectAll')}
        </button>
        <button type="button" className="button button-ghost button-compact" onClick={clearSelection} disabled={!selected.size}>
          {t('clearSelection')}
        </button>
        <button
          type="button"
          className="button button-compact"
          disabled={busy || !selected.size}
          onClick={() => void restoreSelected()}
        >
          {t('restoreSelected')} ({selected.size})
        </button>
        <button
          type="button"
          className="button button-ghost button-compact danger-text"
          disabled={busy || !selected.size}
          onClick={() => void deleteSelected()}
        >
          {t('deleteSelected')}
        </button>
      </div>

      <h2>{t('posts')}</h2>
      {renderGrid(posts, 'emptyArchivePosts')}

      <h2>{t('reels')}</h2>
      {renderGrid(reels, 'emptyArchiveReels')}
    </div>
  );
}
