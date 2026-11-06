import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useI18n } from '@/i18n/I18nProvider';
/** In-app secondary map sheet — does not leave the app (no window.open). */
export function InAppMapOverlay({ title, addressText, latitude, longitude, mapsUrl, onClose }) {
    const { t } = useI18n();
    const hasCoords = latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude);
    const embedSrc = hasCoords
        ? `https://maps.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}&z=15&output=embed`
        : addressText?.trim()
            ? `https://maps.google.com/maps?q=${encodeURIComponent(addressText.trim())}&z=14&output=embed`
            : mapsUrl
                ? mapsUrl.replace('/maps/search/', '/maps').includes('output=embed')
                    ? mapsUrl
                    : null
                : null;
    const fallbackQuery = hasCoords
        ? `${latitude},${longitude}`
        : addressText?.trim() || title;
    return (_jsx("div", { className: "sheet-backdrop inapp-map-backdrop", role: "dialog", "aria-modal": "true", onClick: onClose, children: _jsxs("div", { className: "sheet inapp-map-sheet", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "reel-sheet-head", children: [_jsx("strong", { children: title || t('businessLocation') }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: onClose, children: t('close') })] }), addressText ? _jsx("p", { className: "muted tiny", children: addressText }) : null, _jsx("div", { className: "inapp-map-frame", children: embedSrc ? (_jsx("iframe", { title: title, src: embedSrc, loading: "lazy", referrerPolicy: "no-referrer-when-downgrade" })) : (_jsxs("div", { className: "inapp-map-fallback", children: [_jsx("p", { children: fallbackQuery }), _jsx("p", { className: "muted tiny", children: t('businessLocation') })] })) })] }) }));
}
