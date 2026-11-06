import { FormEvent } from 'react';

type Props = {
  theme: 'dark' | 'light';
  authMode: 'login' | 'register';
  authError: string;
  mfaRequired?: boolean;
  onToggleMode: () => void;
  onBackToLanding: () => void;
  onToggleTheme: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancelMfa?: () => void;
};

export default function AuthScreen(props: Props) {
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={props.onSubmit}>
        <div className="auth-top-row">
          <span className="brand-pill">SecureChat</span>
          <button className="button button-ghost" type="button" onClick={props.onToggleTheme}>
            {props.theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
        <h2>
          {props.mfaRequired
            ? 'Authenticator code'
            : props.authMode === 'login'
              ? 'Welcome Back'
              : 'Create Account'}
        </h2>
        <p className="muted">
          {props.mfaRequired
            ? 'Enter the 6-digit code from your authenticator app (or a recovery code).'
            : props.authMode === 'register'
              ? 'Username: letters/numbers/_ only. Password: at least 8 characters.'
              : 'Fast, secure messaging with a polished product experience.'}
        </p>
        {!props.mfaRequired ? (
          <>
            <input
              name="username"
              placeholder={props.authMode === 'register' ? 'Username (e.g. ahmed_01)' : 'Username'}
              autoComplete="username"
              minLength={3}
              maxLength={32}
              pattern={props.authMode === 'register' ? '[A-Za-z0-9_]+' : undefined}
              required
            />
            <input
              name="password"
              type="password"
              placeholder={
                props.authMode === 'register' ? 'Password (min 8 characters)' : 'Password'
              }
              autoComplete={props.authMode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              maxLength={128}
              required
            />
          </>
        ) : (
          <input
            name="mfaCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Authenticator or recovery code"
            minLength={6}
            maxLength={64}
            required
          />
        )}
        {props.authError ? <p className="auth-error">{props.authError}</p> : null}
        <button className="button" type="submit">
          {props.mfaRequired ? 'Verify' : props.authMode === 'login' ? 'Login' : 'Register'}
        </button>
        {props.mfaRequired ? (
          <button
            className="button button-ghost"
            type="button"
            onClick={() => props.onCancelMfa?.()}
          >
            Back
          </button>
        ) : (
          <>
            <button className="button button-ghost" type="button" onClick={props.onToggleMode}>
              {props.authMode === 'login' ? 'Need an account?' : 'Have an account?'}
            </button>
            <button className="button button-ghost" type="button" onClick={props.onBackToLanding}>
              Back to landing
            </button>
          </>
        )}
      </form>
    </div>
  );
}
