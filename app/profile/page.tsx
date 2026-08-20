'use client';

import Link from 'next/link';
import Image from 'next/image';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, LogOut, Save, Shield } from 'lucide-react';
import styles from './page.module.css';

type User = { id: string; organizationId: string; email: string; fullName: string; role: string };

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState({ fullName: '', email: '' });
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/profile', { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) {
        window.location.href = '/login';
        return;
      }
      setUser(data.user);
      setProfile({ fullName: data.user.fullName, email: data.user.email });
    }).catch(() => {
      setError('Unable to load your profile.');
    }).finally(() => setLoading(false));
  }, []);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || 'Unable to save profile.'); return; }
      setUser(data.user); setProfile({ fullName: data.user.fullName, email: data.user.email }); setMessage('Profile saved.');
    } catch { setError('Unable to reach the profile service.'); } finally { setSaving(false); }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/profile/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(password) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || 'Unable to change password.'); return; }
      setPassword({ currentPassword: '', newPassword: '' }); setMessage(data.message || 'Password updated.');
    } catch { setError('Unable to reach the password service.'); } finally { setPasswordSaving(false); }
  };

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { window.location.href = '/login'; }
  };

  return <div className={styles.shell}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><Image className={styles.brandLogo} src="/iPaytechLogo.jpg" alt="iPayTech" width={170} height={71} priority /></Link>
      <div className={styles.headerActions}><Link href="/" className={styles.back}><ArrowLeft size={14}/> Dashboard</Link><button className={styles.headerLogout} onClick={() => void logout()}><LogOut size={14}/> Sign out</button></div>
    </header>
    <main className={styles.main}>
      <div className={styles.title}><span className={styles.eyebrow}>Account settings</span><h1>Your profile</h1><p>Manage your workspace identity and account security.</p></div>
      <p className={styles.status} aria-live="polite">{message || error ? <span className={error ? styles.error : styles.message}>{error || message}</span> : null}</p>
      {loading ? <section className={styles.card}><p>Loading profile…</p></section> : <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Personal details</h2><p>These details appear in workspace activity and approvals.</p>
          <form className={styles.form} onSubmit={saveProfile}>
            <label className={styles.field}>Full name<input required minLength={2} maxLength={120} value={profile.fullName} onChange={event => setProfile({ ...profile, fullName: event.target.value })}/></label>
            <label className={styles.field}>Email address<input required type="email" value={profile.email} onChange={event => setProfile({ ...profile, email: event.target.value })}/></label>
            <label className={styles.field}>Role<input value={user?.role || ''} disabled/></label>
            <div className={styles.actions}><button className={styles.primary} disabled={saving}><Save size={14}/> {saving ? 'Saving…' : 'Save profile'}</button></div>
          </form>
          <div className={styles.meta}><div className={styles.metaRow}><span>Initials</span><span>{initials(user?.fullName || profile.fullName)}</span></div><div className={styles.metaRow}><span>Workspace</span><span>Harare HQ</span></div></div>
        </section>
        <section className={styles.card}>
          <h2>Change password</h2><p>Changing your password signs out other active sessions.</p>
          <form className={styles.form} onSubmit={changePassword}>
            <label className={styles.field}>Current password<input required type="password" minLength={8} maxLength={128} value={password.currentPassword} onChange={event => setPassword({ ...password, currentPassword: event.target.value })}/></label>
            <label className={styles.field}>New password<input required type="password" minLength={8} maxLength={128} value={password.newPassword} onChange={event => setPassword({ ...password, newPassword: event.target.value })}/></label>
            <p className={styles.note}>Use at least 8 characters. Choose a password you do not use elsewhere.</p>
            <div className={styles.actions}><button className={styles.primary} disabled={passwordSaving}><Shield size={14}/> {passwordSaving ? 'Updating…' : 'Update password'}</button></div>
          </form>
          <div className={styles.actions}><button className={styles.danger} onClick={() => void logout()}><LogOut size={14}/> Sign out</button></div>
        </section>
      </div>}
    </main>
  </div>;
}
