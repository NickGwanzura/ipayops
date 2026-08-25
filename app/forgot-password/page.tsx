'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import styles from '@/app/login/login.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || 'Unable to send reset instructions.');
        return;
      }
      setSubmitted(true);
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
          <span className={styles.kicker}><span className={styles.liveDot} /> Account recovery</span>
          <h1>Back to secure operations.</h1>
          <p>Reset your credentials and return to the workspace with your organization permissions intact.</p>
        </div>
        <div className={styles.visualFooter}><span>iPayTech Operations</span><span>Secure access</span></div>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.card}>
          <Link href="/" className={styles.brand} aria-label="iPayTech Ops home">
            <Image className={styles.brandLogo} src="/iPaytechLogo.jpg" alt="iPayTech" width={180} height={76} priority />
            <span>OPERATIONS PLATFORM</span>
          </Link>

          {!submitted ? (
            <>
              <div className={styles.heading}>
                <span className={styles.eyebrow}><LockKeyhole size={14} /> Password recovery</span>
                <h1>Forgot your password?</h1>
                <p>Enter your work email and we’ll send a secure reset link if an account matches it.</p>
              </div>
              <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <label htmlFor="recovery-email">Work email
                  <span className={styles.inputShell}><KeyRound size={17} aria-hidden="true" /><input id="recovery-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={event => setEmail(event.target.value)} required /></span>
                </label>
                {message && <p className={styles.error} role="alert">{message}</p>}
                <button type="submit" className={styles.submit} disabled={loading}>{loading ? 'Sending…' : 'Send reset link'} {!loading && <ArrowRight size={17} />}</button>
              </form>
              <div className={styles.securityNote}><ShieldCheck size={16} /><span>For your security, the response is the same whether or not an account matches the email.</span></div>
            </>
          ) : (
            <div className={styles.heading}>
              <div className={styles.inviteSummary}><CheckCircle2 size={20} /><div><strong>Check your inbox</strong><span>If an account matches that email address, reset instructions are on their way.</span></div></div>
              <h1>One more step.</h1>
              <p>The reset link is valid for 30 minutes. If you don’t see it, check your spam folder or try again with the same address.</p>
            </div>
          )}

          <p className={styles.support}><Link href="/login" className={styles.forgotLink}>Back to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
