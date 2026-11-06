import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteStory,
  fetchStoryInsights,
  reactToStory,
  replyToStory,
  viewStory
} from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { MediaFrame } from '../ui/MediaFrame';
import { UserAvatar } from '../ui/UserAvatar';
import { useToast } from '../ui/Toast';
import { StoryStudio } from './StoryStudio';

type Story = any;

const STORY_MS = 5000;
const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];

export function StoriesRail({
  stories,
  onChanged
}: {
  stories: Story[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { push } = useToast();
  const me = getSessionSnapshot()?.user?.id;
  const meUser = getSessionSnapshot()?.user;
  const [composeOpen, setComposeOpen] = useState(false);
  const [viewer, setViewer] = useState<{ authorId: string; index: number } | null>(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [insights, setInsights] = useState<any | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startedAt = useRef(0);
  const remainRef = useRef(STORY_MS);
  const touchStartY = useRef<number | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Story[]>();
    for (const s of stories) {
      const key = s.authorId || s.author?.id;
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()].map(([authorId, list]) => {
      // Instagram-style: oldest → newest within an author's stack
      const ordered = [...list].sort(
        (a, b) =>
          new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      );
      return {
        authorId,
        author: ordered[0]?.author,
        stories: ordered,
        unseen: ordered.some(
          (x) =>
            !seenIds.has(x.id) &&
            (!Array.isArray(x.views) ||
              x.views.length === 0 ||
              !x.views.some((v: any) => v.viewerId === me))
        )
      };
    });
  }, [stories, seenIds, me]);

  const activeGroup = viewer ? grouped.find((g) => g.authorId === viewer.authorId) : null;
  const stack = activeGroup?.stories ?? [];
  const active = viewer != null ? stack[viewer.index] : null;
  const isOwner = Boolean(me && active && active.authorId === me);
  const viewCount =
    insights?.viewCount ?? active?._count?.views ?? (Array.isArray(active?.views) ? active.views.length : 0);

  async function markViewed(story: Story | undefined) {
    if (!story?.id) return;
    setSeenIds((prev) => new Set(prev).add(story.id));
    try {
      await viewStory(story.id);
    } catch {
      /* expired */
    }
  }

  async function loadInsights(storyId: string) {
    setInsightsLoading(true);
    try {
      setInsights(await fetchStoryInsights(storyId));
    } catch {
      setInsights(null);
    } finally {
      setInsightsLoading(false);
    }
  }

  async function openAuthor(authorId: string) {
    setSheetOpen(false);
    setInsights(null);
    setReplyText('');
    setStickersOpen(false);
    setViewer({ authorId, index: 0 });
    setProgress(0);
    remainRef.current = STORY_MS;
    setPaused(false);
    const g = grouped.find((x) => x.authorId === authorId);
    const first = g?.stories?.[0];
    await markViewed(first);
    if (me && first?.authorId === me) void loadInsights(first.id);
  }

  function clearTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    if (!viewer || paused || sheetOpen || !active) {
      clearTimer();
      return;
    }
    startedAt.current = Date.now();
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      const left = remainRef.current - elapsed;
      const pct = Math.min(100, ((remainRef.current - left) / remainRef.current) * 100);
      setProgress(pct);
      if (left <= 0) {
        clearTimer();
        remainRef.current = STORY_MS;
        setProgress(0);
        advanceStory();
      }
    }, 50);
    return clearTimer;
  }, [viewer?.authorId, viewer?.index, paused, sheetOpen, active?.id, grouped, me]);

  useEffect(() => {
    if (!active?.id || !isOwner) return;
    void loadInsights(active.id);
  }, [active?.id, isOwner]);

  function hold(down: boolean) {
    if (sheetOpen) return;
    if (down) {
      const elapsed = Date.now() - startedAt.current;
      remainRef.current = Math.max(200, remainRef.current - elapsed);
      setPaused(true);
    } else {
      setPaused(false);
    }
  }

  /** Newer story / next author (physical left in RTL story UI). */
  function advanceStory() {
    setProgress(0);
    remainRef.current = STORY_MS;
    setViewer((v) => {
      if (!v) return null;
      const gi = grouped.findIndex((x) => x.authorId === v.authorId);
      const g = gi >= 0 ? grouped[gi] : null;
      if (!g) return null;
      if (v.index < g.stories.length - 1) {
        const next = g.stories[v.index + 1];
        void markViewed(next);
        if (me && next?.authorId === me) void loadInsights(next.id);
        return { ...v, index: v.index + 1 };
      }
      const nextGroup = grouped[gi + 1];
      if (!nextGroup?.stories.length) return null;
      const first = nextGroup.stories[0];
      void markViewed(first);
      if (me && first?.authorId === me) void loadInsights(first.id);
      return { authorId: nextGroup.authorId, index: 0 };
    });
  }

  /** Older story / previous author (physical right). */
  function retreatStory() {
    setProgress(0);
    remainRef.current = STORY_MS;
    setViewer((v) => {
      if (!v) return null;
      const gi = grouped.findIndex((x) => x.authorId === v.authorId);
      const g = gi >= 0 ? grouped[gi] : null;
      if (!g) return null;
      if (v.index > 0) {
        const prev = g.stories[v.index - 1];
        void markViewed(prev);
        if (me && prev?.authorId === me) void loadInsights(prev.id);
        return { ...v, index: v.index - 1 };
      }
      const prevGroup = grouped[gi - 1];
      if (!prevGroup?.stories.length) return null;
      const lastIdx = prevGroup.stories.length - 1;
      const last = prevGroup.stories[lastIdx];
      void markViewed(last);
      if (me && last?.authorId === me) void loadInsights(last.id);
      return { authorId: prevGroup.authorId, index: lastIdx };
    });
  }

  async function removeActive() {
    if (!active) return;
    try {
      await deleteStory(active.id);
      setViewer(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  async function sendReply(e?: FormEvent) {
    e?.preventDefault();
    if (!active?.id || !replyText.trim()) return;
    setReplyBusy(true);
    try {
      await replyToStory(active.id, replyText.trim());
      setReplyText('');
      push(t('storyReplySent'), 'success');
      if (isOwner) await loadInsights(active.id);
    } catch (err) {
      push(err instanceof Error ? err.message : t('errorGeneric'), 'error');
    } finally {
      setReplyBusy(false);
    }
  }

  async function sendReaction(emoji: string) {
    if (!active?.id) return;
    try {
      await reactToStory(active.id, emoji);
      setStickersOpen(false);
      push(t('storyReacted'), 'success');
      if (isOwner) await loadInsights(active.id);
    } catch (err) {
      push(err instanceof Error ? err.message : t('errorGeneric'), 'error');
    }
  }

  function openSheet() {
    if (!isOwner || !active) return;
    setSheetOpen(true);
    setPaused(true);
    void loadInsights(active.id);
  }

  function closeSheet() {
    setSheetOpen(false);
    setPaused(false);
  }

  return (
    <section className="stories-row-wrap ig-stories">
      <div className="stories-row">
        <button type="button" className="story-chip own" onClick={() => setComposeOpen(true)}>
          <span className="story-avatar-wrap">
            <UserAvatar
              size="lg"
              name={(meUser as { displayName?: string } | null)?.displayName ?? meUser?.username}
              username={meUser?.username ?? null}
              avatarUrl={(meUser as { avatarUrl?: string } | null)?.avatarUrl ?? null}
            />
            <span className="story-add-badge">+</span>
          </span>
          <span>{t('yourStory')}</span>
        </button>
        {grouped.map((g) => (
          <button
            key={g.authorId}
            type="button"
            className={`story-chip ${g.unseen ? 'unseen' : 'seen'}`}
            onClick={() => void openAuthor(g.authorId)}
          >
            <UserAvatar
              size="lg"
              name={g.author?.displayName}
              username={g.author?.username}
              avatarUrl={g.author?.avatarUrl}
              ring={g.unseen ? 'story' : 'story-seen'}
            />
            <span>@{g.author?.username || 'user'}</span>
          </button>
        ))}
      </div>
      {error && !composeOpen ? <p className="auth-error">{error}</p> : null}

      {composeOpen ? (
        <div className="story-compose-sheet story-studio-overlay" role="dialog" aria-modal="true">
          <StoryStudio
            onCancel={() => setComposeOpen(false)}
            onDone={() => {
              push(t('storyUploaded'), 'success');
              setComposeOpen(false);
              onChanged();
            }}
          />
        </div>
      ) : null}

      {active ? (
        <div
          className="ig-story-viewer"
          role="dialog"
          aria-modal="true"
          onTouchStart={(e) => {
            touchStartY.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchEnd={(e) => {
            const start = touchStartY.current;
            touchStartY.current = null;
            if (start == null || !isOwner) return;
            const end = e.changedTouches[0]?.clientY ?? start;
            if (start - end > 70) openSheet();
          }}
        >
          <div className="ig-story-stage">
            <div className="story-progress-bars ig-story-progress">
              {stack.map((s, i) => (
                <div key={s.id || i} className="story-progress-seg">
                  <div
                    className="story-progress-fill"
                    style={{
                      width:
                        viewer != null && i < viewer.index
                          ? '100%'
                          : i === viewer?.index
                            ? `${progress}%`
                            : '0%'
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="ig-story-top">
              <div className="story-nav-user">
                <UserAvatar
                  size="sm"
                  name={active.author?.displayName}
                  username={active.author?.username}
                  avatarUrl={active.author?.avatarUrl}
                />
                <strong>@{active.author?.username}</strong>
              </div>
              <div className="inline-actions">
                {isOwner ? (
                  <button type="button" className="button button-ghost button-compact" onClick={() => void removeActive()}>
                    {t('delete')}
                  </button>
                ) : null}
                <button type="button" className="button button-ghost button-compact" onClick={() => setViewer(null)}>
                  {t('close')}
                </button>
              </div>
            </div>

            <div
              className="ig-story-media"
              onPointerDown={() => hold(true)}
              onPointerUp={() => hold(false)}
              onPointerLeave={() => hold(false)}
              onClick={(e) => {
                if (sheetOpen) return;
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const x = e.clientX - rect.left;
                // Left → newer / next author; Right → older / previous author
                if (x < rect.width * 0.5) advanceStory();
                else retreatStory();
              }}
            >
              <MediaFrame
                mediaId={active.media?.id}
                secureUrl={active.media?.secureUrl}
                mimeType={active.media?.mimeType}
                processingStatus={active.media?.processingStatus}
                variant="story"
                eager
                controls={false}
                autoPlay
                muted={false}
              />
            </div>

            {isOwner ? (
              <button type="button" className="ig-story-views-bar" onClick={openSheet}>
                <span>▴</span>
                <strong>
                  {viewCount} {t('views')}
                </strong>
                <span className="muted tiny">{t('storySwipeUpHint')}</span>
              </button>
            ) : (
              <div className="ig-story-viewer-footer">
                {stickersOpen ? (
                  <div className="sticker-library ig-story-stickers">
                    {REACTION_EMOJIS.map((e) => (
                      <button key={e} type="button" className="sticker-btn" onClick={() => void sendReaction(e)}>
                        {e}
                      </button>
                    ))}
                  </div>
                ) : null}
                <form className="ig-story-reply-row" onSubmit={(e) => void sendReply(e)}>
                  <button
                    type="button"
                    className="composer-icon-btn"
                    aria-label={t('stickers')}
                    onClick={() => setStickersOpen((v) => !v)}
                  >
                    😊
                  </button>
                  <input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={t('storyReplyPlaceholder')}
                    dir="auto"
                    onFocus={() => setPaused(true)}
                    onBlur={() => {
                      if (!sheetOpen) setPaused(false);
                    }}
                  />
                  <button className="button button-compact" type="submit" disabled={replyBusy || !replyText.trim()}>
                    {t('send')}
                  </button>
                </form>
              </div>
            )}
          </div>

          {sheetOpen && isOwner ? (
            <div className="ig-story-sheet" role="dialog" aria-modal="true">
              <button type="button" className="ig-sheet-handle" onClick={closeSheet} aria-label={t('close')}>
                <span />
              </button>
              <div className="ig-sheet-head">
                <strong>
                  {viewCount} {t('views')}
                </strong>
                <button type="button" className="button button-ghost button-compact" onClick={closeSheet}>
                  {t('close')}
                </button>
              </div>
              {insightsLoading ? <p className="muted pad-inline">{t('loading')}</p> : null}
              <div className="ig-sheet-section">
                <h3>{t('storyViewers')}</h3>
                {(insights?.viewers || []).length === 0 ? (
                  <p className="muted tiny">{t('noStoryViewers')}</p>
                ) : (
                  (insights?.viewers || []).map((v: any) => (
                    <div key={v.id} className="ig-viewer-row">
                      <UserAvatar
                        size="sm"
                        name={v.user?.displayName}
                        username={v.user?.username}
                        avatarUrl={v.user?.avatarUrl}
                      />
                      <span className="ig-viewer-meta">
                        <strong>@{v.user?.username}</strong>
                      </span>
                      {v.reaction ? <span className="ig-viewer-react">{v.reaction}</span> : null}
                    </div>
                  ))
                )}
              </div>
              <div className="ig-sheet-section">
                <h3>{t('storyReplies')}</h3>
                {(insights?.replies || []).length === 0 ? (
                  <p className="muted tiny">{t('noStoryReplies')}</p>
                ) : (
                  (insights?.replies || []).map((r: any) => (
                    <div key={r.id} className="ig-reply-row">
                      <UserAvatar
                        size="sm"
                        name={r.author?.displayName}
                        username={r.author?.username}
                        avatarUrl={r.author?.avatarUrl}
                      />
                      <div>
                        <strong>@{r.author?.username}</strong>
                        <p dir="auto">{r.body}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
