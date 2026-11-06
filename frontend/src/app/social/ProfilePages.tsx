import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fetchBusinessLocation,
  fetchHighlight,
  fetchHighlights,
  fetchUserReels
} from '@/api/accounts';
import {
  acceptFollow,
  blockUser,
  fetchFollowers,
  fetchFollowing,
  fetchFollowRequests,
  fetchMyProfile,
  fetchUserPosts,
  fetchUserProfile,
  followUser,
  unblockUser,
  unfollowUser
} from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { EmptyState, ErrorBanner, PageLoader, SkeletonFeed } from '../ui/States';
import { InAppMapOverlay } from '../ui/InAppMapOverlay';
import { MediaFrame } from '../ui/MediaFrame';
import { UserAvatar } from '../ui/UserAvatar';
import { resolveMediaUrl } from '@/api/social';
import { PostCard } from './PostCard';
import { ReportContentButton } from '../ui/ReportContentButton';

function ProfileHeader({
  profile,
  isOwner,
  onMessage,
  followLabel,
  onFollow,
  busy,
  onOpenMaps
}: {
  profile: any;
  isOwner: boolean;
  onMessage?: () => void;
  followLabel?: string;
  onFollow?: () => void;
  busy?: boolean;
  onOpenMaps?: () => void;
}) {
  const { t } = useI18n();
  const primaryName = profile.displayName || profile.username;
  const bizName = profile.businessProfile?.businessName?.trim();
  const showBizName =
    Boolean(bizName) && bizName!.toLowerCase() !== String(primaryName).toLowerCase();

  return (
    <header className="profile-hero">
      <UserAvatar
        size="xl"
        name={profile.displayName}
        username={profile.username}
        avatarUrl={profile.avatarUrl}
      />
      <div className="profile-hero-text">
        <div className="profile-name-bar">
          <h1 className="profile-name-row">
            {primaryName}
            {profile.isVerified ? (
              <span className="verified-badge" title={t('verified')}>
                ✓
              </span>
            ) : null}
            {profile.accountType === 'business' ? (
              <span className="account-type-pill">{t('businessAccount')}</span>
            ) : null}
          </h1>
          {isOwner ? (
            <Link className="button button-compact profile-edit-inline" to="/profile/edit">
              {t('editProfile')}
            </Link>
          ) : null}
        </div>
        <p className="muted profile-username">@{profile.username}</p>
        {showBizName ? <p className="profile-biz-name">{bizName}</p> : null}
        <p className="profile-stats">
          <span>
            <strong>{profile._count?.posts ?? 0}</strong> {t('posts')}
          </span>
          <Link to={`/u/${profile.username}/followers`}>
            <strong>{profile._count?.followers ?? 0}</strong> {t('followers')}
          </Link>
          <Link to={`/u/${profile.username}/following`}>
            <strong>{profile._count?.following ?? 0}</strong> {t('following')}
          </Link>
        </p>
        {profile.bio ? (
          <p className="profile-bio" dir="auto">
            {String(profile.bio).slice(0, 150)}
          </p>
        ) : null}
        {profile.accountType === 'business' ? (
          <div className="biz-action-row" aria-label={t('businessAccount')}>
            {isOwner ? (
              <>
                <Link className="biz-action-btn" to="/profile/catalog" title={t('manageCatalog')}>
                  <span aria-hidden>🏪</span>
                  <span>{t('catalog')}</span>
                </Link>
                <Link className="biz-action-btn" to="/profile/orders" title={t('storeOrders')}>
                  <span aria-hidden>🛒</span>
                  <span>{t('orders')}</span>
                </Link>
                <Link className="biz-action-btn" to="/profile/links" title={t('externalLinks')}>
                  <span aria-hidden>🔗</span>
                  <span>{t('links')}</span>
                </Link>
                <Link className="biz-action-btn" to="/profile/insights" title={t('insights')}>
                  <span aria-hidden>📊</span>
                  <span>{t('insights')}</span>
                </Link>
              </>
            ) : (
              <>
                <Link
                  className="biz-action-btn"
                  to={`/u/${profile.username}/store`}
                  title={t('productCatalog')}
                >
                  <span aria-hidden>🏪</span>
                  <span>{t('catalog')}</span>
                </Link>
                <Link
                  className="biz-action-btn"
                  to={`/u/${profile.username}/links`}
                  title={t('externalLinks')}
                >
                  <span aria-hidden>🔗</span>
                  <span>{t('links')}</span>
                </Link>
              </>
            )}
          </div>
        ) : null}
        {!isOwner ? (
          <div className="inline-actions">
            {onFollow ? (
              <button className="button button-compact" type="button" disabled={busy} onClick={onFollow}>
                {followLabel}
              </button>
            ) : null}
            {onMessage ? (
              <button className="button button-compact button-ghost" type="button" onClick={onMessage}>
                {t('message')}
              </button>
            ) : null}
            {profile?.id ? (
              <ReportContentButton targetType="user" targetId={profile.id} compact />
            ) : null}
            {profile.accountType === 'business' && onOpenMaps ? (
              <button className="button button-compact button-ghost" type="button" onClick={onOpenMaps}>
                {t('viewBusinessLocation')}
              </button>
            ) : null}
          </div>
        ) : profile.accountType === 'business' && onOpenMaps ? (
          <div className="inline-actions">
            <button className="button button-compact button-ghost" type="button" onClick={onOpenMaps}>
              {t('viewBusinessLocation')}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function HighlightsRail({
  items,
  onOpen,
  onCreate
}: {
  items: any[];
  onOpen: (id: string) => void;
  onCreate?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="highlights-rail" aria-label={t('highlights')}>
      {onCreate ? (
        <button type="button" className="highlight-chip add" onClick={onCreate}>
          <span className="highlight-cover">+</span>
          <span className="tiny">{t('newHighlight')}</span>
        </button>
      ) : null}
      {items.map((h) => {
        const cover = resolveMediaUrl(h.coverSecureUrl || h.coverUrl);
        return (
          <button key={h.id} type="button" className="highlight-chip" onClick={() => onOpen(h.id)}>
            <span className="highlight-cover">
              {cover ? <img src={cover} alt="" /> : (h.title || '?').slice(0, 1)}
            </span>
            <span className="tiny">{h.title}</span>
          </button>
        );
      })}
    </div>
  );
}

function PostsGrid({ posts, onOpen }: { posts: any[]; onOpen: (post: any) => void }) {
  const { t } = useI18n();
  if (!posts.length) return <EmptyState title={t('emptyPosts')} />;
  return (
    <div className="profile-grid">
      {posts.map((post) => {
        const media = post.media?.[0]?.media;
        const status = post.moderationStatus || 'APPROVED';
        const quarantined =
          media?.mediaRedacted || !['APPROVED', 'RESTORED'].includes(status);
        const hasPreview = Boolean(media?.secureUrl || media?.posterUrl);
        const badge =
          post.moderation?.badge ||
          (status === 'PENDING_REVIEW'
            ? 'قيد المراجعة'
            : status === 'HIDDEN' || status === 'REMOVED'
              ? 'محتوى محظور'
              : status === 'REVIEW_FAILED'
                ? 'فشل الفحص'
                : status === 'FLAGGED' || status === 'RESTRICTED' || status === 'APPEAL_PENDING'
                  ? 'مقيّد'
                  : null);
        return (
          <button key={post.id} type="button" className="explore-tile" onClick={() => onOpen(post)}>
            {quarantined && !hasPreview ? (
              <div className="moderation-grid-tile" dir="rtl">
                <span className="moderation-grid-label">{badge || 'غير متاح'}</span>
              </div>
            ) : (
              <div className={quarantined ? 'moderation-preview-wrap' : undefined}>
                <MediaFrame
                  mediaId={media?.id || post.media?.[0]?.mediaId}
                  secureUrl={media?.secureUrl}
                  posterUrl={media?.posterUrl}
                  mimeType={media?.mimeType}
                  processingStatus={media?.processingStatus}
                  variant="grid"
                  controls={false}
                />
                {quarantined && badge ? (
                  <span className="moderation-preview-badge" dir="rtl">
                    {badge}
                  </span>
                ) : null}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ReelsGrid({ reels }: { reels: any[] }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  if (!reels.length) return <EmptyState title={t('emptyReels')} />;
  return (
    <div className="profile-grid profile-reels-grid">
      {reels.map((reel) => (
        <button
          key={reel.id}
          type="button"
          className="explore-tile profile-reel-tile"
          onClick={() => navigate(`/reels?id=${encodeURIComponent(reel.id)}`)}
          aria-label={t('reels')}
        >
          <MediaFrame
            mediaId={reel.media?.id}
            secureUrl={reel.media?.secureUrl}
            posterUrl={reel.media?.posterUrl}
            mimeType={reel.media?.mimeType || 'video/mp4'}
            processingStatus={reel.media?.processingStatus}
            playable={reel.playable}
            variant="grid"
            controls={false}
            muted
          />
          <span className="profile-reel-badge" aria-hidden>
            ▷
          </span>
        </button>
      ))}
    </div>
  );
}

function useProfileTabs(id: string | undefined, canView: boolean) {
  const [tab, setTab] = useState<'posts' | 'reels'>('posts');
  const [posts, setPosts] = useState<any[]>([]);
  const [reels, setReels] = useState<any[]>([]);
  const [highlights, setHighlights] = useState<any[]>([]);

  useEffect(() => {
    if (!id || !canView) return;
    void fetchUserPosts(id).then(setPosts).catch(() => setPosts([]));
    void fetchUserReels(id).then(setReels).catch(() => setReels([]));
    void fetchHighlights(id).then(setHighlights).catch(() => setHighlights([]));
  }, [id, canView]);

  useEffect(() => {
    function onArchived(ev: Event) {
      const detail = (ev as CustomEvent<{ kind?: string; id?: string }>).detail;
      if (!detail?.id) return;
      if (detail.kind === 'post') {
        setPosts((prev) => prev.filter((p) => p.id !== detail.id));
      } else if (detail.kind === 'reel') {
        setReels((prev) => prev.filter((r) => r.id !== detail.id));
      }
    }
    window.addEventListener('content:archived', onArchived);
    return () => window.removeEventListener('content:archived', onArchived);
  }, []);

  return { tab, setTab, posts, setPosts, reels, setReels, highlights, setHighlights };
}

export function MyProfilePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [highlightView, setHighlightView] = useState<any | null>(null);
  const [mapLoc, setMapLoc] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const tabs = useProfileTabs(profile?.id, true);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const p = await fetchMyProfile();
      setProfile(p);
      setRequests(await fetchFollowRequests().catch(() => []));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (loading) return <PageLoader />;
  if (error && !profile) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (!profile) return null;

  return (
    <div className="profile-page">
      <ProfileHeader
        profile={profile}
        isOwner
        {...(profile.accountType === 'business'
          ? {
              onOpenMaps: () => {
                void fetchBusinessLocation(profile.username || profile.id)
                  .then(setMapLoc)
                  .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
              }
            }
          : {})}
      />
      {requests.length > 0 ? (
        <section className="panel-block">
          <h2>{t('followRequests')}</h2>
          {requests.map((r) => (
            <div key={r.id} className="list-row">
              <Link to={`/u/${r.follower?.username}`}>@{r.follower?.username}</Link>
              <button
                className="button button-compact"
                type="button"
                onClick={() => void acceptFollow(r.followerId).then(() => reload())}
              >
                {t('accept')}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <HighlightsRail
        items={tabs.highlights}
        onOpen={(id) => void fetchHighlight(id).then(setHighlightView)}
        onCreate={() => navigate('/profile/highlights/new')}
      />

      <div className="profile-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={tabs.tab === 'posts' ? 'active' : ''}
          onClick={() => tabs.setTab('posts')}
        >
          {t('posts')}
        </button>
        <button
          type="button"
          role="tab"
          className={tabs.tab === 'reels' ? 'active' : ''}
          onClick={() => tabs.setTab('reels')}
        >
          {t('reels')}
        </button>
      </div>
      {tabs.tab === 'posts' ? (
        <PostsGrid posts={tabs.posts} onOpen={setSelected} />
      ) : (
        <ReelsGrid reels={tabs.reels} />
      )}

      {selected ? (
        <div className="story-viewer profile-post-viewer" role="dialog">
          <div className="story-viewer-inner explore-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-post-viewer-bar">
              <button
                type="button"
                className="button button-ghost button-compact"
                onClick={() => setSelected(null)}
              >
                ← {t('back')}
              </button>
              <strong>@{profile?.username || t('profile')}</strong>
            </div>
            <PostCard
              post={selected}
              onChange={(next) => {
                setSelected(next);
                tabs.setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
              }}
              onRemoved={(id) => {
                setSelected(null);
                tabs.setPosts((prev) => prev.filter((p) => p.id !== id));
              }}
            />
          </div>
        </div>
      ) : null}

      {highlightView ? (
        <div className="story-viewer" role="dialog" onClick={() => setHighlightView(null)}>
          <div className="story-viewer-inner" onClick={(e) => e.stopPropagation()}>
            <div className="story-nav">
              <strong>{highlightView.title}</strong>
              <button type="button" className="button button-ghost button-compact" onClick={() => setHighlightView(null)}>
                {t('close')}
              </button>
            </div>
            <div className="highlight-items">
              {(highlightView.items || []).map((it: any) => (
                <MediaFrame
                  key={it.mediaId}
                  mediaId={it.mediaId}
                  secureUrl={it.secureUrl}
                  variant="story"
                  controls
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {mapLoc ? (
        <InAppMapOverlay
          title={mapLoc.businessName}
          addressText={mapLoc.addressText}
          latitude={mapLoc.latitude}
          longitude={mapLoc.longitude}
          mapsUrl={mapLoc.mapsUrl}
          onClose={() => setMapLoc(null)}
        />
      ) : null}
    </div>
  );
}

export function UserProfilePage() {
  const { t } = useI18n();
  const { idOrUsername = '' } = useParams();
  const navigate = useNavigate();
  const me = getSessionSnapshot()?.user?.id;
  const [profile, setProfile] = useState<any>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [highlightView, setHighlightView] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [followStatus, setFollowStatus] = useState('');
  const [blocked, setBlocked] = useState(false);
  const canView = Boolean(profile?.canViewPosts);
  const tabs = useProfileTabs(profile?.id, canView && !blocked);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const p = await fetchUserProfile(idOrUsername);
      setProfile(p);
      setFollowStatus(p.viewerFollowStatus || p.followStatus || '');
      setBlocked(Boolean(p.blockedByViewer || p.isBlocked));
      if (p.id === me) {
        navigate('/profile', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [idOrUsername]);

  const [mapLoc, setMapLoc] = useState<{
    businessName: string;
    addressText?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    mapsUrl?: string | null;
  } | null>(null);

  async function openMaps() {
    try {
      const loc = await fetchBusinessLocation(profile.username || profile.id);
      setMapLoc(loc);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  if (loading && !profile) return <SkeletonFeed count={2} />;
  if (error && !profile) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (!profile) return null;

  if (profile.browseProfileHidden) {
    return (
      <div className="profile-page">
        <header className="profile-hero">
          <UserAvatar size="xl" name={profile.displayName} username={profile.username} avatarUrl={profile.avatarUrl} />
          <div className="profile-hero-text">
            <h1>{profile.displayName || profile.username}</h1>
            <p className="muted">{t('browseProfileLocked')}</p>
            <div className="profile-actions">
              <button
                type="button"
                className="button button-compact"
                onClick={() => {
                  const focus =
                    typeof window !== 'undefined' &&
                    window.localStorage.getItem('securechat-app-mode') === 'focus';
                  if (focus) navigate(`/focus/chats/dm/${encodeURIComponent(profile.id)}`);
                  else navigate(`/messages?peer=${encodeURIComponent(profile.id)}`);
                }}
              >
                {t('message')}
              </button>
            </div>
          </div>
        </header>
      </div>
    );
  }

  const followLabel =
    followStatus === 'pending' ? t('requested') : followStatus === 'accepted' ? t('unfollow') : t('follow');

  return (
    <div className="profile-page">
      {error ? <ErrorBanner message={error} /> : null}
      <ProfileHeader
        profile={profile}
        isOwner={false}
        followLabel={followLabel}
        onFollow={() => {
          void (async () => {
            setBusy(true);
            setError('');
            try {
              if (followStatus === 'accepted' || followStatus === 'pending') {
                await unfollowUser(profile.id);
                setFollowStatus('');
                setProfile((p: any) =>
                  p
                    ? {
                        ...p,
                        _count: {
                          ...p._count,
                          followers: Math.max(0, (p._count?.followers ?? 1) - 1)
                        },
                        viewerFollowStatus: null,
                        followStatus: null
                      }
                    : p
                );
              } else {
                const res = (await followUser(profile.id)) as { status?: string };
                const next = res.status || 'accepted';
                setFollowStatus(next);
                setProfile((p: any) =>
                  p
                    ? {
                        ...p,
                        _count: {
                          ...p._count,
                          followers:
                            next === 'accepted'
                              ? (p._count?.followers ?? 0) + 1
                              : p._count?.followers ?? 0
                        },
                        viewerFollowStatus: next,
                        followStatus: next
                      }
                    : p
                );
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : t('errorGeneric'));
            } finally {
              setBusy(false);
            }
          })();
        }}
        onMessage={() => {
          const focus =
            typeof window !== 'undefined' &&
            window.localStorage.getItem('securechat-app-mode') === 'focus';
          if (focus) navigate(`/focus/chats/dm/${encodeURIComponent(profile.id)}`);
          else navigate(`/messages?peer=${encodeURIComponent(profile.id)}`);
        }}
        busy={busy}
        {...(profile.accountType === 'business' ? { onOpenMaps: () => void openMaps() } : {})}
      />
      <div className="inline-actions">
        <button
          className="button button-ghost button-compact"
          type="button"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                if (blocked) await unblockUser(profile.id);
                else await blockUser(profile.id);
                setBlocked(!blocked);
              } catch (err) {
                setError(err instanceof Error ? err.message : t('errorGeneric'));
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {blocked ? t('unblock') : t('block')}
        </button>
      </div>
      {blocked ? (
        <p className="muted">{t('blocked')}</p>
      ) : !canView ? (
        <EmptyState title={t('privateAccount')} />
      ) : (
        <>
          <HighlightsRail
            items={tabs.highlights}
            onOpen={(id) => void fetchHighlight(id).then(setHighlightView)}
          />
          <div className="profile-tabs" role="tablist">
            <button type="button" className={tabs.tab === 'posts' ? 'active' : ''} onClick={() => tabs.setTab('posts')}>
              {t('posts')}
            </button>
            <button type="button" className={tabs.tab === 'reels' ? 'active' : ''} onClick={() => tabs.setTab('reels')}>
              {t('reels')}
            </button>
          </div>
          {tabs.tab === 'posts' ? <PostsGrid posts={tabs.posts} onOpen={setSelected} /> : <ReelsGrid reels={tabs.reels} />}
        </>
      )}
      {selected ? (
        <div className="story-viewer profile-post-viewer" role="dialog">
          <div className="story-viewer-inner explore-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-post-viewer-bar">
              <button
                type="button"
                className="button button-ghost button-compact"
                onClick={() => setSelected(null)}
              >
                ← {t('back')}
              </button>
              <strong>@{selected.author?.username || t('posts')}</strong>
            </div>
            <PostCard
              post={selected}
              onChange={(next) => {
                setSelected(next);
                tabs.setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
              }}
              onRemoved={(id) => {
                setSelected(null);
                tabs.setPosts((prev) => prev.filter((p) => p.id !== id));
              }}
            />
          </div>
        </div>
      ) : null}
      {highlightView ? (
        <div className="story-viewer" role="dialog" onClick={() => setHighlightView(null)}>
          <div className="story-viewer-inner" onClick={(e) => e.stopPropagation()}>
            <div className="story-nav">
              <strong>{highlightView.title}</strong>
              <button type="button" className="button button-ghost button-compact" onClick={() => setHighlightView(null)}>
                {t('close')}
              </button>
            </div>
            {(highlightView.items || []).map((it: any) => (
              <MediaFrame key={it.mediaId} mediaId={it.mediaId} secureUrl={it.secureUrl} variant="story" controls />
            ))}
          </div>
        </div>
      ) : null}
      {mapLoc ? (
        <InAppMapOverlay
          title={mapLoc.businessName}
          addressText={mapLoc.addressText}
          latitude={mapLoc.latitude}
          longitude={mapLoc.longitude}
          mapsUrl={mapLoc.mapsUrl}
          onClose={() => setMapLoc(null)}
        />
      ) : null}
    </div>
  );
}

export function FollowListPage({ mode }: { mode: 'followers' | 'following' }) {
  const { t } = useI18n();
  const { idOrUsername = '' } = useParams();
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loader = mode === 'followers' ? fetchFollowers : fetchFollowing;
    void loader(idOrUsername)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
      .finally(() => setLoading(false));
  }, [idOrUsername, mode, t]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div>
      <h1>{mode === 'followers' ? t('followers') : t('following')}</h1>
      {items.length === 0 ? (
        <EmptyState title={mode === 'followers' ? t('emptyFollowers') : t('emptyFollowing')} />
      ) : null}
      {items.map((row) => {
        const u = row.follower || row.following || row.user || row;
        return (
          <div key={row.id || u.id} className="list-row">
            <Link to={`/u/${u.username}`}>@{u.username}</Link>
          </div>
        );
      })}
    </div>
  );
}
