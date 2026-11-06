import { FormEvent, useState } from 'react';

type Props = {
  open: boolean;
  authenticated: boolean;
  onToggle: () => void;
  onSubmit: (input: {
    email?: string;
    category: string;
    message: string;
    rating?: number;
  }) => Promise<void>;
};

export default function FeedbackWidget(props: Props) {
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(5);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
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
    } catch {
      setStatus('Could not submit feedback right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="feedback-fab button" onClick={props.onToggle}>
        Feedback
      </button>
      {props.open ? (
        <div className="feedback-panel">
          <form onSubmit={handleSubmit} className="feedback-form">
            <h3>Beta Feedback</h3>
            {!props.authenticated ? (
              <input
                type="email"
                placeholder="Email (optional)"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            ) : null}
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="general">General</option>
              <option value="bug">Bug</option>
              <option value="ux">UX</option>
              <option value="feature">Feature request</option>
            </select>
            <textarea
              placeholder="What should we improve?"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <label className="muted">
              Rating: {rating}/5
              <input
                type="range"
                min={1}
                max={5}
                value={rating}
                onChange={(event) => setRating(Number(event.target.value))}
              />
            </label>
            {status ? <p className="muted">{status}</p> : null}
            <div className="modal-actions">
              <button className="button button-ghost" type="button" onClick={props.onToggle}>
                Close
              </button>
              <button className="button" type="submit" disabled={loading}>
                {loading ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
