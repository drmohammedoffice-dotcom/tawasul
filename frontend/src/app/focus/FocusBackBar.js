import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from 'react-router-dom';
import { IconBack } from '../ui/Icons';
export function FocusBackBar({ title, subtitle, fallbackTo = '/focus/chats', onBack, trailing, unreadHint }) {
    const navigate = useNavigate();
    function goBack() {
        if (onBack) {
            onBack();
            return;
        }
        if (window.history.length > 1) {
            navigate(-1);
            return;
        }
        navigate(fallbackTo);
    }
    return (_jsxs("header", { className: "focus-back-bar", children: [_jsxs("button", { type: "button", className: "focus-back-btn", onClick: goBack, "aria-label": "Back", children: [_jsx(IconBack, { size: 20 }), unreadHint != null && unreadHint !== '' ? (_jsx("span", { className: "focus-back-badge", children: unreadHint })) : null] }), title ? (_jsxs("div", { className: "focus-back-titles", children: [_jsx("strong", { className: "ellipsis", children: title }), subtitle ? _jsx("span", { className: "muted tiny ellipsis", children: subtitle }) : null] })) : (_jsx("span", {})), _jsx("div", { className: "focus-back-trailing", children: trailing })] }));
}
