import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const ROWS = [
    ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'],
    ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
    ['ئ', 'ء', 'ؤ', 'ر', 'لا', 'ى', 'ة', 'و', 'ز', 'ظ', 'د'],
    ['ذ', 'إ', 'أ', 'آ', '،', '؟', '!', '.', 'ـ']
];
/** On-screen Arabic keyboard for emulators / devices without Arabic IME. */
export function ArabicKeyboard({ onInsert, onBackspace, onSpace, onClose }) {
    return (_jsxs("div", { className: "ar-keyboard", dir: "rtl", lang: "ar", children: [_jsxs("div", { className: "ar-keyboard-top", children: [_jsx("span", { className: "muted tiny", children: "\u0644\u0648\u062D\u0629 \u0639\u0631\u0628\u064A\u0629" }), onClose ? (_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: onClose, children: "\u0625\u063A\u0644\u0627\u0642" })) : null] }), ROWS.map((row, i) => (_jsx("div", { className: "ar-keyboard-row", children: row.map((ch) => (_jsx("button", { type: "button", className: "ar-key", onClick: () => onInsert(ch), children: ch }, `${i}-${ch}`))) }, i))), _jsxs("div", { className: "ar-keyboard-row ar-keyboard-actions", children: [_jsx("button", { type: "button", className: "ar-key ar-key-wide", onClick: onBackspace, children: "\u232B" }), _jsx("button", { type: "button", className: "ar-key ar-key-space", onClick: onSpace, children: "\u0645\u0633\u0627\u0641\u0629" }), _jsx("button", { type: "button", className: "ar-key", onClick: () => onInsert('\n'), children: "\u21B5" })] })] }));
}
