import { useI18n } from '@/i18n/I18nProvider';

type Props = {
  title: string;
  addressText?: string | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  mapsUrl?: string | null | undefined;
  onClose: () => void;
};

/** In-app secondary map sheet — does not leave the app (no window.open). */
export function InAppMapOverlay({ title, addressText, latitude, longitude, mapsUrl, onClose }: Props) {
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

  return (
    <div className="sheet-backdrop inapp-map-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet inapp-map-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="reel-sheet-head">
          <strong>{title || t('businessLocation')}</strong>
          <button type="button" className="button button-ghost button-compact" onClick={onClose}>
            {t('close')}
          </button>
        </div>
        {addressText ? <p className="muted tiny">{addressText}</p> : null}
        <div className="inapp-map-frame">
          {embedSrc ? (
            <iframe title={title} src={embedSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          ) : (
            <div className="inapp-map-fallback">
              <p>{fallbackQuery}</p>
              <p className="muted tiny">{t('businessLocation')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
