'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useParams } from 'next/navigation';
import styles from '@/app/login/login.module.css';

type ResetState = 'checking' | 'ready' | 'invalid' | 'complete';

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const [state, setState] = useState<ResetState>('checking');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`/api/auth/password-reset/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(response => response.json() as Promise<{ valid?: boolean }>)
      .then(body => {
        if (active) setState(body.valid ? 'ready' : 'invalid');
      })
      .catch(() => {
        if (active) setState('invalid');
      });
    return () => { active = false; };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12 || password.length > 128) {
      setMessage('Choose a password between 12 and 128 characters.');
      return;
    }
    if (password !== passwordConfirmation) {
      setMessage('Passwords do not match.');
      return;
    }
    setMessage('');
    setLoading(true);
    try {
      const response = await fetch(`/api/auth/password-reset/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, passwordConfirmation }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || 'This password reset link is invalid or has expired.');
        if (response.status === 400 && body.error?.includes('invalid or has expired')) setState('invalid');
        return;
      }
      setState('complete');
    } catch {
      setMessage('Unable to reach the password recovery service.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.visualPanel} aria-label="iPayTech account security">
        <div className={styles.visualGlow} aria-hidden="true" />
        <div className={styles.visualGrid} aria-hidden="true" />
        <div className={styles.visualContent}>
          <Link href="/" className={styles.brand} aria-label="iPayTech Ops home">
            <Image className={styles.brandLogo} src="/iPaytechLogo.jpg" alt="iPayTech" width={180} height={76} priority />
          </Link>
        </div>
        <div className={styles.visualCopy}>
          <span className={styles.kicker}><span className={styles.liveDot} /> Protected workspace</span>
          <h1>Keep every workflow moving.</h1>
          <p>Your password protects the people, stock, finance, and service records in your operations workspace.</p>
        </div>
        <div className={styles.visualFooter}><span>iPayTech Operations</span><span>Secure access</span></div>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.card}>
          <Link href="/" className={styles.brand} aria-label="iPayTech Ops home">
            <Image className={styles.brandLogo} src="/iPaytechLogo.jpg" alt="iPayTech" width={180} height={76} priority />
            <span>OPERATIONS PLATFORM</span>
          </Link>

          {state === 'checking' && <div className={styles.heading}><span className={styles.eyebrow}><LockKeyhole size={14} /> Secure link</span><h1>Checking your link…</h1><p>Please wait while we verify this password reset request.</p></div>}
          {state === 'invalid' && <div className={styles.heading}><span className={styles.eyebrow}><LockKeyhole size={14} /> Secure link</span><h1>Link unavailable</h1><p>This password reset link is invalid or has expired. Request a new link to continue.</p><Link href="/forgot-password" className={styles.submit}>Request a new link <ArrowRight size={17} /></Link></div>}
          {state === 'complete' && <div className={styles.heading}><div className={styles.inviteSummary}><CheckCircle2 size={20} /><div><strong>Password updated</strong><span>Your other active sessions have been signed out.</span></div></div><h1>You’re all set.</h1><p>Sign in with your new password to return to your operations workspace.</p><Link href="/login" className={styles.submit}>Continue to sign in <ArrowRight size={17} /></Link></div>}
          {state === 'ready' && <>
            <div className={styles.heading}><span className={styles.eyebrow}><LockKeyhole size={14} /> Choose a new password</span><h1>Reset your password</h1><p>Use at least 12 characters. Your other active sessions will be signed out.</p></div>
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <label htmlFor="new-password">New password
                <span className={styles.passwordField}><LockKeyhole size={17} aria-hidden="true" /><input id="new-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={128} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide new password' : 'Show new password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
              </label>
              <label htmlFor="password-confirmation">Confirm new password
                <span className={styles.passwordField}><LockKeyhole size={17} aria-hidden="true" /><input id="password-confirmation" name="passwordConfirmation" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} required minLength={12} maxLength={128} /><button type="button" onClick={() => setShowConfirmation(!showConfirmation)} aria-label={showConfirmation ? 'Hide password confirmation' : 'Show password confirmation'}>{showConfirmation ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
              </label>
              {message && <p className={styles.error} role="alert">{message}</p>}
              <button type="submit" className={styles.submit} disabled={loading}>{loading ? 'Updating…' : 'Update password'} {!loading && <ShieldCheck size={17} />}</button>
            </form>
          </>}

          <p className={styles.support}><Link href="/login" className={styles.forgotLink}>Back to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
