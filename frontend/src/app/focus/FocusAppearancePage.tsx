import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { IconCheck } from '../ui/Icons';
import {
  FocusSettingsHeader,
  FocusSettingsSection,
  FocusToggleRow
} from './FocusSettingsShared';
import {
  applyAppearanceToDocument,
  CHAT_THEME_VARS,
  loadAppearancePrefs,
  saveAppearancePrefs,
  type FocusAppearancePrefs,
  type FocusChatThemeId
} from './focusPrefs';

const THEMES: FocusChatThemeId[] = ['classic', 'sunset', 'frost', 'rose'];
const ACCENTS = ['#2aabee', '#34c759', '#ff9f0a', '#af52de', '#ff2d55', '#64d2ff'];
const BACKGROUNDS = [
  { id: 'doodle-dark', labelKey: 'chatBgDoodle' as const },
  { id: 'solid-dark', labelKey: 'chatBgSolid' as const },
  { id: 'gradient-blue', labelKey: 'chatBgGradient' as const }
];

export function FocusAppearancePage() {
  const { t } = useI18n();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [prefs, setPrefs] = useState<FocusAppearancePrefs>(() => loadAppearancePrefs(uid));

  useEffect(() => {
    const next = loadAppearancePrefs(uid);
    setPrefs(next);
    applyAppearanceToDocument(next);
  }, [uid]);

  function patch(partial: Partial<FocusAppearancePrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      saveAppearancePrefs(uid, next);
      applyAppearanceToDocument(next);
      return next;
    });
  }

  const theme = CHAT_THEME_VARS[prefs.chatTheme];

  return (
    <div className="focus-settings">
      <FocusSettingsHeader title={t('appearance')} />

      <section
        className="focus-settings-block focus-appear-preview"
        data-focus-bg={prefs.chatBackground}
        style={{ ['--focus-bubble-out' as string]: theme.bubbleOut }}
      >
        <div className="focus-appear-bubble in">
          <span className="focus-appear-name">Ayman</span>
          <p>{t('appearPreviewIn')}</p>
          <span className="focus-appear-time">9:20</span>
        </div>
        <div
          className="focus-appear-bubble out"
          style={{
            background: theme.bubbleOut,
            color: theme.bubbleOutText,
            borderRadius: prefs.bubbleRadius === 'sm' ? 10 : prefs.bubbleRadius === 'lg' ? 22 : 16
          }}
        >
          <p>{t('appearPreviewOut')}</p>
          <span className="focus-appear-time">
            9:20 <span className="wa-ticks is-read" aria-hidden>✓✓</span>
          </span>
        </div>
      </section>

      <FocusSettingsSection title={t('chatThemes')}>
        <div className="focus-theme-carousel">
          {THEMES.map((id) => {
            const v = CHAT_THEME_VARS[id];
            const selected = prefs.chatTheme === id;
            return (
              <button
                key={id}
                type="button"
                className={`focus-theme-tile${selected ? ' is-selected' : ''}`}
                onClick={() => patch({ chatTheme: id })}
                aria-pressed={selected}
              >
                <span className="focus-theme-tile-bg" data-focus-bg={prefs.chatBackground} />
                <span className="focus-theme-tile-bubble" style={{ background: v.bubbleOut }} />
                {selected ? (
                  <span className="focus-theme-check">
                    <IconCheck size={14} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </FocusSettingsSection>

      <FocusSettingsSection>
        <div className="focus-settings-row focus-settings-row-static">
          <span className="focus-settings-toggle-copy">
            <strong className="block">{t('chatBackground')}</strong>
          </span>
        </div>
        <div className="focus-bg-options">
          {BACKGROUNDS.map((bg) => (
            <button
              key={bg.id}
              type="button"
              className={`button button-compact ${prefs.chatBackground === bg.id ? '' : 'button-ghost'}`}
              onClick={() => patch({ chatBackground: bg.id })}
            >
              {t(bg.labelKey)}
            </button>
          ))}
        </div>
        <div className="focus-settings-row focus-settings-row-static">
          <span className="focus-settings-toggle-copy">
            <strong className="block">{t('yourColor')}</strong>
          </span>
        </div>
        <div className="focus-accent-row">
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              className={`focus-accent-swatch${prefs.accentColor === c ? ' is-selected' : ''}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => patch({ accentColor: c })}
            />
          ))}
        </div>
      </FocusSettingsSection>

      <FocusSettingsSection>
        <FocusToggleRow
          label={t('nightMode')}
          checked={prefs.nightMode}
          onChange={(v) => patch({ nightMode: v, nightModeAuto: 'off' })}
        />
        <div className="focus-settings-row">
          <span className="focus-settings-toggle-copy">
            <strong className="block">{t('autoNightMode')}</strong>
          </span>
          <select
            className="focus-lang-select"
            value={prefs.nightModeAuto}
            onChange={(e) =>
              patch({ nightModeAuto: e.target.value as FocusAppearancePrefs['nightModeAuto'] })
            }
          >
            <option value="off">{t('notifStatusOff')}</option>
            <option value="system">{t('systemDefault')}</option>
          </select>
        </div>
      </FocusSettingsSection>

      <FocusSettingsSection>
        <div className="focus-settings-row">
          <span className="focus-settings-toggle-copy">
            <strong className="block">{t('fontSize')}</strong>
          </span>
          <select
            className="focus-lang-select"
            value={prefs.fontSize}
            onChange={(e) =>
              patch({ fontSize: e.target.value as FocusAppearancePrefs['fontSize'] })
            }
          >
            <option value="system">{t('systemDefault')}</option>
            <option value="sm">{t('fontSmall')}</option>
            <option value="md">{t('fontMedium')}</option>
            <option value="lg">{t('fontLarge')}</option>
          </select>
        </div>
        <div className="focus-settings-row">
          <span className="focus-settings-toggle-copy">
            <strong className="block">{t('messageCorners')}</strong>
          </span>
          <select
            className="focus-lang-select"
            value={prefs.bubbleRadius}
            onChange={(e) =>
              patch({ bubbleRadius: e.target.value as FocusAppearancePrefs['bubbleRadius'] })
            }
          >
            <option value="sm">{t('fontSmall')}</option>
            <option value="md">{t('fontMedium')}</option>
            <option value="lg">{t('fontLarge')}</option>
          </select>
        </div>
        <FocusToggleRow
          label={t('motionEffects')}
          checked={prefs.motionEffects}
          onChange={(v) => patch({ motionEffects: v })}
        />
        <FocusToggleRow
          label={t('stickersAndEmoji')}
          checked={prefs.stickersEnabled}
          onChange={(v) => patch({ stickersEnabled: v })}
        />
      </FocusSettingsSection>
    </div>
  );
}
