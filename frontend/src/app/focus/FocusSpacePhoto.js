import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { fetchMediaUrl, resolveMediaUrl, updateChannel, updateGroup, uploadMediaFile } from '@/api/social';
import { useI18n } from '@/i18n/I18nProvider';
import { AvatarCrop } from '../ui/AvatarCrop';
import { UserAvatar } from '../ui/UserAvatar';
import { ErrorBanner } from '../ui/States';
/** Same crop → upload → persist flow as Browse profile photos. */
export function FocusSpacePhoto({ kind, spaceId, name, avatarUrl, canEdit, onUpdated, size = 'xl' }) {
    const { t } = useI18n();
    const inputRef = useRef(null);
    const [cropFile, setCropFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function applyCrop(blob) {
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
            }
            catch {
                /* keep */
            }
            if (kind === 'group') {
                await updateGroup(spaceId, { avatarUrl: persist || null });
            }
            else {
                await updateChannel(spaceId, { avatarUrl: persist || null });
            }
            onUpdated(resolveMediaUrl(persist) || persist || null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: "focus-space-photo", children: [canEdit ? (_jsxs("button", { type: "button", className: "focus-space-photo-btn", disabled: busy, onClick: () => inputRef.current?.click(), children: [_jsx(UserAvatar, { size: size, name: name, avatarUrl: avatarUrl }), _jsx("span", { className: "tg-change-photo", children: busy ? '…' : t('changePhoto') })] })) : (_jsx(UserAvatar, { size: size, name: name, avatarUrl: avatarUrl })), _jsx("input", { ref: inputRef, type: "file", accept: "image/*", hidden: true, onChange: (e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    if (f)
                        setCropFile(f);
                } }), error ? _jsx(ErrorBanner, { message: error }) : null, cropFile ? (_jsx(AvatarCrop, { file: cropFile, onCancel: () => setCropFile(null), onConfirm: (b) => void applyCrop(b) })) : null] }));
}
