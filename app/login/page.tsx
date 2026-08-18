'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, HelpCircle, KeyRound, LockKeyhole, ShieldCheck, Zap } from 'lucide-react';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, remember }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(body.error || 'Unable to sign in.');
        return;
      }
      const next = new URLSearchParams(window.location.search).get('next');
      router.push(next?.startsWith('/') ? next : '/');
    } catch {
      setMessage('Unable to reach the authentication service.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.formPanel}>
        <div className={styles.formWrap}>
          <div className={styles.mobileBrand}>
            <Link href="/" className={styles.brand} aria-label="iPayTech Ops home">
              <span className={styles.brandMark}><Zap size={17} fill="currentColor" /></span>
              <span><strong>iPayTech</strong><small>OPS CONSOLE</small></span>
            </Link>
          </div>

          <div className={styles.formIntro}>
            <span className={styles.eyebrow}><LockKeyhole size={14} /> Secure workspace access</span>
            <h2>Welcome back</h2>
            <p>Sign in to continue to your operations workspace.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
              <label htmlFor="email">Work email</label>
              <div className={styles.inputShell}>
                <KeyRound size={17} aria-hidden="true" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label htmlFor="password">Password</label>
                <button type="button" className={styles.forgotLink} onClick={() => setMessage('Password recovery will be available when authentication is connected.')}>Forgot password?</button>
              </div>
              <div className={styles.inputShell}>
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button type="button" className={styles.iconButton} onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <label className={styles.remember}>
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span className={styles.checkbox} aria-hidden="true" />
              <span>Keep me signed in on this device</span>
            </label>

            {message && <p className={styles.formMessage} role="status">{message}</p>}

            <button type="submit" className={styles.submitButton} disabled={loading}>{loading ? 'Signing in…' : 'Sign in'} {!loading && <ArrowRight size={17} />}</button>
          </form>

          <div className={styles.securityNote}><ShieldCheck size={16} /><span>Your access is protected with encrypted credentials and workspace-level permissions.</span></div>
          <p className={styles.support}>Need help accessing your workspace? <button type="button" onClick={() => setMessage('Contact your workspace administrator for access support.')}>Contact your administrator</button> <HelpCircle size={14} /></p>
        </div>
      </section>
    </main>
  );
}
