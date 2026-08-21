'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useParams } from 'next/navigation';
import styles from '../../login/login.module.css';

type Invitation = { fullName: string; email: string; role: string; organizationName: string; expiresAt: string };

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = String(params.token || '');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    void fetch(`/api/auth/invitations/${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'This invitation is unavailable.');
      setInvitation(data.invitation);
    }).catch(loadError => setError(loadError instanceof Error ? loadError.message : 'This invitation is unavailable.')).finally(() => setLoading(false));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setSaving(true);
    try {
      const response = await fetch(`/api/auth/invitations/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to activate account.');
      window.location.href = '/';
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to activate account.');
    } finally { setSaving(false); }
  };

  return <main className={styles.page}><section className={styles.card} aria-labelledby="invite-title"><div className={styles.brand}><img src="/iPaytechLogo.jpg" alt="iPayTech"/><span>SECURE ACCOUNT INVITATION</span></div>{loading ? <div className={styles.form}><LoaderCircle className={styles.spinner} size={22}/><p>Checking invitation…</p></div> : error ? <div className={styles.form}><div className={styles.error}>{error}</div><a className={styles.submit} href="/login">Return to sign in</a></div> : invitation ? <><div className={styles.heading}><p className={styles.eyebrow}>Welcome to {invitation.organizationName}</p><h1 id="invite-title">Activate your workspace account</h1><p>You were invited as <strong>{invitation.role.replaceAll('_', ' ')}</strong>. Set a password to finish joining the operations workspace.</p></div><form className={styles.form} onSubmit={submit}><div className={styles.inviteSummary}><ShieldCheck size={18}/><div><strong>{invitation.fullName}</strong><span>{invitation.email}</span><small>Invitation expires {new Date(invitation.expiresAt).toLocaleString('en-GB')}</small></div></div><label><span>Password</span><div className={styles.passwordField}><KeyRound size={16}/><input required minLength={12} maxLength={128} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters"/><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label><label><span>Confirm password</span><input required minLength={12} maxLength={128} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="Enter the password again"/></label>{error && <div className={styles.error} role="alert">{error}</div>}<button className={styles.submit} disabled={saving}>{saving ? 'Activating account…' : 'Activate account'}</button><p className={styles.note}>Your invitation can only be used once. You will be signed in automatically after activation.</p></form></> : null}</section></main>;
}
