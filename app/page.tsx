'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Boxes, BriefcaseBusiness, ChevronDown, CircleDollarSign, ClipboardCheck, DatabaseBackup, FileText, Grid2X2, Laptop, LayoutDashboard, LockKeyhole, LogOut, Menu, PackageCheck, Plus, RefreshCw, ScrollText, Search, Settings, ShieldCheck, ShoppingCart, Truck, UserRound, Users, X, Zap } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency, formatOrganizationDate, useOrganizationSettings } from './organization-settings';
import RoleDashboard from './role-dashboard';
import { DashboardQuickActions } from './dashboard-guidance';
import { canAccessConfiguration, canAccessModule, isLeadershipRole, modulesForRole, roleLabel } from '@/lib/rbac';
import type { OpsModule } from '@/lib/ops-data';

const moduleNav: Array<{ label: OpsModule; icon: React.ElementType }> = [
  { label:'Sales & CRM', icon:BriefcaseBusiness }, { label:'Products', icon:Boxes }, { label:'Inventory', icon:Boxes }, { label:'Procurement', icon:ShoppingCart }, { label:'Job cards', icon:ClipboardCheck }, { label:'Warranty', icon:ShieldCheck }, { label:'Finance & HR', icon:Users }, { label:'People & HR', icon:Users }, { label:'Reports', icon:FileText }, { label:'Audit Logs', icon:ScrollText },
];
type User = { fullName: string; role: string };
type DashboardData = {
  summary: { revenue: string | number; confirmed_sales: number; units_in_stock: number; open_jobs: number };
  performance: { day: string; sales: string | number; stock: number }[];
  activity: { event: string; detail: string; status: string; occurred_at: string }[];
  stockByCategory: { name: string; value: number }[];
  approvals: { purchase_orders: number; expenses: number; warranty_exceptions: number; stock_adjustments: number; total: number };
};

const emptyDashboard: DashboardData = { summary: { revenue: 0, confirmed_sales: 0, units_in_stock: 0, open_jobs: 0 }, performance: [], activity: [], stockByCategory: [], approvals: { purchase_orders: 0, expenses: 0, warranty_exceptions: 0, stock_adjustments: 0, total: 0 } };

function formatWhen(value: string, settings: Parameters<typeof formatOrganizationDate>[1]) {
  const timestamp = new Date(value).getTime();
  const hours = Math.floor((Date.now() - timestamp) / 3600000);
  if (hours <= 0) return 'now';
  if (hours < 24) return `${hours}h ago`;
  return formatOrganizationDate(value, settings);
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';
}

function StatCard({ label, value, change, note, icon:Icon, tone='blue' }: {label:string;value:string;change:string;note:string;icon:React.ElementType;tone?:string}) {
  return <div className="stat-card"><div className="stat-top"><span className={`icon-box ${tone}`}><Icon size={17}/></span>{change && <span className={change.startsWith('-') ? 'change down' : 'change'}>{change === 'Live' ? 'Live' : <>{change.startsWith('-') ? <ArrowDownRight size={13}/> : <ArrowUpRight size={13}/>} {change.replace('-','')}</>}</span>}</div><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className="stat-note">{note}</div></div>
}

