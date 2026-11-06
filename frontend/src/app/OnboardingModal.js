import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const STEPS = [
    {
        title: 'Open your first conversation',
        text: 'Use the sidebar to open a user by ID and instantly jump into chat.'
    },
    {
        title: 'Use smart replies',
        text: 'Tap AI suggestions above the composer to answer faster.'
    },
    {
        title: 'Share feedback anytime',
        text: 'Use the feedback button to tell us what to improve during beta.'
    }
];
const FALLBACK_STEP = {
    title: 'Welcome to SecureChat',
    text: 'Let us quickly walk through the essentials.'
};
export default function OnboardingModal(props) {
    if (!props.isOpen)
        return null;
    const current = STEPS[Math.min(props.step, STEPS.length - 1)] ?? FALLBACK_STEP;
    return (_jsx("div", { className: "modal-backdrop", children: _jsxs("div", { className: "modal-card", children: [_jsx("span", { className: "brand-pill", children: "Onboarding" }), _jsx("h3", { children: current.title }), _jsx("p", { className: "muted", children: current.text }), _jsxs("div", { className: "modal-actions", children: [_jsx("button", { className: "button button-ghost", onClick: props.onSkip, children: "Skip" }), _jsx("button", { className: "button", onClick: props.onNext, children: props.step >= STEPS.length - 1 ? 'Finish' : 'Next' })] })] }) }));
}
