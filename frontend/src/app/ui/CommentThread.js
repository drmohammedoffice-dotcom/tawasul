import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { UserAvatar } from './UserAvatar';
function commentBody(c) {
    const raw = String(c.body ?? c.text ?? '');
    if (raw.startsWith('[sticker]'))
        return raw.replace('[sticker]', '').trim();
    return raw;
}
function isSticker(c) {
    return String(c.body ?? c.text ?? '').startsWith('[sticker]');
}
export function CommentThread({ comments, me, ownerId, commentsDisabled, busy, onReply, onDelete }) {
    const { t } = useI18n();
    const [expanded, setExpanded] = useState(() => new Set());
    const roots = useMemo(() => comments.filter((c) => !c.parentId), [comments]);
    const byParent = useMemo(() => {
        const map = new Map();
        for (const c of comments) {
            if (!c.parentId)
                continue;
            const list = map.get(c.parentId) || [];
            list.push(c);
            map.set(c.parentId, list);
        }
        return map;
    }, [comments]);
    function toggle(id) {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }
    function canDelete(c) {
        return Boolean(me && (c.authorId === me || ownerId === me) && onDelete);
    }
    function renderRow(c, nested = false) {
        const body = commentBody(c);
        const sticker = isSticker(c);
        return (_jsxs("div", { className: `reel-comment-row${nested ? ' is-reply' : ''}`, children: [_jsx(UserAvatar, { size: "sm", name: c.author?.displayName || c.author?.username, username: c.author?.username, avatarUrl: c.author?.avatarUrl }), _jsxs("div", { className: "reel-comment-body", children: [_jsxs("strong", { children: ["@", c.author?.username || 'user'] }), _jsx("p", { className: sticker ? 'sticker-text' : undefined, children: body }), _jsxs("div", { className: "reel-comment-actions", children: [!nested && !commentsDisabled && onReply ? (_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => onReply(c.id, c.author?.username || 'user'), children: t('reply') })) : null, canDelete(c) ? (_jsx("button", { type: "button", className: "button button-ghost button-compact", disabled: busy, onClick: () => onDelete?.(c.id), children: t('delete') })) : null] })] })] }));
    }
    return (_jsx("ul", { className: "reel-comments-list", children: roots.map((c) => {
            const replies = byParent.get(c.id) || [];
            const open = expanded.has(c.id);
            return (_jsxs("li", { children: [renderRow(c), replies.length > 0 ? (_jsxs("div", { className: "reel-comment-replies-wrap", children: [_jsx("button", { type: "button", className: "reel-view-replies", onClick: () => toggle(c.id), "aria-expanded": open, children: open
                                    ? t('hideReplies')
                                    : t('viewReplies').replace('{n}', String(replies.length)) }), open ? (_jsx("ul", { className: "reel-comment-replies", children: replies.map((r) => (_jsx("li", { children: renderRow(r, true) }, r.id))) })) : null] })) : null] }, c.id));
        }) }));
}