export default function Home() {
  const [active, setActive] = useState('Overview'); const [dark, setDark] = useState(false); const [menu, setMenu] = useState(false); const [query, setQuery] = useState(''); const [toast, setToast] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const searchRef = useRef<HTMLInputElement>(null);
  const settings = useOrganizationSettings();
  const visibleNav = useMemo(() => user ? moduleNav.filter(item => modulesForRole(user.role).includes(item.label)) : [], [user]);
  const filtered = useMemo(() => dashboard.activity.filter(a => `${a.event} ${a.detail} ${a.status}`.toLowerCase().includes(query.toLowerCase())), [dashboard.activity, query]);
  const notify = (message:string) => { setToast(message); setTimeout(() => setToast(''), 2800); };
  useEffect(() => { void fetch('/api/auth/me', { cache: 'no-store' }).then(async response => { if (!response.ok) { window.location.href = '/login'; return; } const data = await response.json(); setUser(data.user); }).catch(() => { window.location.href = '/login'; }); }, []);
  useEffect(() => { if (!user || !isLeadershipRole(user.role)) return; void fetch('/api/dashboard/summary', { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Live dashboard data is unavailable.'); setDashboard(data); }).catch(error => notify(error instanceof Error ? error.message : 'Live dashboard data is unavailable.')); }, [user]);
  useEffect(() => { const handleShortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); } }; window.addEventListener('keydown', handleShortcut); return () => window.removeEventListener('keydown', handleShortcut); }, []);
  const logout = async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { window.location.href = '/login'; } };
  const goToModule = (label:string) => { if (label !== 'Overview' && user && !canAccessModule(user.role, label as OpsModule)) return; if (label !== 'Overview') { window.location.href = `/operations?module=${encodeURIComponent(label)}`; return; } setActive(label); };
  const goToProfile = () => { window.location.href = '/profile'; };
  const goToConfiguration = () => { window.location.href = '/configuration'; };
  const displayName = user?.fullName || 'Loading workspace';
  const displayRole = user ? roleLabel(user.role) : 'Authenticated user';
  const workspaceName = settings.organizationName || 'Workspace';
  const canSell = Boolean(user && canAccessModule(user.role, 'Sales & CRM'));
  const approvalTarget = user && canAccessModule(user.role, 'Finance & HR') ? 'Finance & HR' : 'Reports';
  return <div className={dark ? 'shell dark' : 'shell'}>
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><Image className="brand-logo" src="/iPaytechLogo.jpg" alt="iPayTech" width={150} height={63} priority/><button className="mobile-close" aria-label="Close navigation" onClick={()=>setMenu(false)}><X size={19}/></button></div>
      <div className="workspace-label">WORKSPACE</div><div className="workspace"><div className="workspace-dot">{initials(workspaceName)}</div><div><strong>{workspaceName}</strong><span>{settings.address || 'All operations'}</span></div><ChevronDown size={15}/></div>
      <nav>{visibleNav.map(({label,icon:Icon}) => <button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>{goToModule(label);setMenu(false);}}><Icon size={17}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-spacer"/><div className="sidebar-section sidebar-utility"><button className={active==='Overview'?'nav-item active sidebar-dashboard':'nav-item sidebar-dashboard'} onClick={()=>{goToModule('Overview');setMenu(false);}}><LayoutDashboard size={17}/><span>Dashboard</span></button>{user && canAccessConfiguration(user.role) && <button className="nav-item" onClick={goToConfiguration}><Settings size={17}/><span>Configuration</span></button>}<button className="nav-item" onClick={goToProfile}><UserRound size={17}/><span>Profile</span></button><button className="nav-item sidebar-signout" onClick={()=>void logout()}><LogOut size={17}/><span>Sign out</span></button></div>
      <div className="user-card"><button className="user-card-main" onClick={goToProfile} title="Open profile"><div className="avatar">{initials(displayName)}</div><div><strong>{displayName}</strong><span>{displayRole}</span></div></button></div>
    </aside>
    <main className="main"><header className="topbar"><button className="mobile-menu" onClick={()=>setMenu(true)} aria-label="Open navigation"><Menu size={21}/></button><div className="crumb"><span>Operations</span><span>/</span><strong>{active}</strong></div><div className="top-actions"><div className="search"><Search size={16}/><input ref={searchRef} aria-label="Search dashboard activity" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search anything..."/><kbd>{typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</kbd></div><button className="icon-btn" aria-label="Toggle theme" onClick={()=>setDark(!dark)}>{dark ? <Zap size={18}/> : <Grid2X2 size={18}/>}</button><button className="icon-btn notification" aria-label="Open approvals" onClick={()=>goToModule(approvalTarget)}><Bell size={18}/><i/></button><button className="top-avatar" onClick={goToProfile} aria-label="Open profile">{initials(displayName)}</button></div></header>
      {menu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={()=>setMenu(false)}/>}<div className="content">{user && !isLeadershipRole(user.role) ? <RoleDashboard role={user.role} settings={settings} query={query} onNavigate={module => goToModule(module)}/> : <><div className="page-heading"><div><div className="eyebrow"><span className="live-dot"/> Live operations</div><h1>Good morning, {displayName.split(' ')[0]}</h1><p>Here’s what’s happening across {workspaceName} today.</p></div><div className="heading-actions"><button className="btn secondary" onClick={()=>goToModule('Reports')}><FileText size={16}/> Open reports</button>{canSell && <button className="btn primary" onClick={()=>goToModule('Sales & CRM')}><Plus size={17}/> New transaction</button>}</div></div>
        <DashboardQuickActions role={user?.role || 'ceo'} onNavigate={goToModule}/><div className="stats-grid"><StatCard label="Revenue this month" value={formatCurrency(dashboard.summary.revenue, settings.currency, 0)} change="Live" note="Confirmed sales · current month" icon={CircleDollarSign}/><StatCard label="Confirmed sales" value={String(dashboard.summary.confirmed_sales)} change="Live" note="Database-backed transactions" icon={Activity} tone="green"/><StatCard label="Units in stock" value={String(dashboard.summary.units_in_stock)} change="Live" note="Available and reserved inventory" icon={Boxes} tone="amber"/><StatCard label="Open job cards" value={String(dashboard.summary.open_jobs)} change="Live" note="Scheduled and in progress" icon={ClipboardCheck} tone="purple"/></div><CeoProfitabilityOversight settings={settings}/>
        <div className="grid-main"><section className="panel performance"><div className="panel-header"><div><h2>Performance overview</h2><p>Live revenue and stock receipts over the last 30 days</p></div><button className="select" onClick={()=>goToModule('Reports')}>Open reports <ChevronDown size={14}/></button></div>{dashboard.performance.length ? <><div className="legend"><span><i className="legend-blue"/>Revenue</span><span><i className="legend-slate"/>Stock receipts</span></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dashboard.performance}><defs><linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f7cf6" stopOpacity={.22}/><stop offset="100%" stopColor="#2f7cf6" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5"/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#8a97aa'}}/><YAxis axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#8a97aa'}}/><Tooltip/><Area type="monotone" dataKey="sales" stroke="#2f7cf6" strokeWidth={2.5} fill="url(#blue)"/><Area type="monotone" dataKey="stock" stroke="#9aa8bd" strokeWidth={1.5} fill="transparent"/></AreaChart></ResponsiveContainer></div></> : <div className="empty"><Activity size={22}/><strong>No performance data yet</strong><span>Confirmed sales and stock receipts will appear here.</span></div>}</section><section className="panel approvals"><div className="panel-header"><div><h2>Approval inbox</h2><p>Live items requiring attention</p></div><button className="text-btn" onClick={()=>goToModule('Finance & HR')}>Open finance <ArrowUpRight size={14}/></button></div><div className="approval-total"><strong>{String(dashboard.approvals.total).padStart(2, '0')}</strong><span>pending approvals</span><div className="approval-bars"><i/><i/><i/><i/><i/><i/></div></div><div className="approval-list"><Approval icon={ShoppingCart} label="Purchase orders" count={String(dashboard.approvals.purchase_orders).padStart(2, '0')} tone="blue" onOpen={()=>goToModule('Procurement')}/><Approval icon={CircleDollarSign} label="Expenses" count={String(dashboard.approvals.expenses).padStart(2, '0')} tone="amber" onOpen={()=>goToModule('Finance & HR')}/><Approval icon={ShieldCheck} label="Warranty exceptions" count={String(dashboard.approvals.warranty_exceptions).padStart(2, '0')} tone="red" onOpen={()=>goToModule('Warranty')}/><Approval icon={PackageCheck} label="Active reservations" count={String(dashboard.approvals.stock_adjustments).padStart(2, '0')} tone="green" onOpen={()=>goToModule('Inventory')}/></div></section></div>
        <div className="grid-bottom"><section className="panel table-panel"><div className="panel-header"><div><h2>Recent activity</h2><p>Latest events from the database</p></div><button className="text-btn" onClick={()=>goToModule('Reports')}>Open reports <ArrowUpRight size={14}/></button></div><div className="activity-table"><div className="table-head"><span>EVENT</span><span>DETAIL</span><span>STATUS</span><span>WHEN</span></div>{filtered.length ? filtered.map((a,i)=><div className="table-row" key={`${a.event}-${a.occurred_at}`}><span className="event-cell"><span className={`event-icon e${i % 4}`}><Activity size={14}/></span><strong>{a.event}</strong></span><span>{a.detail}</span><span><em className={`pill p${i % 4}`}>{a.status}</em></span><span className="muted">{formatWhen(a.occurred_at, settings)}</span></div>) : <div className="empty">No matching activity found.</div>}</div></section><section className="panel stock-panel"><div className="panel-header"><div><h2>Stock by category</h2><p>Current available inventory</p></div><button className="text-btn" onClick={()=>goToModule('Inventory')}>View stock <ArrowUpRight size={14}/></button></div><div className="stock-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={dashboard.stockByCategory} layout="vertical" margin={{left:0,right:20}}><XAxis type="number" hide/><YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{fontSize:12,fill:'#68768c'}} width={58}/><Tooltip cursor={{fill:'transparent'}}/><Bar dataKey="value" fill="#2f7cf6" radius={[0,4,4,0]} barSize={14}/></BarChart></ResponsiveContainer></div><div className="stock-foot"><span><i className="dot blue"/> Available <strong>{dashboard.summary.units_in_stock}</strong></span><span><i className="dot amber"/> Reserved <strong>{dashboard.approvals.stock_adjustments}</strong></span></div></section></div><CeoPeopleOversight onOpen={()=>goToModule('Finance & HR')} /><CeoAuditOversight /><CeoNotificationOversight />
        <CeoBackupOversight /></>}</div></main>{toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
  </div>
}
function Approval({icon:Icon,label,count,tone,onOpen}:{icon:React.ElementType;label:string;count:string;tone:string;onOpen:()=>void}) { return <button className="approval-row" onClick={onOpen}><span className={`approval-icon ${tone}`}><Icon size={15}/></span><span>{label}</span><b>{count}</b><ArrowUpRight size={14}/></button> }
type CeoEmployee = { id: string; full_name: string; email: string; role: string; is_active: boolean; pending_tasks: number; completed_tasks: number; last_event?: string };
type CeoOnboardingTask = { id: string; user_name: string; title: string; status: string; due_at?: string };

function CeoPeopleOversight({ onOpen }: { onOpen: () => void }) {
  const [employees, setEmployees] = useState<CeoEmployee[]>([]); const [tasks, setTasks] = useState<CeoOnboardingTask[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => { let active = true; void Promise.all([fetch('/api/hr/employees', { cache: 'no-store' }), fetch('/api/hr/onboarding', { cache: 'no-store' })]).then(async responses => { const data = await Promise.all(responses.map(response => response.json().then(body => ({ ok: response.ok, body })))); if (data.some(item => !item.ok)) throw new Error('HR oversight is unavailable.'); if (active) { setEmployees(data[0].body.employees || []); setTasks(data[1].body.tasks || []); } }).catch(loadError => { if (active) setError(loadError instanceof Error ? loadError.message : 'HR oversight is unavailable.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const activePeople = employees.filter(employee => employee.is_active).length; const pendingTasks = tasks.filter(task => task.status === 'Pending');
  return <section className="panel people-oversight"><div className="panel-header"><div><h2><Users size={16}/> People & HR oversight</h2><p>CEO visibility into workforce status, onboarding, and lifecycle activity.</p></div><button className="text-btn" onClick={onOpen}>Open HR workspace <ArrowUpRight size={14}/></button></div>{error && <p className="workflow-error" role="alert">{error}</p>}{loading ? <div className="empty">Loading HR oversight…</div> : <div className="people-overview-grid"><div className="people-kpis"><div><strong>{activePeople}</strong><span>Active people</span></div><div><strong>{pendingTasks.length}</strong><span>Pending onboarding</span></div><div><strong>{employees.filter(employee => employee.last_event === 'Offboarding').length}</strong><span>Offboarding events</span></div></div><div className="people-list">{employees.slice(0, 5).map(employee => <div className="people-row" key={employee.id}><span className="avatar"><UserRound size={14}/></span><div><strong>{employee.full_name}</strong><span>{roleLabel(employee.role)} · {employee.is_active ? 'Active' : 'Inactive'}</span></div><small>{employee.pending_tasks} pending</small></div>)}{!employees.length && <div className="empty">No HR records found.</div>}</div></div>}</section>;
}

type ProfitabilityData = { filters: { from: string; to: string; region: string; product: string }; summary: { revenue: string | number; buying_cost: string | number; gross_profit: string | number; gross_margin: string | number; sales_count: number; units: number }; rows: Array<{ product_type: string; sku: string; description: string; revenue: string | number; buying_cost: string | number; gross_profit: string | number; units: number }> };

function CeoProfitabilityOversight({ settings }: { settings: ReturnType<typeof useOrganizationSettings> }) {
  const today = new Date().toISOString().slice(0, 10); const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ from: monthStart, to: today, region: '', product: '' }); const [data, setData] = useState<ProfitabilityData | null>(null); const [error, setError] = useState('');
  useEffect(() => { const params = new URLSearchParams(filters); void fetch(`/api/dashboard/profitability?${params.toString()}`, { cache: 'no-store' }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Profitability data is unavailable.'); setData(body); }).catch(loadError => setError(loadError instanceof Error ? loadError.message : 'Profitability data is unavailable.')); }, [filters]);
  return <section className="panel profitability-oversight"><div className="panel-header"><div><h2>CEO profitability oversight</h2><p>Gross margin from confirmed sales less serialized buying cost.</p></div><span className="workflow-help">CEO only · live sales ledger</span></div><div className="profitability-filters"><label>From<input type="date" value={filters.from} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))}/></label><label>To<input type="date" value={filters.to} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))}/></label><label>Region<input value={filters.region} onChange={event => setFilters(current => ({ ...current, region: event.target.value }))} placeholder="Harare HQ"/></label><label>Product / SKU<input value={filters.product} onChange={event => setFilters(current => ({ ...current, product: event.target.value }))} placeholder="Laptop, POS, or SKU"/></label></div>{error && <p className="workflow-error" role="alert">{error}</p>}{data && <><div className="profitability-kpis"><div><strong>{formatCurrency(data.summary.revenue, settings.currency)}</strong><span>Sales revenue</span></div><div><strong>{formatCurrency(data.summary.buying_cost, settings.currency)}</strong><span>Buying cost</span></div><div><strong>{formatCurrency(data.summary.gross_profit, settings.currency)}</strong><span>Gross profit</span></div><div><strong>{Number(data.summary.gross_margin || 0).toFixed(2)}%</strong><span>Gross margin</span></div></div><div className="data-table profitability-table"><div className="table-head"><span>Product</span><span>Units</span><span>Revenue</span><span>Buying cost</span><span>Gross profit</span></div>{data.rows.map(row => <div className="table-row" key={`${row.product_type}-${row.sku}`}><span><strong>{row.description}</strong><small>{row.product_type} · {row.sku}</small></span><span>{row.units}</span><span>{formatCurrency(row.revenue, settings.currency)}</span><span>{formatCurrency(row.buying_cost, settings.currency)}</span><span className="green-text">{formatCurrency(row.gross_profit, settings.currency)}</span></div>)}{!data.rows.length && <div className="empty">No sales match these filters.</div>}</div></>}</section>;
}
type AuditLog = { id: string; action: string; entity_type?: string; entity_id?: string; metadata?: Record<string, unknown>; ip_address?: string; user_agent?: string; created_at: string; actor_id?: string; actor_name?: string; actor_email?: string };

function CeoAuditOversight() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const actions = useMemo(() => Array.from(new Set(logs.map(log => log.action))).sort(), [logs]);
  const entityTypes = useMemo(() => Array.from(new Set(logs.map(log => log.entity_type).filter(Boolean))).sort() as string[], [logs]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ limit: '100' });
    if (search.trim()) params.set('search', search.trim());
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    setLoading(true); setError('');
    void fetch(`/api/audit-logs?${params.toString()}`, { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load audit oversight.'); if (active) setLogs(data.auditLogs || []); }).catch(loadError => { if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load audit oversight.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [action, entityType, search]);

  return <section className="panel audit-oversight"><div className="panel-header"><div><h2><ShieldCheck size={16}/> CEO audit oversight</h2><p>Drill into organization-wide actions, actors, metadata, and access context.</p></div><span className="audit-scope">CEO only</span></div><div className="audit-filters"><label><span>Search</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Action, actor, entity, or metadata"/></label><label><span>Action</span><select value={action} onChange={event => setAction(event.target.value)}><option value="">All actions</option>{actions.map(item => <option key={item}>{item}</option>)}</select></label><label><span>Entity</span><select value={entityType} onChange={event => setEntityType(event.target.value)}><option value="">All entities</option>{entityTypes.map(item => <option key={item}>{item}</option>)}</select></label><button className="btn secondary audit-refresh" onClick={() => { setAction(''); setEntityType(''); setSearch(''); }}>Clear filters</button></div>{error && <p className="workflow-error" role="alert">{error}</p>}{loading ? <div className="empty">Loading audit records…</div> : <div className="audit-list">{logs.map(log => <div className={selected === log.id ? 'audit-record selected' : 'audit-record'} key={log.id}><button className="audit-record-main" onClick={() => setSelected(selected === log.id ? null : log.id)}><span className="audit-action"><ShieldCheck size={14}/><strong>{log.action}</strong></span><span>{log.actor_name || 'System'}<small>{log.actor_email || 'System event'}</small></span><span>{log.entity_type || 'system'}<small>{log.entity_id || 'No entity ID'}</small></span><span>{new Date(log.created_at).toLocaleString('en-GB')}</span><ArrowDownRight size={14}/></button>{selected === log.id && <div className="audit-detail"><div><strong>Actor</strong><span>{log.actor_name || 'System'} · {log.actor_email || '—'}</span></div><div><strong>IP address</strong><span>{log.ip_address || 'Not recorded'}</span></div><div><strong>User agent</strong><span>{log.user_agent || 'Not recorded'}</span></div><div><strong>Metadata</strong><pre>{JSON.stringify(log.metadata || {}, null, 2)}</pre></div></div>}</div>)}{!logs.length && <div className="empty">No audit records match these filters.</div>}</div>}</section>;
}

type NotificationDelivery = { id: string; event_type: string; recipient_email: string; subject: string; status: 'sent' | 'failed' | 'not_configured'; provider_id: string | null; error_message: string | null; created_at: string };

function CeoNotificationOversight() {
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ limit: '100' });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (eventType) params.set('eventType', eventType);
    setLoading(true); setError('');
    void fetch(`/api/notifications/deliveries?${params.toString()}`, { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load notification delivery oversight.');
      if (active) { setDeliveries(data.deliveries || []); setEventTypes(data.eventTypes || []); }
    }).catch(loadError => { if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load notification delivery oversight.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventType, refreshNonce, search, status]);

  return <section className="panel notification-oversight"><div className="panel-header"><div><h2><Bell size={16}/> Notification delivery oversight</h2><p>CEO-only visibility into branded event emails, provider IDs, and delivery failures.</p></div><div className="notification-header-actions"><span className="audit-scope">CEO only</span><button className="icon-btn" aria-label="Refresh notification deliveries" onClick={() => setRefreshNonce(current => current + 1)}><RefreshCw size={16}/></button></div></div><div className="notification-filters"><label><span>Search</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Recipient, subject, or provider ID"/></label><label><span>Status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="not_configured">Not configured</option></select></label><label><span>Event</span><select value={eventType} onChange={event => setEventType(event.target.value)}><option value="">All events</option>{eventTypes.map(item => <option key={item}>{item}</option>)}</select></label><button className="btn secondary" onClick={() => { setStatus(''); setEventType(''); setSearch(''); }}>Clear filters</button></div>{error && <p className="workflow-error" role="alert">{error}</p>}{loading ? <div className="empty">Loading notification deliveries…</div> : <div className="notification-list">{deliveries.map(delivery => <div className="notification-row" key={delivery.id}><div className="notification-main"><span className={`notification-status ${delivery.status}`}><i/>{delivery.status.replace('_', ' ')}</span><strong>{delivery.event_type}</strong><small>{new Date(delivery.created_at).toLocaleString('en-GB')}</small></div><div className="notification-recipient"><strong>{delivery.recipient_email}</strong><span>{delivery.subject}</span></div><div className="notification-result">{delivery.provider_id ? <><b>Provider ID</b><code>{delivery.provider_id}</code></> : delivery.error_message ? <><b>Failure</b><span className="notification-error">{delivery.error_message}</span></> : <span>Provider response not recorded</span>}</div></div>)}{!deliveries.length && <div className="empty">No notification deliveries match these filters.</div>}</div>}</section>;
}

