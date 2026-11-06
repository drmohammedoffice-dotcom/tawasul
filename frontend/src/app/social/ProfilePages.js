import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchBusinessLocation, fetchHighlight, fetchHighlights, fetchUserReels } from '@/api/accounts';
import { acceptFollow, blockUser, fetchFollowers, fetchFollowing, fetchFollowRequests, fetchMyProfile, fetchUserPosts, fetchUserProfile, followUser, unblockUser, unfollowUser } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { EmptyState, ErrorBanner, PageLoader, SkeletonFeed } from '../ui/States';
import { InAppMapOverlay } from '../ui/InAppMapOverlay';
import { MediaFrame } from '../ui/MediaFrame';
import { UserAvatar } from '../ui/UserAvatar';
import { resolveMediaUrl } from '@/api/social';
import { PostCard } from './PostCard';
function ProfileHeader({ profile, isOwner, onMessage, followLabel, onFollow, busy, onOpenMaps }) {
    const { t } = useI18n();
    const primaryName = profile.displayName || profile.username;
    const bizName = profile.businessProfile?.businessName?.trim();
    const showBizName = Boolean(bizName) && bizName.toLowerCase() !== String(primaryName).toLowerCase();
    return (_jsxs("header", { className: "profile-hero", children: [_jsx(UserAvatar, { size: "xl", name: profile.displayName, username: profile.username, avatarUrl: profile.avatarUrl }), _jsxs("div", { className: "profile-hero-text", children: [_jsxs("div", { className: "profile-name-bar", children: [_jsxs("h1", { className: "profile-name-row", children: [primaryName, profile.isVerified ? (_jsx("span", { className: "verified-badge", title: t('verified'), children: "\u2713" })) : null, profile.accountType === 'business' ? (_jsx("span", { className: "account-type-pill", children: t('businessAccount') })) : null] }), isOwner ? (_jsx(Link, { className: "button button-compact profile-edit-inline", to: "/profile/edit", children: t('editProfile') })) : null] }), _jsxs("p", { className: "muted profile-username", children: ["@", profile.username] }), showBizName ? _jsx("p", { className: "profile-biz-name", children: bizName }) : null, _jsxs("p", { className: "profile-stats", children: [_jsxs("span", { children: [_jsx("strong", { children: profile._count?.posts ?? 0 }), " ", t('posts')] }), _jsxs(Link, { to: `/u/${profile.username}/followers`, children: [_jsx("strong", { children: profile._count?.followers ?? 0 }), " ", t('followers')] }), _jsxs(Link, { to: `/u/${profile.username}/following`, children: [_jsx("strong", { children: profile._count?.following ?? 0 }), " ", t('following')] })] }), profile.bio ? (_jsx("p", { className: "profile-bio", dir: "auto", children: String(profile.bio).slice(0, 150) })) : null, profile.accountType === 'business' ? (_jsx("div", { className: "biz-action-row", "aria-label": t('businessAccount'), children: isOwner ? (_jsxs(_Fragment, { children: [_jsxs(Link, { className: "biz-action-btn", to: "/profile/catalog", title: t('manageCatalog'), children: [_jsx("span", { "aria-hidden": true, children: "\uD83C\uDFEA" }), _jsx("span", { children: t('catalog') })] }), _jsxs(Link, { className: "biz-action-btn", to: "/profile/orders", title: t('storeOrders'), children: [_jsx("span", { "aria-hidden": true, children: "\uD83D\uDED2" }), _jsx("span", { children: t('orders') })] }), _jsxs(Link, { className: "biz-action-btn", to: "/profile/links", title: t('externalLinks'), children: [_jsx("span", { "aria-hidden": true, children: "\uD83D\uDD17" }), _jsx("span", { children: t('links') })] }), _jsxs(Link, { className: "biz-action-btn", to: "/profile/insights", title: t('insights'), children: [_jsx("span", { "aria-hidden": true, children: "\uD83D\uDCCA" }), _jsx("span", { children: t('insights') })] })] })) : (_jsxs(_Fragment, { children: [_jsxs(Link, { className: "biz-action-btn", to: `/u/${profile.username}/store`, title: t('productCatalog'), children: [_jsx("span", { "aria-hidden": true, children: "\uD83C\uDFEA" }), _jsx("span", { children: t('catalog') })] }), _jsxs(Link, { className: "biz-action-btn", to: `/u/${profile.username}/links`, title: t('externalLinks'), children: [_jsx("span", { "aria-hidden": true, children: "\uD83D\uDD17" }), _jsx("span", { children: t('links') })] })] })) })) : null, !isOwner ? (_jsxs("div", { className: "inline-actions", children: [onFollow ? (_jsx("button", { className: "button button-compact", type: "button", disabled: busy, onClick: onFollow, children: followLabel })) : null, onMessage ? (_jsx("button", { className: "button button-compact button-ghost", type: "button", onClick: onMessage, children: t('message') })) : null, profile.accountType === 'business' && onOpenMaps ? (_jsx("button", { className: "button button-compact button-ghost", type: "button", onClick: onOpenMaps, children: t('viewBusinessLocation') })) : null] })) : profile.accountType === 'business' && onOpenMaps ? (_jsx("div", { className: "inline-actions", children: _jsx("button", { className: "button button-compact button-ghost", type: "button", onClick: onOpenMaps, children: t('viewBusinessLocation') }) })) : null] })] }));
}
function HighlightsRail({ items, onOpen, onCreate }) {
    const { t } = useI18n();
    return (_jsxs("div", { className: "highlights-rail", "aria-label": t('highlights'), children: [onCreate ? (_jsxs("button", { type: "button", className: "highlight-chip add", onClick: onCreate, children: [_jsx("span", { className: "highlight-cover", children: "+" }), _jsx("span", { className: "tiny", children: t('newHighlight') })] })) : null, items.map((h) => {
                const cover = resolveMediaUrl(h.coverSecureUrl || h.coverUrl);
                return (_jsxs("button", { type: "button", className: "highlight-chip", onClick: () => onOpen(h.id), children: [_jsx("span", { className: "highlight-cover", children: cover ? _jsx("img", { src: cover, alt: "" }) : (h.title || '?').slice(0, 1) }), _jsx("span", { className: "tiny", children: h.title })] }, h.id));
            })] }));
}
function PostsGrid({ posts, onOpen }) {
    const { t } = useI18n();
    if (!posts.length)
        return _jsx(EmptyState, { title: t('emptyPosts') });
    return (_jsx("div", { className: "profile-grid", children: posts.map((post) => {
            const media = post.media?.[0]?.media;
            return (_jsx("button", { type: "button", className: "explore-tile", onClick: () => onOpen(post), children: _jsx(MediaFrame, { mediaId: media?.id || post.media?.[0]?.mediaId, secureUrl: media?.secureUrl, mimeType: media?.mimeType, processingStatus: media?.processingStatus, variant: "grid", controls: false }) }, post.id));
        }) }));
}
function ReelsGrid({ reels }) {
    const { t } = useI18n();
    const navigate = useNavigate();
    if (!reels.length)
        return _jsx(EmptyState, { title: t('emptyReels') });
    return (_jsx("div", { className: "profile-grid profile-reels-grid", children: reels.map((reel) => (_jsxs("button", { type: "button", className: "explore-tile profile-reel-tile", onClick: () => navigate(`/reels?id=${encodeURIComponent(reel.id)}`), "aria-label": t('reels'), children: [_jsx(MediaFrame, { mediaId: reel.media?.id, secureUrl: reel.media?.secureUrl, posterUrl: reel.media?.posterUrl, mimeType: reel.media?.mimeType || 'video/mp4', processingStatus: reel.media?.processingStatus, playable: reel.playable, variant: "grid", controls: false, muted: true }), _jsx("span", { className: "profile-reel-badge", "aria-hidden": true, children: "\u25B7" })] }, reel.id))) }));
}
function useProfileTabs(id, canView) {
    const [tab, setTab] = useState('posts');
    const [posts, setPosts] = useState([]);
    const [reels, setReels] = useState([]);
    const [highlights, setHighlights] = useState([]);
    useEffect(() => {
        if (!id || !canView)
            return;
        void fetchUserPosts(id).then(setPosts).catch(() => setPosts([]));
        void fetchUserReels(id).then(setReels).catch(() => setReels([]));
        void fetchHighlights(id).then(setHighlights).catch(() => setHighlights([]));
    }, [id, canView]);
    useEffect(() => {
        function onArchived(ev) {
            const detail = ev.detail;
            if (!detail?.id)
                return;
            if (detail.kind === 'post') {
                setPosts((prev) => prev.filter((p) => p.id !== detail.id));
            }
            else if (detail.kind === 'reel') {
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
    const [profile, setProfile] = useState(null);
    const [requests, setRequests] = useState([]);
    const [selected, setSelected] = useState(null);
    const [highlightView, setHighlightView] = useState(null);
    const [mapLoc, setMapLoc] = useState(null);
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void reload();
    }, []);
    if (loading)
        return _jsx(PageLoader, {});
    if (error && !profile)
        return _jsx(ErrorBanner, { message: error, onRetry: () => void reload() });
    if (!profile)
        return null;
    return (_jsxs("div", { className: "profile-page", children: [_jsx(ProfileHeader, { profile: profile, isOwner: true, ...(profile.accountType === 'business'
                    ? {
                        onOpenMaps: () => {
                            void fetchBusinessLocation(profile.username || profile.id)
                                .then(setMapLoc)
                                .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')));
                        }
                    }
                    : {}) }), requests.length > 0 ? (_jsxs("section", { className: "panel-block", children: [_jsx("h2", { children: t('followRequests') }), requests.map((r) => (_jsxs("div", { className: "list-row", children: [_jsxs(Link, { to: `/u/${r.follower?.username}`, children: ["@", r.follower?.username] }), _jsx("button", { className: "button button-compact", type: "button", onClick: () => void acceptFollow(r.followerId).then(() => reload()), children: t('accept') })] }, r.id)))] })) : null, _jsx(HighlightsRail, { items: tabs.highlights, onOpen: (id) => void fetchHighlight(id).then(setHighlightView), onCreate: () => navigate('/profile/highlights/new') }), _jsxs("div", { className: "profile-tabs", role: "tablist", children: [_jsx("button", { type: "button", role: "tab", className: tabs.tab === 'posts' ? 'active' : '', onClick: () => tabs.setTab('posts'), children: t('posts') }), _jsx("button", { type: "button", role: "tab", className: tabs.tab === 'reels' ? 'active' : '', onClick: () => tabs.setTab('reels'), children: t('reels') })] }), tabs.tab === 'posts' ? (_jsx(PostsGrid, { posts: tabs.posts, onOpen: setSelected })) : (_jsx(ReelsGrid, { reels: tabs.reels })), selected ? (_jsx("div", { className: "story-viewer profile-post-viewer", role: "dialog", children: _jsxs("div", { className: "story-viewer-inner explore-modal", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "profile-post-viewer-bar", children: [_jsxs("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setSelected(null), children: ["\u2190 ", t('back')] }), _jsxs("strong", { children: ["@", profile?.username || t('profile')] })] }), _jsx(PostCard, { post: selected, onChange: (next) => {
                                setSelected(next);
                                tabs.setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
                            }, onRemoved: (id) => {
                                setSelected(null);
                                tabs.setPosts((prev) => prev.filter((p) => p.id !== id));
                            } })] }) })) : null, highlightView ? (_jsx("div", { className: "story-viewer", role: "dialog", onClick: () => setHighlightView(null), children: _jsxs("div", { className: "story-viewer-inner", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "story-nav", children: [_jsx("strong", { children: highlightView.title }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setHighlightView(null), children: t('close') })] }), _jsx("div", { className: "highlight-items", children: (highlightView.items || []).map((it) => (_jsx(MediaFrame, { mediaId: it.mediaId, secureUrl: it.secureUrl, variant: "story", controls: true }, it.mediaId))) })] }) })) : null, mapLoc ? (_jsx(InAppMapOverlay, { title: mapLoc.businessName, addressText: mapLoc.addressText, latitude: mapLoc.latitude, longitude: mapLoc.longitude, mapsUrl: mapLoc.mapsUrl, onClose: () => setMapLoc(null) })) : null] }));
}
export function UserProfilePage() {
    const { t } = useI18n();
    const { idOrUsername = '' } = useParams();
    const navigate = useNavigate();
    const me = getSessionSnapshot()?.user?.id;
    const [profile, setProfile] = useState(null);
    const [selected, setSelected] = useState(null);
    const [highlightView, setHighlightView] = useState(null);
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void reload();
    }, [idOrUsername]);
    const [mapLoc, setMapLoc] = useState(null);
    async function openMaps() {
        try {
            const loc = await fetchBusinessLocation(profile.username || profile.id);
            setMapLoc(loc);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    if (loading && !profile)
        return _jsx(SkeletonFeed, { count: 2 });
    if (error && !profile)
        return _jsx(ErrorBanner, { message: error, onRetry: () => void reload() });
    if (!profile)
        return null;
    if (profile.browseProfileHidden) {
        return (_jsx("div", { className: "profile-page", children: _jsxs("header", { className: "profile-hero", children: [_jsx(UserAvatar, { size: "xl", name: profile.displayName, username: profile.username, avatarUrl: profile.avatarUrl }), _jsxs("div", { className: "profile-hero-text", children: [_jsx("h1", { children: profile.displayName || profile.username }), _jsx("p", { className: "muted", children: t('browseProfileLocked') }), _jsx("div", { className: "profile-actions", children: _jsx("button", { type: "button", className: "button button-compact", onClick: () => {
                                        const focus = typeof window !== 'undefined' &&
                                            window.localStorage.getItem('securechat-app-mode') === 'focus';
                                        if (focus)
                                            navigate(`/focus/chats/dm/${encodeURIComponent(profile.id)}`);
                                        else
                                            navigate(`/messages?peer=${encodeURIComponent(profile.id)}`);
                                    }, children: t('message') }) })] })] }) }));
    }
    const followLabel = followStatus === 'pending' ? t('requested') : followStatus === 'accepted' ? t('unfollow') : t('follow');
    return (_jsxs("div", { className: "profile-page", children: [error ? _jsx(ErrorBanner, { message: error }) : null, _jsx(ProfileHeader, { profile: profile, isOwner: false, followLabel: followLabel, onFollow: () => {
                    void (async () => {
                        setBusy(true);
                        setError('');
                        try {
                            if (followStatus === 'accepted' || followStatus === 'pending') {
                                await unfollowUser(profile.id);
                                setFollowStatus('');
                                setProfile((p) => p
                                    ? {
                                        ...p,
                                        _count: {
                                            ...p._count,
                                            followers: Math.max(0, (p._count?.followers ?? 1) - 1)
                                        },
                                        viewerFollowStatus: null,
                                        followStatus: null
                                    }
                                    : p);
                            }
                            else {
                                const res = (await followUser(profile.id));
                                const next = res.status || 'accepted';
                                setFollowStatus(next);
                                setProfile((p) => p
                                    ? {
                                        ...p,
                                        _count: {
                                            ...p._count,
                                            followers: next === 'accepted'
                                                ? (p._count?.followers ?? 0) + 1
                                                : p._count?.followers ?? 0
                                        },
                                        viewerFollowStatus: next,
                                        followStatus: next
                                    }
                                    : p);
                            }
                        }
                        catch (err) {
                            setError(err instanceof Error ? err.message : t('errorGeneric'));
                        }
                        finally {
                            setBusy(false);
                        }
                    })();
                }, onMessage: () => {
                    const focus = typeof window !== 'undefined' &&
                        window.localStorage.getItem('securechat-app-mode') === 'focus';
                    if (focus)
                        navigate(`/focus/chats/dm/${encodeURIComponent(profile.id)}`);
                    else
                        navigate(`/messages?peer=${encodeURIComponent(profile.id)}`);
                }, busy: busy, ...(profile.accountType === 'business' ? { onOpenMaps: () => void openMaps() } : {}) }), _jsx("div", { className: "inline-actions", children: _jsx("button", { className: "button button-ghost button-compact", type: "button", disabled: busy, onClick: () => void (async () => {
                        setBusy(true);
                        try {
                            if (blocked)
                                await unblockUser(profile.id);
                            else
                                await blockUser(profile.id);
                            setBlocked(!blocked);
                        }
                        catch (err) {
                            setError(err instanceof Error ? err.message : t('errorGeneric'));
                        }
                        finally {
                            setBusy(false);
                        }
                    })(), children: blocked ? t('unblock') : t('block') }) }), blocked ? (_jsx("p", { className: "muted", children: t('blocked') })) : !canView ? (_jsx(EmptyState, { title: t('privateAccount') })) : (_jsxs(_Fragment, { children: [_jsx(HighlightsRail, { items: tabs.highlights, onOpen: (id) => void fetchHighlight(id).then(setHighlightView) }), _jsxs("div", { className: "profile-tabs", role: "tablist", children: [_jsx("button", { type: "button", className: tabs.tab === 'posts' ? 'active' : '', onClick: () => tabs.setTab('posts'), children: t('posts') }), _jsx("button", { type: "button", className: tabs.tab === 'reels' ? 'active' : '', onClick: () => tabs.setTab('reels'), children: t('reels') })] }), tabs.tab === 'posts' ? _jsx(PostsGrid, { posts: tabs.posts, onOpen: setSelected }) : _jsx(ReelsGrid, { reels: tabs.reels })] })), selected ? (_jsx("div", { className: "story-viewer profile-post-viewer", role: "dialog", children: _jsxs("div", { className: "story-viewer-inner explore-modal", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "profile-post-viewer-bar", children: [_jsxs("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setSelected(null), children: ["\u2190 ", t('back')] }), _jsxs("strong", { children: ["@", selected.author?.username || t('posts')] })] }), _jsx(PostCard, { post: selected, onChange: (next) => {
                                setSelected(next);
                                tabs.setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
                            }, onRemoved: (id) => {
                                setSelected(null);
                                tabs.setPosts((prev) => prev.filter((p) => p.id !== id));
                            } })] }) })) : null, highlightView ? (_jsx("div", { className: "story-viewer", role: "dialog", onClick: () => setHighlightView(null), children: _jsxs("div", { className: "story-viewer-inner", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "story-nav", children: [_jsx("strong", { children: highlightView.title }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setHighlightView(null), children: t('close') })] }), (highlightView.items || []).map((it) => (_jsx(MediaFrame, { mediaId: it.mediaId, secureUrl: it.secureUrl, variant: "story", controls: true }, it.mediaId)))] }) })) : null, mapLoc ? (_jsx(InAppMapOverlay, { title: mapLoc.businessName, addressText: mapLoc.addressText, latitude: mapLoc.latitude, longitude: mapLoc.longitude, mapsUrl: mapLoc.mapsUrl, onClose: () => setMapLoc(null) })) : null] }));
}
export function FollowListPage({ mode }) {
    const { t } = useI18n();
    const { idOrUsername = '' } = useParams();
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const loader = mode === 'followers' ? fetchFollowers : fetchFollowing;
        void loader(idOrUsername)
            .then(setItems)
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            .finally(() => setLoading(false));
    }, [idOrUsername, mode, t]);
    if (loading)
        return _jsx(PageLoader, {});
    if (error)
        return _jsx(ErrorBanner, { message: error });
    return (_jsxs("div", { children: [_jsx("h1", { children: mode === 'followers' ? t('followers') : t('following') }), items.length === 0 ? (_jsx(EmptyState, { title: mode === 'followers' ? t('emptyFollowers') : t('emptyFollowing') })) : null, items.map((row) => {
                const u = row.follower || row.following || row.user || row;
                return (_jsx("div", { className: "list-row", children: _jsxs(Link, { to: `/u/${u.username}`, children: ["@", u.username] }) }, row.id || u.id));
            })] }));
}
