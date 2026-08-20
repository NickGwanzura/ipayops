'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Boxes, BriefcaseBusiness, Check, ClipboardCheck, FileText, LogOut, Plus, Search, Settings2, ShieldCheck, ScrollText, ShoppingCart, Upload, UserRound, Users, X } from 'lucide-react';
import { moduleMeta, type OpsModule } from '@/lib/ops-data';
import ProcurementWorkflows from './procurement-workflows';
import InventoryWorkspace from './inventory-workspace';
import CrmWorkspace from './crm-workspace';
import FinanceWorkspace from './finance-workspace';
import ReportsWorkspace from './reports-workspace';
import { JobsWorkspace, WarrantyWorkspace } from './service-workspace';
import AuditLogsWorkspace from './audit-logs-workspace';
import { useOrganizationSettings } from '../organization-settings';
import { useDialogFocus } from '../dialog-focus';
import { ALL_OPS_MODULES, canAccessConfiguration, canAccessModule } from '@/lib/rbac';
import './ops.css';

const modules: OpsModule[] = [...ALL_OPS_MODULES, 'Audit Logs'];
type User = { fullName: string; role: string };

export default function OperationsPage() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const requested = params?.get('module') as OpsModule | null;
  const [module, setModule] = useState<OpsModule>(requested && modules.includes(requested) ? requested : 'Inventory');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [newRecordSignal, setNewRecordSignal] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const settings = useOrganizationSettings();
  const meta = moduleMeta[module];
  const visibleModules = useMemo(() => user ? modules.filter(item => canAccessModule(user.role, item)) : [], [user]);

  useEffect(() => {
    void fetch('/api/auth/me', { cache: 'no-store' }).then(async response => {
      if (!response.ok) { window.location.href = '/login'; return; }
      const data = await response.json();
      setUser(data.user);
    }).catch(() => { window.location.href = '/login'; });
  }, []);

  useEffect(() => {
    if (!user || canAccessModule(user.role, module)) return;
    const fallback = visibleModules[0] || 'Reports';
    setModule(fallback);
    window.history.replaceState(null, '', `/operations?module=${encodeURIComponent(fallback)}`);
  }, [user, module, visibleModules]);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2500); };
  const goToProfile = () => { window.location.href = '/profile'; };
  const logout = async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { window.location.href = '/login'; } };
  const goToConfiguration = () => { window.location.href = '/configuration'; };
  const setModuleAndReset = (next: OpsModule) => { setModule(next); setQuery(''); setNewRecordSignal(0); window.history.replaceState(null, '', `/operations?module=${encodeURIComponent(next)}`); };
  const newRecordTarget = module === 'Reports' ? 'Sales & CRM' : module;
  const handleNewRecord = () => { if (!user || !canAccessModule(user.role, newRecordTarget)) return; if (newRecordTarget !== module) setModuleAndReset(newRecordTarget); setNewRecordSignal(signal => signal + 1); };
  const searchableQuery = useMemo(() => query.trim(), [query]);
  const canImport = module === 'Procurement' || module === 'Sales & CRM';
  const canCreateRecord = Boolean(user && ((module !== 'Reports' && canAccessModule(user.role, newRecordTarget)) || (module === 'Reports' && canAccessModule(user.role, 'Sales & CRM'))));

  if (!user) return <div className="ops-shell"><main className="ops-main"><div className="ops-content"><section className="ops-panel role-loading"><p>Loading your workspace…</p></section></div></main></div>;

  return <div className="ops-shell">
    <aside className="ops-rail"><Link className="ops-brand" href="/"><Image className="ops-logo" src="/iPaytechLogo.jpg" alt="iPayTech" width={160} height={67} priority /></Link><div className="ops-rail-title">OPERATIONS</div>{visibleModules.map(item => <button key={item} className={module === item ? 'ops-nav active' : 'ops-nav'} onClick={() => setModuleAndReset(item)}>{iconFor(item)}<span>{item}</span></button>)}<div className="ops-rail-bottom">{user && canAccessConfiguration(user.role) && <button className="ops-nav" onClick={goToConfiguration}><Settings2 size={16}/><span>Configuration</span></button>}<button className="ops-nav" onClick={goToProfile}><UserRound size={16}/><span>Profile</span></button><button className="ops-nav" onClick={() => void logout}><LogOut size={16}/><span>Sign out</span></button><Link className="back-dashboard" href="/"><ArrowLeft size={15}/> Dashboard</Link></div></aside>
    <main className="ops-main"><header className="ops-top"><div className="ops-breadcrumb"><Link href="/">Overview</Link><span>/</span><strong>{meta.title}</strong></div><div className="ops-top-actions"><div className="ops-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this module..."/><kbd>⌘ K</kbd></div><button className="ops-avatar" onClick={goToProfile} title="Open profile" aria-label="Open profile">{initials(user.fullName)}</button></div></header><div className="ops-content"><div className="ops-heading"><div><span className="ops-kicker">Operations workspace</span><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="ops-heading-actions">{canImport && <button className="ops-btn ghost" onClick={() => setImportOpen(true)}><Upload size={15}/> Import</button>}{canCreateRecord && <button className="ops-btn blue" onClick={handleNewRecord}><Plus size={16}/> {module === 'Finance & HR' && user.role === 'finance' ? 'Submit expense' : module === 'Finance & HR' ? 'Add consultant' : 'New record'}</button>}</div></div>
      {module === 'Procurement' && <ProcurementWorkflows notify={notify} newRecordSignal={newRecordSignal} query={searchableQuery}/>} {module === 'Inventory' && <InventoryWorkspace query={searchableQuery} notify={notify} newRecordSignal={newRecordSignal}/>} {module === 'Sales & CRM' && <CrmWorkspace notify={notify} newRecordSignal={newRecordSignal} role={user?.role || 'sales_consultant'}/>} {module === 'Job cards' && <JobsWorkspace notify={notify} newRecordSignal={newRecordSignal} role={user?.role || 'sales_consultant'}/>} {module === 'Warranty' && <WarrantyWorkspace notify={notify} newRecordSignal={newRecordSignal}/>} {module === 'Finance & HR' && <FinanceWorkspace notify={notify} newRecordSignal={newRecordSignal} role={user?.role || 'finance'}/>} {module === 'Reports' && <ReportsWorkspace notify={notify}/>} {module === 'Audit Logs' && <AuditLogsWorkspace query={searchableQuery}/>}<div className="ops-footer"><span><span className="status-dot"/> Database-sourced view · Last synced just now</span><span>Timezone: {settings.timezone} · Currency: {settings.currency}</span></div></div></main>
    {importOpen && <ImportDialog module={module} close={() => setImportOpen(false)} imported={count => { setImportOpen(false); notify(`${count} record${count === 1 ? '' : 's'} imported`); window.setTimeout(() => window.location.reload(), 350); }} />}{toast && <div className="ops-toast"><span><Check size={13}/></span>{toast}</div>}
  </div>;
}

