import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addHighlightStories, createHighlight } from '@/api/accounts';
import { fetchStoriesFeed } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { getSessionSnapshot } from '@/lib/sessionBridge';
import { ErrorBanner } from '../ui/States';
import { useToast } from '../ui/Toast';
export function HighlightCreatePage() {
    const { t } = useI18n();
    const { push } = useToast();
    const navigate = useNavigate();
    const me = getSessionSnapshot()?.user?.id;
    const [title, setTitle] = useState('');
    const [stories, setStories] = useState([]);
    const [selected, setSelected] = useState([]);
    const [error, setError] = useState('');
    useEffect(() => {
        void fetchStoriesFeed()
            .then((rows) => setStories((rows || []).filter((s) => s.authorId === me || s.author?.id === me)))
            .catch(() => setStories([]));
    }, [me]);
    async function onSubmit(e) {
        e.preventDefault();
        try {
            const h = (await createHighlight({ title, storyIds: selected }));
            if (selected.length && h.id)
                await addHighlightStories(h.id, selected);
            push(t('highlightCreated'), 'success');
            navigate('/profile');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('newHighlight') }), _jsx(Link, { to: "/profile", className: "button button-ghost button-compact", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsxs("form", { className: "create-form", onSubmit: (e) => void onSubmit(e), children: [_jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), placeholder: t('highlightTitle'), required: true, maxLength: 40 }), _jsx("p", { className: "muted tiny", children: t('pickStoriesForHighlight') }), stories.map((s) => (_jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: selected.includes(s.id), onChange: (e) => setSelected((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id))) }), s.id.slice(0, 8), " \u00B7 ", s.audience || 'everyone'] }, s.id))), !stories.length ? _jsx("p", { className: "muted", children: t('noActiveStories') }) : null, _jsx("button", { className: "button", type: "submit", children: t('create') })] })] }));
}
