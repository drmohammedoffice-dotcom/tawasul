import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { fetchPushStatus } from '@/api/push';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { publishPushPrefs, readPushPermission, requestPushPermission, startPush, syncPushPrefs } from '@/lib/pushClient';
import { IconBell, IconHeart, IconMegaphone, IconUser, IconUsers } from '../ui/Icons';
import { FocusSettingsHeader, FocusSettingsSection, FocusToggleRow } from './FocusSettingsShared';
import { loadNotifPrefs, resetNotifPrefs, saveNotifPrefs } from './focusPrefs';
export function FocusNotificationsPage() {
    const { t } = useI18n();
    const { session } = useAuth();
    const uid = session?.user?.id;
    const [prefs, setPrefs] = useState(() => loadNotifPrefs(uid));
    const [permission, setPermission] = useState('prompt');
    const [serverReady, setServerReady] = useState(null);
    useEffect(() => {
        setPrefs(loadNotifPrefs(uid));
        let cancelled = false;
        void readPushPermission().then((next) => {
            if (!cancelled)
                setPermission(next);
        });
        if (!uid)
            return () => {
                cancelled = true;
            };
        void syncPushPrefs(uid).then((next) => {
            if (!cancelled)
                setPrefs(next);
        });
        void fetchPushStatus()
            .then((status) => {
            if (!cancelled)
                setServerReady(status.enabled);
        })
            .catch(() => {
            if (!cancelled)
                setServerReady(null);
        });
        return () => {
            cancelled = true;
        };
    }, [uid]);
    function patch(partial) {
        setPrefs((prev) => {
            const next = { ...prev, ...partial };
            saveNotifPrefs(uid, next);
            void publishPushPrefs(next);
            return next;
        });
    }
    const statusOn = t('notifStatusOn');
    return (_jsxs("div", { className: "focus-settings", children: [_jsx(FocusSettingsHeader, { title: t('notificationsAndSounds') }), permission !== 'granted' && permission !== 'unsupported' ? (_jsx("section", { className: "focus-settings-block focus-notif-warn", children: _jsxs("div", { className: "focus-notif-warn-inner", children: [_jsx("span", { className: "focus-settings-icon red", children: _jsx(IconBell, { size: 18 }) }), _jsxs("div", { children: [_jsx("strong", { className: "block", children: t('notificationsDisabled') }), _jsx("p", { className: "muted tiny", children: t('notificationsDisabledHint') }), _jsx("button", { type: "button", className: "focus-text-btn", onClick: () => {
                                        void requestPushPermission().then(async (next) => {
                                            setPermission(next);
                                            if (next === 'granted' && uid)
                                                await startPush(uid, { request: true });
                                        });
                                    }, children: t('enableFromSettings') })] })] }) })) : null, permission === 'granted' && serverReady !== null ? (_jsx("p", { className: "focus-settings-hint muted tiny", children: serverReady ? t('pushReady') : t('pushServerOff') })) : null, _jsxs(FocusSettingsSection, { title: t('messageNotifications'), children: [_jsx(FocusToggleRow, { icon: _jsx(IconUser, { size: 18 }), iconClass: "blue", label: t('privateChats'), hint: prefs.privateChats ? statusOn : t('notifStatusOff'), checked: prefs.privateChats, onChange: (v) => patch({ privateChats: v }) }), _jsx(FocusToggleRow, { icon: _jsx(IconUsers, { size: 18 }), iconClass: "green", label: t('groups'), hint: prefs.groups ? statusOn : t('notifStatusOff'), checked: prefs.groups, onChange: (v) => patch({ groups: v }) }), _jsx(FocusToggleRow, { icon: _jsx(IconMegaphone, { size: 18 }), iconClass: "orange", label: t('channels'), hint: prefs.channels ? statusOn : t('notifStatusOff'), checked: prefs.channels, onChange: (v) => patch({ channels: v }) }), _jsx(FocusToggleRow, { icon: _jsx(IconBell, { size: 18 }), iconClass: "purple", label: t('stories'), hint: prefs.stories ? statusOn : t('notifStatusOff'), checked: prefs.stories, onChange: (v) => patch({ stories: v }) }), _jsx(FocusToggleRow, { icon: _jsx(IconHeart, { size: 18 }), iconClass: "red", label: t('reactions'), hint: prefs.reactions ? statusOn : t('notifStatusOff'), checked: prefs.reactions, onChange: (v) => patch({ reactions: v }) })] }), _jsxs(FocusSettingsSection, { title: t('inAppNotifications'), children: [_jsx(FocusToggleRow, { label: t('inAppSounds'), checked: prefs.inAppSounds, onChange: (v) => patch({ inAppSounds: v }) }), _jsx(FocusToggleRow, { label: t('inAppVibrate'), checked: prefs.inAppVibrate, onChange: (v) => patch({ inAppVibrate: v }) }), _jsx(FocusToggleRow, { label: t('inAppPreview'), checked: prefs.inAppPreview, onChange: (v) => patch({ inAppPreview: v }) })] }), _jsx(FocusSettingsSection, { title: t('lockScreen'), hint: t('namesOnLockScreenHint'), children: _jsx(FocusToggleRow, { label: t('namesOnLockScreen'), checked: prefs.namesOnLockScreen, onChange: (v) => patch({ namesOnLockScreen: v }) }) }), _jsxs(FocusSettingsSection, { title: t('badgeCounter'), hint: t('unreadCountHint'), children: [_jsx(FocusToggleRow, { label: t('includeChannels'), checked: prefs.includeChannelsInBadge, onChange: (v) => patch({ includeChannelsInBadge: v }) }), _jsx(FocusToggleRow, { label: t('unreadMessageCount'), checked: prefs.unreadMessageCount, onChange: (v) => patch({ unreadMessageCount: v }) })] }), _jsx(FocusSettingsSection, { hint: t('newContactsHint'), children: _jsx(FocusToggleRow, { label: t('newContacts'), checked: prefs.newContacts, onChange: (v) => patch({ newContacts: v }) }) }), _jsxs("section", { className: "focus-settings-block", children: [_jsx("button", { type: "button", className: "focus-settings-row danger", onClick: () => {
                            const next = resetNotifPrefs(uid);
                            setPrefs(next);
                            void publishPushPrefs(next);
                        }, children: _jsx("span", { children: t('resetAllNotifications') }) }), _jsx("p", { className: "focus-settings-hint muted tiny", children: t('resetAllNotificationsHint') })] })] }));
}
