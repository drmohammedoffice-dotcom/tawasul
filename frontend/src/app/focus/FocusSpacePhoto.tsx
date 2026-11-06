import { useRef, useState } from 'react';
import {
  fetchMediaUrl,
  resolveMediaUrl,
  updateChannel,
  updateGroup,
  uploadMediaFile
} from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { AvatarCrop } from '../ui/AvatarCrop';
import { UserAvatar } from '../ui/UserAvatar';
import { ErrorBanner } from '../ui/States';

type Props = {
  kind: 'group' | 'channel';
  spaceId: string;
  name: string;
  avatarUrl?: string | null;
  canEdit: boolean;
  onUpdated: (avatarUrl: string | null) => void;
  size?: 'lg' | 'xl';
};

/** Same crop → upload → persist flow as Browse profile photos. */
export function FocusSpacePhoto({
  kind,
  spaceId,
  name,
  avatarUrl,
  canEdit,
  onUpdated,
  size = 'xl'
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function applyCrop(blob: Blob) {
    setCropFile(null);
    setBusy(true);
    setError('');
    try {
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      const mediaId = await uploadMediaFile(file, 'avatar');
      const { secureUrl } = await fetchMediaUrl(mediaId);
      let persist = secureUrl || '';
      try {
        if (/^https?:\/\//i.test(persist)) {
          const u = new URL(persist);
          persist = `${u.pathname}${u.search}`;
        }
      } catch {
        /* keep */
      }
      if (kind === 'group') {
        await updateGroup(spaceId, { avatarUrl: persist || null });
      } else {
        await updateChannel(spaceId, { avatarUrl: persist || null });
      }
      onUpdated(resolveMediaUrl(persist) || persist || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="focus-space-photo">
      {canEdit ? (
        <button
          type="button"
          className="focus-space-photo-btn"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <UserAvatar size={size} name={name} avatarUrl={avatarUrl} />
          <span className="tg-change-photo">{busy ? '…' : t('changePhoto')}</span>
        </button>
      ) : (
        <UserAvatar size={size} name={name} avatarUrl={avatarUrl} />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (f) setCropFile(f);
        }}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {cropFile ? (
        <AvatarCrop
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(b) => void applyCrop(b)}
        />
      ) : null}
    </div>
  );
}