type BackupRun = { id: string; status: 'pending' | 'running' | 'completed' | 'failed'; sizeBytes: number | null; checksumSha256: string | null; errorMessage: string | null; startedAt: string | null; completedAt: string | null; createdAt: string };

function backupSize(bytes: number | null) {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function backupDate(value: string | null) {
  return value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Queued';
}

function CeoBackupOversight() {
  const [backups, setBackups] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const activeBackup = backups.some(backup => backup.status === 'pending' || backup.status === 'running');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/backups', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load backup status.');
        if (active) { setBackups(data.backups || []); setError(''); }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load backup status.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), activeBackup ? 4000 : 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeBackup]);

  const startBackup = async () => {
    setStarting(true); setError('');
    try {
      const response = await fetch('/api/backups', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to start backup.');
      setBackups(current => [{ id: data.backup.id, status: 'pending' as const, sizeBytes: null, checksumSha256: null, errorMessage: null, startedAt: null, completedAt: null, createdAt: new Date().toISOString() }, ...current].slice(0, 20));
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Unable to start backup.');
    } finally {
      setStarting(false);
    }
  };

  return <section className="panel backup-oversight"><div className="panel-header"><div><h2><DatabaseBackup size={16}/> Encrypted R2 backups</h2><p>CEO-only control for encrypted system backups and platform restore readiness.</p></div><div className="backup-header-actions"><span className="backup-scope"><LockKeyhole size={12}/> R2 · AES-256-GCM</span><button className="btn primary" onClick={() => void startBackup()} disabled={starting || activeBackup}><DatabaseBackup size={15}/>{starting ? 'Starting…' : activeBackup ? 'Backup running' : 'Run backup'}</button></div></div><div className="backup-notice"><LockKeyhole size={15}/><span>The encrypted full-database artifact stays private in R2. This dashboard shows status, checksum, and timestamps; restore access remains with platform operations.</span></div>{error && <p className="workflow-error" role="alert">{error}</p>}{loading ? <div className="empty">Loading backup status…</div> : backups.length ? <div className="backup-list">{backups.map(backup => <div className="backup-row" key={backup.id}><div className="backup-row-main"><span className={`backup-status ${backup.status}`}><span/>{backup.status}</span><strong>{backup.id}</strong><small>Created {backupDate(backup.createdAt)}</small></div><div className="backup-meta"><span><b>Size</b>{backupSize(backup.sizeBytes)}</span><span><b>Finished</b>{backupDate(backup.completedAt)}</span>{backup.checksumSha256 && <span className="backup-checksum"><b>SHA-256</b>{backup.checksumSha256}</span>}</div>{backup.errorMessage && <p className="backup-error">{backup.errorMessage}</p>}</div>)}</div> : <div className="empty">No encrypted backups have been requested.</div>}</section>;
}
