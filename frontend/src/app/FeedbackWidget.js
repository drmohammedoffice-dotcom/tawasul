import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
export default function FeedbackWidget(props) {
    const [email, setEmail] = useState('');
    const [category, setCategory] = useState('general');
    const [message, setMessage] = useState('');
    const [rating, setRating] = useState(5);
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);
    async function handleSubmit(event) {
        event.preventDefault();
        if (message.trim().length < 10) {
            setStatus('Please add at least 10 characters.');
            return;
        }
        setLoading(true);
        setStatus('');
        try {
            const payload = props.authenticated
                ? { category, message: message.trim(), rating }
                : {
                    category,
                    message: message.trim(),
                    rating,
                    ...(email.trim() ? { email: email.trim() } : {})
                };
            await props.onSubmit({
                ...payload
            });
            setStatus('Thanks! Feedback received.');
            setMessage('');
        }
        catch {
            setStatus('Could not submit feedback right now.');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs(_Fragment, { children: [_jsx("button", { className: "feedback-fab button", onClick: props.onToggle, children: "Feedback" }), props.open ? (_jsx("div", { className: "feedback-panel", children: _jsxs("form", { onSubmit: handleSubmit, className: "feedback-form", children: [_jsx("h3", { children: "Beta Feedback" }), !props.authenticated ? (_jsx("input", { type: "email", placeholder: "Email (optional)", value: email, onChange: (event) => setEmail(event.target.value) })) : null, _jsxs("select", { value: category, onChange: (event) => setCategory(event.target.value), children: [_jsx("option", { value: "general", children: "General" }), _jsx("option", { value: "bug", children: "Bug" }), _jsx("option", { value: "ux", children: "UX" }), _jsx("option", { value: "feature", children: "Feature request" })] }), _jsx("textarea", { placeholder: "What should we improve?", value: message, onChange: (event) => setMessage(event.target.value) }), _jsxs("label", { className: "muted", children: ["Rating: ", rating, "/5", _jsx("input", { type: "range", min: 1, max: 5, value: rating, onChange: (event) => setRating(Number(event.target.value)) })] }), status ? _jsx("p", { className: "muted", children: status }) : null, _jsxs("div", { className: "modal-actions", children: [_jsx("button", { className: "button button-ghost", type: "button", onClick: props.onToggle, children: "Close" }), _jsx("button", { className: "button", type: "submit", disabled: loading, children: loading ? 'Sending...' : 'Send' })] })] }) })) : null] }));
}
