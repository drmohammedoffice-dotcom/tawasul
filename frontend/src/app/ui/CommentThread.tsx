import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { UserAvatar } from './UserAvatar';

type CommentAuthor = {
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type ThreadComment = {
  id: string;
  body?: string;
  text?: string;
  parentId?: string | null;
  authorId?: string;
  author?: CommentAuthor;
};

type Props = {
  comments: ThreadComment[];
  me?: string;
  ownerId?: string;
  commentsDisabled?: boolean;
  busy?: boolean;
  onReply?: (parentId: string, username: string) => void;
  onDelete?: (commentId: string) => void;
};

function commentBody(c: ThreadComment) {
  const raw = String(c.body ?? c.text ?? '');
  if (raw.startsWith('[sticker]')) return raw.replace('[sticker]', '').trim();
  return raw;
}

function isSticker(c: ThreadComment) {
  return String(c.body ?? c.text ?? '').startsWith('[sticker]');
}

export function CommentThread({
  comments,
  me,
  ownerId,
  commentsDisabled,
  busy,
  onReply,
  onDelete
}: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const roots = useMemo(() => comments.filter((c) => !c.parentId), [comments]);
  const byParent = useMemo(() => {
    const map = new Map<string, ThreadComment[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const list = map.get(c.parentId) || [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [comments]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function canDelete(c: ThreadComment) {
    return Boolean(me && (c.authorId === me || ownerId === me) && onDelete);
  }

  function renderRow(c: ThreadComment, nested = false) {
    const body = commentBody(c);
    const sticker = isSticker(c);
    return (
      <div className={`reel-comment-row${nested ? ' is-reply' : ''}`}>
        <UserAvatar
          size="sm"
          name={c.author?.displayName || c.author?.username}
          username={c.author?.username}
          avatarUrl={c.author?.avatarUrl}
        />
        <div className="reel-comment-body">
          <strong>@{c.author?.username || 'user'}</strong>
          <p className={sticker ? 'sticker-text' : undefined}>{body}</p>
          <div className="reel-comment-actions">
            {!nested && !commentsDisabled && onReply ? (
              <button
                type="button"
                className="button button-ghost button-compact"
                onClick={() => onReply(c.id, c.author?.username || 'user')}
              >
                {t('reply')}
              </button>
            ) : null}
            {canDelete(c) ? (
              <button
                type="button"
                className="button button-ghost button-compact"
                disabled={busy}
                onClick={() => onDelete?.(c.id)}
              >
                {t('delete')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ul className="reel-comments-list">
      {roots.map((c) => {
        const replies = byParent.get(c.id) || [];
        const open = expanded.has(c.id);
        return (
          <li key={c.id}>
            {renderRow(c)}
            {replies.length > 0 ? (
              <div className="reel-comment-replies-wrap">
                <button
                  type="button"
                  className="reel-view-replies"
                  onClick={() => toggle(c.id)}
                  aria-expanded={open}
                >
                  {open
                    ? t('hideReplies')
                    : t('viewReplies').replace('{n}', String(replies.length))}
                </button>
                {open ? (
                  <ul className="reel-comment-replies">
                    {replies.map((r) => (
                      <li key={r.id}>{renderRow(r, true)}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
