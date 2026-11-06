type Props = {
  onStart: () => void;
  onToggleTheme: () => void;
  theme: 'dark' | 'light';
};

export default function LandingPage(props: Props) {
  return (
    <div className="landing-wrap">
      <header className="landing-nav">
        <h1 className="sidebar-title">SecureChat</h1>
        <button className="button button-ghost" onClick={props.onToggleTheme}>
          {props.theme === 'dark' ? 'Light' : 'Dark'} mode
        </button>
      </header>
      <main className="landing-content">
        <span className="brand-pill">Beta Launch</span>
        <h2>Secure messaging built for speed, privacy, and real collaboration.</h2>
        <p className="muted">
          End-to-end encrypted chats, smart AI replies, modern multi-device UX, and premium-ready
          infrastructure.
        </p>
        <div className="landing-actions">
          <button className="button" onClick={props.onStart}>
            Get Started
          </button>
        </div>
      </main>
    </div>
  );
}
