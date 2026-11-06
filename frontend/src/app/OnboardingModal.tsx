type Props = {
  isOpen: boolean;
  step: number;
  onNext: () => void;
  onSkip: () => void;
};

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

export default function OnboardingModal(props: Props) {
  if (!props.isOpen) return null;
  const current = STEPS[Math.min(props.step, STEPS.length - 1)] ?? FALLBACK_STEP;
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <span className="brand-pill">Onboarding</span>
        <h3>{current.title}</h3>
        <p className="muted">{current.text}</p>
        <div className="modal-actions">
          <button className="button button-ghost" onClick={props.onSkip}>
            Skip
          </button>
          <button className="button" onClick={props.onNext}>
            {props.step >= STEPS.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