function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U'; }
function iconFor(item: OpsModule) { const props = { size: 16 }; if (item === 'Procurement') return <ShoppingCart {...props}/>; if (item === 'Inventory') return <Boxes {...props}/>; if (item === 'Sales & CRM') return <BriefcaseBusiness {...props}/>; if (item === 'Job cards') return <ClipboardCheck {...props}/>; if (item === 'Warranty') return <ShieldCheck {...props}/>; if (item === 'Finance & HR') return <Users {...props}/>; if (item === 'Audit Logs') return <ScrollText {...props}/>; return <FileText {...props}/>; }

type ImportTarget = 'suppliers' | 'clients' | 'leads';
function ImportDialog({ module, close, imported }: { module: OpsModule; close: () => void; imported: (count: number) => void }) {
  const targets: ImportTarget[] = module === 'Procurement' ? ['suppliers'] : module === 'Sales & CRM' ? ['clients', 'leads'] : [];
  const [target, setTarget] = useState<ImportTarget>(targets[0] || 'suppliers');
  const [file, setFile] = useState<File | null>(null); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const dialogRef = useDialogFocus<HTMLDivElement>(close);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!targets.length) { setError('CSV import is currently available for suppliers, clients, and leads.'); return; }
    if (!file) { setError('Choose a CSV file first.'); return; }
    setSaving(true); setError('');
    try {
      const rows = parseCsv(await file.text()); if (!rows.length) throw new Error('The CSV has no data rows.'); let count = 0;
      for (const row of rows) {
        const body = target === 'suppliers' ? { name: value(row, 'name'), contactName: value(row, 'contact_name', 'contactName'), phone: value(row, 'phone'), paymentTerms: value(row, 'payment_terms', 'paymentTerms'), leadTimeDays: Number(value(row, 'lead_time_days', 'leadTimeDays') || 0) } : target === 'clients' ? { name: value(row, 'name'), contactName: value(row, 'contact_name', 'contactName'), phone: value(row, 'phone'), email: value(row, 'email'), clientType: value(row, 'client_type', 'clientType') || 'Organisation' } : { name: value(row, 'name'), clientId: value(row, 'client_id', 'clientId') || undefined, source: value(row, 'source') || 'Import', notes: value(row, 'notes') };
        if (!body.name) throw new Error(`Row ${count + 2} is missing a name.`);
        const endpoint = target === 'suppliers' ? '/api/suppliers' : target === 'clients' ? '/api/crm/clients' : '/api/crm/leads'; const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || `Unable to import row ${count + 2}.`); count += 1;
      }
      imported(count);
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Unable to import CSV.'); } finally { setSaving(false); }
  };
  return <div className="workflow-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={dialogRef} className="workflow-dialog" role="dialog" aria-modal="true" aria-label="Import CSV" tabIndex={-1}><div className="workflow-dialog-head"><h3>Import CSV records</h3><button onClick={close} aria-label="Close"><X size={16}/></button></div><form className="workflow-form" onSubmit={submit}><p className="workflow-help">Use a header row. Supported fields include name, contact_name, phone, email, source, notes, payment_terms, and lead_time_days.</p>{targets.length > 0 ? <label className="workflow-field"><span>Record type</span><select value={target} onChange={event => setTarget(event.target.value as ImportTarget)}>{targets.map(item => <option key={item} value={item}>{item}</option>)}</select></label> : <p className="workflow-help">This module has no CSV importer yet.</p>}<label className="workflow-field"><span>CSV file</span><input required type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0] || null)}/></label>{error && <p className="workflow-error" role="alert">{error}</p>}<div className="workflow-dialog-actions"><button type="button" className="ops-btn ghost" onClick={close}>Cancel</button><button className="ops-btn blue" disabled={saving}>{saving ? 'Importing…' : 'Import records'}</button></div></form></div></div>;
}

function parseCsv(text: string) { const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean); if (lines.length < 2) return []; const headers = splitCsvLine(lines[0]).map(header => header.trim().toLowerCase()); return lines.slice(1).map(line => Object.fromEntries(splitCsvLine(line).map((cell, index) => [headers[index] || `column_${index}`, cell.trim()]))); }
function splitCsvLine(line: string) { const cells: string[] = []; let cell = ''; let quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"' && line[index + 1] === '"' && quoted) { cell += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += char; } cells.push(cell); return cells; }
function value(row: Record<string, string>, ...keys: string[]) { return keys.map(key => row[key]).find(Boolean) || ''; }
