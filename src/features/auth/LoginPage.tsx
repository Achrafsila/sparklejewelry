import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../app/auth';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { IconEye, IconEyeOff } from '../../ui/icons';
import './login.css';

type Status = { kind: 'idle' } | { kind: 'error'; text: string } | { kind: 'info'; text: string };

export function LoginPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const back = params.get('retour');
  const target = back && back.startsWith('/') && !back.startsWith('//') ? back : '/stock';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [emailError, setEmailError] = useState<string | null>(null);

  if (session) return <Navigate to={target} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setEmailError(null);
    if (!email.trim() || !password) {
      setStatus({ kind: 'error', text: 'Saisissez votre e-mail et votre mot de passe.' });
      return;
    }
    setPending(true);
    setStatus({ kind: 'idle' });
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPending(false);
    if (error) {
      const network = /fetch|network/i.test(error.message);
      setStatus({
        kind: 'error',
        text: network ? 'Connexion impossible. Vérifiez le réseau puis réessayez.' : 'E-mail ou mot de passe incorrect.',
      });
      return;
    }
    navigate(target, { replace: true });
  }

  async function onForgot() {
    if (!email.trim()) {
      setEmailError('Saisissez votre e-mail pour recevoir le lien de réinitialisation.');
      return;
    }
    setEmailError(null);
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/connexion` });
    setStatus({ kind: 'info', text: 'Si ce compte existe, un lien de réinitialisation vient d’être envoyé.' });
  }

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__brand">
          <span className="wordmark__name login__name">Sparkle</span>
          <span className="wordmark__facet" aria-hidden="true" />
        </div>
        <h1 className="login__title">Connexion au back-office</h1>
        <form className="form-grid" onSubmit={onSubmit} noValidate>
          <Field label="E-mail" error={emailError}>
            {(p) => (
              <input
                {...p}
                className="input"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Mot de passe">
            {(p) => (
              <div className="input-affix">
                <input
                  {...p}
                  className="input"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="input-affix__button"
                  aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  aria-pressed={visible}
                  onClick={() => setVisible((v) => !v)}
                >
                  {visible ? <IconEyeOff size={18} aria-hidden="true" /> : <IconEye size={18} aria-hidden="true" />}
                </button>
              </div>
            )}
          </Field>
          <div>
            <Button type="submit" variant="primary" block pending={pending}>
              Se connecter
            </Button>
            <div aria-live="polite">
              {status.kind === 'error' && (
                <p className="inline-status inline-status--error" role="alert">
                  {status.text}
                </p>
              )}
              {status.kind === 'info' && <p className="inline-status inline-status--success">{status.text}</p>}
            </div>
          </div>
          <button type="button" className="login__forgot" onClick={onForgot}>
            Mot de passe oublié
          </button>
        </form>
      </div>
    </main>
  );
}
