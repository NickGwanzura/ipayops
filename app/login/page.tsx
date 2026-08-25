'use client';

import Link from 'next/link';
import Image from 'next/image';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, HelpCircle, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import styles from './login.module.css';

type MfaKind = 'enroll' | 'verify';

export default function LoginPage() {
  const [step, setStep] = useState<'login' | 'mfa' | 'recovery'>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaKind, setMfaKind] = useState<MfaKind>('verify');
  const [manualKey, setManualKey] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  function finishLogin() {
    const next = new URLSearchParams(window.location.search).get('next');
    const destination = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
    // Force a full navigation so middleware and server components read the
    // session cookie immediately after it is set by the login response.
    window.location.assign(destination);
  }

  const loadChallenge = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/mfa/challenge');
      const body = await response.json() as { error?: string; kind?: MfaKind; manualKey?: string; qrDataUrl?: string };
      if (!response.ok || !body.kind) {
        setMessage(body.error || 'Unable to start MFA verification.');
        setStep('login');
        return false;
      }
      setMfaKind(body.kind);
      setManualKey(body.manualKey || '');
      setQrDataUrl(body.qrDataUrl || '');
      return true;
    } catch {
      setMessage('Unable to reach the authentication service.');
      setStep('login');
      return false;
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mfa') !== '1') return;
    setStep('mfa');
    void loadChallenge();
  }, [loadChallenge]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, remember }) });
      const body = await response.json() as { error?: string; mfaRequired?: boolean; enrollmentRequired?: boolean };
      if (!response.ok) {
        setMessage(body.error || 'Unable to sign in.');
        return;
      }
      if (response.status === 202 && body.mfaRequired) {
        setPassword('');
        setStep('mfa');
        setMessage('');
        await loadChallenge();
        return;
      }
      finishLogin();
    } catch {
      setMessage('Unable to reach the authentication service.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = mfaCode.trim();
    if (mfaKind === 'enroll' && !/^\d{6}$/.test(value)) {
      setMessage('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (mfaKind === 'verify' && value.length < 6) {
      setMessage('Enter your 6-digit code or a recovery code.');
      return;
    }
    setMessage('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/mfa/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: value }) });
      const body = await response.json() as { error?: string; recoveryCodes?: string[] };
      if (!response.ok) {
        setMessage(body.error || 'Unable to verify MFA.');
        return;
      }
      setMfaCode('');
      if (body.recoveryCodes?.length) {
        setRecoveryCodes(body.recoveryCodes);
        setCopied(false);
        setStep('recovery');
      } else {
        finishLogin();
      }
    } catch {
      setMessage('Unable to reach the authentication service.');
    } finally {
      setLoading(false);
    }
  }

  function backToLogin() {
    setStep('login');
    setMessage('');
    setMfaCode('');
    setManualKey('');
    setQrDataUrl('');
    setRecoveryCodes([]);
  }

  async function copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
      setMessage('Recovery codes copied. Store them somewhere safe.');
    } catch {
      setMessage('Copy failed. Select the codes and save them manually.');
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.visualPanel} aria-label="iPayTech POS operations">
        <div className={styles.visualGlow} aria-hidden="true" />
        <div className={styles.visualGrid} aria-hidden="true" />
        <div className={styles.visualContent}>
          <Link href="/" className={styles.brand} aria-label="iPayTech Ops home">
            <Image className={styles.brandLogo} src="/iPaytechLogo.jpg" alt="iPayTech" width={180} height={76} priority />
          </Link>
        </div>
        <div className={styles.posStage}>
          <Image
            className={styles.posImage}
            src="/pos-login-hero.webp"
            alt="Zimbabwean iPayTech support specialist holding a point-of-sale terminal"
            width={1024}
            height={1536}
            priority
          />
        </div>
      </section>
      <section className={styles.formPanel}>
        <div className={styles.formWrap}>
          <div className={styles.mobileBrand}>
            <Link href="/" className={styles.brand} aria-label="iPayTech Ops home">
              <Image className={styles.brandLogo} src="/iPaytechLogo.jpg" alt="iPayTech" width={180} height={76} priority />
            </Link>
          </div>

          {step === 'login' && <>
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
                  <input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </div>
              </div>

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label htmlFor="password">Password</label>
                  <Link href="/forgot-password" className={styles.forgotLink}>Forgot password?</Link>
                </div>
                <div className={styles.inputShell}>
                  <LockKeyhole size={17} aria-hidden="true" />
                  <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
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
          </>}

          {step === 'mfa' && <div className={styles.mfaPanel} aria-labelledby="mfa-heading">
            <div className={styles.formIntro}>
              <span className={styles.eyebrow}><ShieldCheck size={14} /> Multi-factor verification</span>
              <h2 id="mfa-heading">{mfaKind === 'enroll' ? 'Set up your authenticator' : 'Verify your identity'}</h2>
              <p>{mfaKind === 'enroll' ? 'Scan this QR code with an authenticator app, then enter the 6-digit code it generates.' : 'Enter the 6-digit code from your authenticator app, or use one of your recovery codes.'}</p>
            </div>

            {mfaKind === 'enroll' && <div className={styles.enrollmentCard}>
              {qrDataUrl && <img className={styles.qrCode} src={qrDataUrl} alt="Authenticator setup QR code" />}
              <div className={styles.manualKey}><span>Manual setup key</span><code>{manualKey || 'Loading…'}</code></div>
            </div>}

            <form className={styles.form} onSubmit={handleMfaSubmit} noValidate>
              <div className={styles.field}>
                <label htmlFor="mfa-code">{mfaKind === 'enroll' ? 'Authenticator code' : 'Authenticator or recovery code'}</label>
                <div className={styles.inputShell}>
                  <ShieldCheck size={17} aria-hidden="true" />
                  <input id="mfa-code" name="mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder={mfaKind === 'enroll' ? '000000' : '000000 or recovery code'} required />
                </div>
              </div>
              {message && <p className={styles.formMessage} role="alert">{message}</p>}
              <button type="submit" className={styles.submitButton} disabled={loading}>{loading ? 'Verifying…' : 'Verify and continue'} {!loading && <ArrowRight size={17} />}</button>
              <button type="button" className={styles.backButton} onClick={backToLogin}>Back to sign in</button>
            </form>
          </div>}

          {step === 'recovery' && <div className={styles.mfaPanel} aria-labelledby="recovery-heading">
            <div className={styles.formIntro}>
              <span className={styles.eyebrow}><ShieldCheck size={14} /> Save these recovery codes</span>
              <h2 id="recovery-heading">MFA is enabled</h2>
              <p>These codes are shown once. Save or print them now; each code can be used once if you lose access to your authenticator.</p>
            </div>
            <div className={styles.recoveryCodes} aria-label="Recovery codes">
              {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
            {message && <p className={styles.formMessage} role="status">{message}</p>}
            <div className={styles.recoveryActions}>
              <button type="button" className={styles.secondaryButton} onClick={copyRecoveryCodes}>{copied ? 'Copied' : 'Copy codes'}</button>
              <button type="button" className={styles.submitButton} onClick={finishLogin}>Continue to workspace <ArrowRight size={17} /></button>
            </div>
            <p className={styles.warning}>Do not share these codes. iPayTech Operations cannot display them again.</p>
          </div>}

          <div className={styles.securityNote}><ShieldCheck size={16} /><span>Your access is protected with encrypted credentials and workspace-level permissions.</span></div>
          <p className={styles.support}>Need help accessing your workspace? <button type="button" onClick={() => setMessage('Contact your workspace administrator for access support.')}>Contact your administrator</button> <HelpCircle size={14} /></p>
        </div>
      </section>
    </main>
  );
}
