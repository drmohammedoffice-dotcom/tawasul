import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
const STORAGE_KEY = 'securechat-app-mode';
const AppModeContext = createContext(null);
function readStoredMode() {
    try {
        const v = window.localStorage.getItem(STORAGE_KEY);
        if (v === 'focus' || v === 'browse')
            return v;
    }
    catch {
        /* ignore */
    }
    return 'browse';
}
function persistMode(mode) {
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    }
    catch {
        /* ignore */
    }
}
export function AppModeProvider({ children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const switchingRef = useRef(false);
    const bootstrapped = useRef(false);
    const pathMode = location.pathname.startsWith('/focus') ? 'focus' : 'browse';
    const [mode, setModeState] = useState(() => typeof window !== 'undefined' ? readStoredMode() : 'browse');
    // Keep mode aligned with the URL (source of truth while navigating).
    useEffect(() => {
        if (switchingRef.current) {
            switchingRef.current = false;
        }
        setModeState(pathMode);
        persistMode(pathMode);
    }, [pathMode]);
    // On first authenticated load, honor stored preference once.
    useEffect(() => {
        if (bootstrapped.current)
            return;
        bootstrapped.current = true;
        const preferred = readStoredMode();
        if (preferred === 'focus' && !location.pathname.startsWith('/focus')) {
            switchingRef.current = true;
            navigate('/focus/chats', { replace: true });
        }
        else if (preferred === 'browse' && location.pathname.startsWith('/focus')) {
            // Stay on focus route if user opened a focus deep link; path wins.
            persistMode('focus');
        }
    }, [location.pathname, navigate]);
    const setMode = useCallback((next) => {
        if (next === mode && (next === 'focus' ? location.pathname.startsWith('/focus') : !location.pathname.startsWith('/focus'))) {
            return;
        }
        switchingRef.current = true;
        setModeState(next);
        persistMode(next);
        if (next === 'focus') {
            if (!location.pathname.startsWith('/focus')) {
                navigate('/focus/chats');
            }
        }
        else if (location.pathname.startsWith('/focus')) {
            navigate('/feed');
        }
    }, [location.pathname, mode, navigate]);
    const toggleMode = useCallback(() => {
        setMode(mode === 'browse' ? 'focus' : 'browse');
    }, [mode, setMode]);
    const value = useMemo(() => ({
        mode,
        setMode,
        toggleMode,
        isFocus: mode === 'focus'
    }), [mode, setMode, toggleMode]);
    return _jsx(AppModeContext.Provider, { value: value, children: children });
}
export function useAppMode() {
    const ctx = useContext(AppModeContext);
    if (!ctx) {
        throw new Error('useAppMode must be used within AppModeProvider');
    }
    return ctx;
}
