'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Boxes, BriefcaseBusiness, ChevronDown, CircleDollarSign, ClipboardCheck, FileText, Grid2X2, Laptop, LayoutDashboard, Menu, PackageCheck, Plus, Search, Settings, ShieldCheck, ShoppingCart, Truck, Users, X, Zap } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency, formatOrganizationDate, useOrganizationSettings } from './organization-settings';

const nav = [
  { label:'Overview', icon:LayoutDashboard }, { label:'Sales & CRM', icon:BriefcaseBusiness }, { label:'Inventory', icon:Boxes }, { label:'Procurement', icon:ShoppingCart }, { label:'Job cards', icon:ClipboardCheck }, { label:'Warranty', icon:ShieldCheck }, { label:'Reports', icon:FileText },
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
  const settings = useOrganizationSettings();
  const filtered = useMemo(() => dashboard.activity.filter(a => `${a.event} ${a.detail} ${a.status}`.toLowerCase().includes(query.toLowerCase())), [dashboard.activity, query]);
  const notify = (message:string) => { setToast(message); setTimeout(() => setToast(''), 2800); };
  useEffect(() => { void fetch('/api/auth/me', { cache: 'no-store' }).then(async response => { if (!response.ok) { window.location.href = '/login'; return; } const data = await response.json(); setUser(data.user); }).catch(() => { window.location.href = '/login'; }); }, []);
  useEffect(() => { void fetch('/api/dashboard/summary', { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Live dashboard data is unavailable.'); setDashboard(data); }).catch(error => notify(error instanceof Error ? error.message : 'Live dashboard data is unavailable.')); }, []);
  const logout = async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { window.location.href = '/login'; } };
  const goToModule = (label:string) => { if (label !== 'Overview') { window.location.href = `/operations?module=${encodeURIComponent(label)}`; return; } setActive(label); };
  const goToProfile = () => { window.location.href = '/profile'; };
  const goToConfiguration = () => { window.location.href = '/configuration'; };
  const displayName = user?.fullName || 'Loading workspace';
  const displayRole = user?.role || 'Authenticated user';
  return <div className={dark ? 'shell dark' : 'shell'}>
    <aside className={menu ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><Image className="brand-logo" src="/iPaytechLogo.jpg" alt="iPayTech" width={150} height={63} priority/><button className="mobile-close" onClick={()=>setMenu(false)}><X size={19}/></button></div>
      <div className="workspace-label">WORKSPACE</div><div className="workspace"><div className="workspace-dot">HZ</div><div><strong>Harare HQ</strong><span>All operations</span></div><ChevronDown size={15}/></div>
      <nav>{nav.map(({label,icon:Icon}) => <button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>{goToModule(label);setMenu(false);}}><Icon size={17}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-spacer"/><div className="sidebar-section"><button className="nav-item" onClick={()=>goToModule('Finance & HR')}><Users size={17}/><span>People & HR</span></button><button className="nav-item" onClick={goToConfiguration}><Settings size={17}/><span>Configuration</span></button></div>
      <div className="user-card"><button className="user-card-main" onClick={goToProfile} title="Open profile"><div className="avatar">{initials(displayName)}</div><div><strong>{displayName}</strong><span>{displayRole}</span></div></button><button className="user-signout" onClick={()=>void logout()} title="Sign out" aria-label="Sign out"><MoreDots/></button></div>
    </aside>
    <main className="main"><header className="topbar"><button className="mobile-menu" onClick={()=>setMenu(true)} aria-label="Open navigation"><Menu size={21}/></button><div className="crumb"><span>Operations</span><span>/</span><strong>{active}</strong></div><div className="top-actions"><div className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search anything..."/><kbd>⌘ K</kbd></div><button className="icon-btn" aria-label="Toggle theme" onClick={()=>setDark(!dark)}>{dark ? <Zap size={18}/> : <Grid2X2 size={18}/>}</button><button className="icon-btn notification" aria-label="Open approvals" onClick={()=>goToModule('Finance & HR')}><Bell size={18}/><i/></button><button className="top-avatar" onClick={goToProfile} aria-label="Open profile">{initials(displayName)}</button></div></header>
      <div className="content"><div className="page-heading"><div><div className="eyebrow"><span className="live-dot"/> Live operations</div><h1>Good morning, {displayName.split(' ')[0]}</h1><p>Here’s what’s happening across iPayTech today.</p></div><div className="heading-actions"><button className="btn secondary" onClick={()=>goToModule('Reports')}><FileText size={16}/> Open reports</button><button className="btn primary" onClick={()=>goToModule('Sales & CRM')}><Plus size={17}/> New transaction</button></div></div>
        <div className="stats-grid"><StatCard label="Revenue this month" value={formatCurrency(dashboard.summary.revenue, settings.currency, 0)} change="Live" note="Confirmed sales · current month" icon={CircleDollarSign}/><StatCard label="Confirmed sales" value={String(dashboard.summary.confirmed_sales)} change="Live" note="Database-backed transactions" icon={Activity} tone="green"/><StatCard label="Units in stock" value={String(dashboard.summary.units_in_stock)} change="Live" note="Available and reserved inventory" icon={Boxes} tone="amber"/><StatCard label="Open job cards" value={String(dashboard.summary.open_jobs)} change="Live" note="Scheduled and in progress" icon={ClipboardCheck} tone="purple"/></div>
        <div className="grid-main"><section className="panel performance"><div className="panel-header"><div><h2>Performance overview</h2><p>Live revenue and stock receipts over the last 30 days</p></div><button className="select" onClick={()=>goToModule('Reports')}>Open reports <ChevronDown size={14}/></button></div><div className="legend"><span><i className="legend-blue"/>Revenue</span><span><i className="legend-slate"/>Stock receipts</span></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dashboard.performance}><defs><linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f7cf6" stopOpacity={.22}/><stop offset="100%" stopColor="#2f7cf6" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5"/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#8a97aa'}}/><YAxis axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#8a97aa'}}/><Tooltip/><Area type="monotone" dataKey="sales" stroke="#2f7cf6" strokeWidth={2.5} fill="url(#blue)"/><Area type="monotone" dataKey="stock" stroke="#9aa8bd" strokeWidth={1.5} fill="transparent"/></AreaChart></ResponsiveContainer></div></section><section className="panel approvals"><div className="panel-header"><div><h2>Approval inbox</h2><p>Live items requiring attention</p></div><button className="text-btn" onClick={()=>goToModule('Finance & HR')}>Open finance <ArrowUpRight size={14}/></button></div><div className="approval-total"><strong>{String(dashboard.approvals.total).padStart(2, '0')}</strong><span>pending approvals</span><div className="approval-bars"><i/><i/><i/><i/><i/><i/></div></div><div className="approval-list"><Approval icon={ShoppingCart} label="Purchase orders" count={String(dashboard.approvals.purchase_orders).padStart(2, '0')} tone="blue" onOpen={()=>goToModule('Procurement')}/><Approval icon={CircleDollarSign} label="Expenses" count={String(dashboard.approvals.expenses).padStart(2, '0')} tone="amber" onOpen={()=>goToModule('Finance & HR')}/><Approval icon={ShieldCheck} label="Warranty exceptions" count={String(dashboard.approvals.warranty_exceptions).padStart(2, '0')} tone="red" onOpen={()=>goToModule('Warranty')}/><Approval icon={PackageCheck} label="Active reservations" count={String(dashboard.approvals.stock_adjustments).padStart(2, '0')} tone="green" onOpen={()=>goToModule('Inventory')}/></div></section></div>
        <div className="grid-bottom"><section className="panel table-panel"><div className="panel-header"><div><h2>Recent activity</h2><p>Latest events from the database</p></div><button className="text-btn" onClick={()=>goToModule('Reports')}>Open reports <ArrowUpRight size={14}/></button></div><div className="activity-table"><div className="table-head"><span>EVENT</span><span>DETAIL</span><span>STATUS</span><span>WHEN</span></div>{filtered.length ? filtered.map((a,i)=><div className="table-row" key={`${a.event}-${a.occurred_at}`}><span className="event-cell"><span className={`event-icon e${i % 4}`}><Activity size={14}/></span><strong>{a.event}</strong></span><span>{a.detail}</span><span><em className={`pill p${i % 4}`}>{a.status}</em></span><span className="muted">{formatWhen(a.occurred_at, settings)}</span></div>) : <div className="empty">No matching activity found.</div>}</div></section><section className="panel stock-panel"><div className="panel-header"><div><h2>Stock by category</h2><p>Current available inventory</p></div><button className="text-btn" onClick={()=>goToModule('Inventory')}>View stock <ArrowUpRight size={14}/></button></div><div className="stock-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={dashboard.stockByCategory} layout="vertical" margin={{left:0,right:20}}><XAxis type="number" hide/><YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{fontSize:12,fill:'#68768c'}} width={58}/><Tooltip cursor={{fill:'transparent'}}/><Bar dataKey="value" fill="#2f7cf6" radius={[0,4,4,0]} barSize={14}/></BarChart></ResponsiveContainer></div><div className="stock-foot"><span><i className="dot blue"/> Available <strong>{dashboard.summary.units_in_stock}</strong></span><span><i className="dot amber"/> Reserved <strong>{dashboard.approvals.stock_adjustments}</strong></span></div></section></div>
      </div></main>{toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
  </div>
}
function Approval({icon:Icon,label,count,tone,onOpen}:{icon:React.ElementType;label:string;count:string;tone:string;onOpen:()=>void}) { return <button className="approval-row" onClick={onOpen}><span className={`approval-icon ${tone}`}><Icon size={15}/></span><span>{label}</span><b>{count}</b><ArrowUpRight size={14}/></button> }
function MoreDots(){ return <span className="more-dots">•••</span> }
