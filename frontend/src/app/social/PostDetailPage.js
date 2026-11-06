import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchPost } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { ErrorBanner, PageLoader } from '../ui/States';
import { PostCard } from './PostCard';
export function PostDetailPage() {
    const { postId = '' } = useParams();
    const { t } = useI18n();
    const navigate = useNavigate();
    const me = getSessionSnapshot()?.user?.id;
    const [post, setPost] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        setLoading(true);
        void fetchPost(postId)
            .then(setPost)
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            .finally(() => setLoading(false));
    }, [postId, t]);
    if (loading)
        return _jsx(PageLoader, {});
    if (error)
        return _jsx(ErrorBanner, { message: error });
    if (!post)
        return _jsx(ErrorBanner, { message: t('emptyPosts') });
    const backTo = me && post.authorId === me
        ? '/profile'
        : post.author?.username
            ? `/u/${post.author.username}`
            : '/feed';
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsxs("button", { type: "button", className: "button button-ghost button-compact", onClick: () => {
                            if (window.history.length > 1)
                                navigate(-1);
                            else
                                navigate(backTo);
                        }, children: ["\u2190 ", t('back')] }), _jsx("h1", { children: t('posts') }), _jsx(Link, { to: backTo, className: "button button-ghost button-compact", children: t('profile') })] }), _jsx(PostCard, { post: post, onChange: setPost, onRemoved: () => navigate(backTo) })] }));
}
