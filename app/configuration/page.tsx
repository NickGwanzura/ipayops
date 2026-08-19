'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, MapPin, Plus, Save, Settings2, Users, Zap } from 'lucide-react';
import styles from './page.module.css';

type Location = { id: string; code: string; name: string; address: string | null; is_active: boolean };
type Role = { role: string; count: number };
type Configuration = { organization: { id: string; name: string; slug: string }; settings: { timezone: string; currency: string; date_format: string }; locations: Location[]; roles: Role[] };

const empty: Configuration = { organization: { id: '', name: '', slug: '' }, settings: { timezone: 'Africa/Harare', currency: 'USD', date_format: 'DD/MM/YYYY' }, locations: [], roles: [] };

export default function ConfigurationPage() {
  const [configuration, setConfiguration] = useState<Configuration>(empty);
  const [form, setForm] = useState({ organizationName: '', timezone: 'Africa/Harare', currency: 'USD', dateFormat: 'DD/MM/YYYY' });
  const [location, setLocation] = useState({ code: '', name: '', address: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const response = await fetch('/api/configuration', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load configuration.');
    setConfiguration(data);
    setForm({ organizationName: data.organization.name, timezone: data.settings.timezone, currency: data.settings.currency, dateFormat: data.settings.date_format });
  };

  useEffect(() => { void load().catch(loadError => setError(loadError instanceof Error ? loadError.message : 'Unable to load configuration.')).finally(() => setLoading(false)); }, []);

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/configuration', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save configuration.');
      setMessage('Configuration saved.'); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save configuration.'); } finally { setSaving(false); }
  };

  const addLocation = async (event: FormEvent) => {
    event.preventDefault(); setAdding(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/configuration/locations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(location) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to add location.');
      setLocation({ code: '', name: '', address: '' }); setMessage('Location added.'); await load();
    } catch (locationError) { setError(locationError instanceof Error ? locationError.message : 'Unable to add location.'); } finally { setAdding(false); }
  };

  const toggleLocation = async (item: Location) => {
    setMessage(''); setError('');
    try {
      const response = await fetch(`/api/configuration/locations/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: item.name, address: item.address || '', isActive: !item.is_active }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update location.');
      setMessage(`${item.name} is now ${!item.is_active ? 'active' : 'inactive'}.`); await load();
    } catch (toggleError) { setError(toggleError instanceof Error ? toggleError.message : 'Unable to update location.'); }
  };

  return <div className={styles.shell}>
    <header className={styles.header}><Link href="/" className={styles.brand}><span className={styles.mark}><Zap size={17} fill="currentColor"/></span><span><strong>iPayTech</strong><small>OPS CONSOLE</small></span></Link><div className={styles.links}><Link href="/profile" className={styles.link}>Profile</Link><Link href="/" className={styles.link}><ArrowLeft size={14}/> Dashboard</Link></div></header>
    <main className={styles.main}><div className={styles.title}><span className={styles.eyebrow}>Workspace administration</span><h1>Configuration</h1><p>Manage organization defaults, operating locations, and access visibility.</p></div><p className={styles.status} aria-live="polite">{error || message ? <span className={error ? styles.error : styles.message}>{error || message}</span> : null}</p>
      {loading ? <section className={styles.card}><p>Loading configuration…</p></section> : <div className={styles.grid}>
        <section className={styles.card}><h2>Organization defaults</h2><p>These settings are used by reports, documents, and operational records.</p><form className={styles.form} onSubmit={saveSettings}><label className={styles.field}>Organization name<input required value={form.organizationName} onChange={event => setForm({ ...form, organizationName: event.target.value })}/></label><div className={styles.row}><label className={styles.field}>Timezone<select value={form.timezone} onChange={event => setForm({ ...form, timezone: event.target.value })}><option>Africa/Harare</option><option>Africa/Johannesburg</option><option>Europe/London</option><option>UTC</option></select></label><label className={styles.field}>Currency<select value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}><option>USD</option><option>ZAR</option><option>GBP</option><option>EUR</option><option>BWP</option><option>ZWL</option></select></label></div><label className={styles.field}>Date format<select value={form.dateFormat} onChange={event => setForm({ ...form, dateFormat: event.target.value })}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></label><div className={styles.actions}><button className={styles.primary} disabled={saving}><Save size={14}/> {saving ? 'Saving…' : 'Save defaults'}</button></div></form><p className={styles.note}>Organization identity and settings are restricted to leadership roles.</p></section>
        <section className={styles.card}><h2>Access visibility</h2><p>Current users grouped by assigned role.</p><div className={styles.roles}>{configuration.roles.length ? configuration.roles.map(item => <div className={styles.role} key={item.role}><span className={styles.roleIcon}><Users size={14}/></span><strong>{item.role}</strong><span>{item.count} user{item.count === 1 ? '' : 's'}</span></div>) : <p>No users found.</p>}</div><p className={styles.note}>Role assignment and user lifecycle controls remain in the Finance & HR workspace.</p></section>
        <section className={styles.card}><h2>Operating locations</h2><p>Locations available for stock transfers and receiving.</p><div className={styles.list}>{configuration.locations.map(item => <div className={styles.location} key={item.id}><span className={styles.locationIcon}><MapPin size={14}/></span><div className={styles.locationCopy}><strong>{item.name}</strong><span>{item.address || 'No address recorded'}</span></div><span className={styles.code}>{item.code}</span><button className={`${styles.toggle} ${item.is_active ? styles.active : ''}`} onClick={() => void toggleLocation(item)}>{item.is_active ? 'Active' : 'Inactive'}</button></div>)}{!configuration.locations.length && <p>No locations configured yet.</p>}</div><form className={styles.form} onSubmit={addLocation}><div className={styles.row}><label className={styles.field}>Code<input required value={location.code} onChange={event => setLocation({ ...location, code: event.target.value })} placeholder="HQ"/></label><label className={styles.field}>Name<input required value={location.name} onChange={event => setLocation({ ...location, name: event.target.value })} placeholder="Harare HQ"/></label></div><label className={styles.field}>Address<input value={location.address} onChange={event => setLocation({ ...location, address: event.target.value })}/></label><div className={styles.actions}><button className={styles.secondary} disabled={adding}><Plus size={14}/> {adding ? 'Adding…' : 'Add location'}</button></div></form></section>
        <section className={styles.card}><h2>Configuration scope</h2><p>What this area controls.</p><div className={styles.roles}><div className={styles.role}><span className={styles.roleIcon}><Settings2 size={14}/></span><strong>Organization defaults</strong><span>Reports & documents</span></div><div className={styles.role}><span className={styles.roleIcon}><MapPin size={14}/></span><strong>Locations</strong><span>Transfers & receiving</span></div><div className={styles.role}><span className={styles.roleIcon}><Users size={14}/></span><strong>Access visibility</strong><span>Role overview</span></div></div></section>
      </div>}
    </main>
  </div>;
}
