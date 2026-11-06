import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
const ToastContext = createContext(null);
let nextId = 1;
export function ToastProvider({ children }) {
    const [items, setItems] = useState([]);
    const push = useCallback((message, tone = 'info') => {
        const id = nextId++;
        setItems((prev) => [...prev.slice(-3), { id, message, tone }]);
        window.setTimeout(() => {
            setItems((prev) => prev.filter((item) => item.id !== id));
        }, 3200);
    }, []);
    const value = useMemo(() => ({ push }), [push]);
    return (_jsxs(ToastContext.Provider, { value: value, children: [children, _jsx("div", { className: "toast-stack", "aria-live": "polite", children: items.map((item) => (_jsx("div", { className: `toast toast-${item.tone}`, role: "status", children: item.message }, item.id))) })] }));
}
export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx)
        throw new Error('useToast requires ToastProvider');
    return ctx;
}
