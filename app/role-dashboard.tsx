'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Boxes, BriefcaseBusiness, Check, CircleDollarSign, ClipboardCheck, FileText, ShieldCheck, ShoppingCart, Users } from 'lucide-react';
import { formatCurrency, type OrganizationSettings } from './organization-settings';
import { modulesForRole, normalizeRole, roleLabel } from '@/lib/rbac';
import type { OpsModule } from '@/lib/ops-data';

type Props = { role: string; settings: OrganizationSettings; query: string; onNavigate: (module: OpsModule) => void };
type Payload = Record<string, unknown>;
type InventorySummary = { total?: number; available?: number; reserved?: number; installed?: number };
type Job = { id: string; number: string; title: string; status: string; client_name?: string; scheduled_for?: string };
type Expense = { number: string; amount: string | number; status: string; description: string };
type Invoice = { number: string; outstanding: string | number; status: string; client_name?: string; due_at?: string };
type Employee = { full_name: string; role: string; is_active: boolean; pending_tasks?: number };
type Task = { title: string; user_name?: string; status: string };
type Sale = { number: string; total: string | number; status: string; client_name?: string };
type Commission = { amount: string | number; status: string; sale_number?: string };

async function loadJson(path: string) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json() as Promise<Payload>;
}

function list<T>(data: Record<string, Payload>, path: string, key: string) {
  const value = data[path]?.[key];
  return Array.isArray(value) ? value as T[] : [];
}

function summary(data: Record<string, Payload>, path: string) {
  const value = data[path]?.summary;
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export default function RoleDashboard({ role, settings, query, onNavigate }: Props) {
  const normalizedRole = normalizeRole(role);
  const [data, setData] = useState<Record<string, Payload>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const paths = useMemo(() => {
    if (normalizedRole === 'manager') return ['/api/inventory/summary', '/api/hr/employees', '/api/hr/onboarding', '/api/finance/commission-rules', '/api/finance/targets', '/api/purchase-orders', '/api/jobs'];
    if (normalizedRole === 'finance') return ['/api/finance/expenses', '/api/crm/invoices', '/api/finance/commissions', '/api/crm/returns'];
    return ['/api/crm/opportunities', '/api/crm/quotations', '/api/crm/sales', '/api/jobs', '/api/finance/commissions'];
  }, [normalizedRole]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void Promise.allSettled(paths.map(loadJson)).then(results => {
      if (!active) return;
      const next: Record<string, Payload> = {};
      let successful = 0;
      const failedPaths: string[] = [];
      results.forEach((result, index) => { if (result.status === 'fulfilled') { next[paths[index]] = result.value; successful += 1; } else failedPaths.push(paths[index]); });
      setData(next);
      if (!successful) setError('This role dashboard could not load its live data.');
      else if (failedPaths.length) setError(`Some live panels are unavailable: ${failedPaths.map(path => path.replace('/api/', '')).join(', ')}.`);
      setLoading(false);
    });
    return () => { active = false; };
  }, [paths]);

  if (loading) return <section className="panel role-loading"><p>Loading your role dashboard…</p></section>;
  if (normalizedRole === 'manager') return <ManagerDashboard data={data} settings={settings} query={query} onNavigate={onNavigate} error={error}/>;
  if (normalizedRole === 'finance') return <FinanceDashboard data={data} settings={settings} query={query} onNavigate={onNavigate} error={error}/>;
  return <SalesDashboard data={data} settings={settings} query={query} onNavigate={onNavigate} error={error}/>;
}

function ManagerDashboard({ data, settings, query, onNavigate, error }: Omit<Props, 'role'> & { data: Record<string, Payload>; error: string }) {
  const inventory = summary(data, '/api/inventory/summary') as InventorySummary;
  const employees = list<Employee>(data, '/api/hr/employees', 'employees');
  const tasks = list<Task>(data, '/api/hr/onboarding', 'tasks');
  const rules = list<unknown>(data, '/api/finance/commission-rules', 'rules');
  const targets = list<unknown>(data, '/api/finance/targets', 'targets');
  const orders = list<{ number: string; status: string; supplier_name?: string }>(data, '/api/purchase-orders', 'orders');
  const jobs = list<Job>(data, '/api/jobs', 'jobs');
  return <RoleFrame eyebrow="Management cockpit" title="Manager dashboard" subtitle="People, stock, onboarding, commissions, and operational control" role="manager" query={query} actions={[['Finance & HR', Users], ['Inventory', Boxes], ['Procurement', ShoppingCart], ['Job cards', ClipboardCheck]]} onNavigate={onNavigate} error={error}>
    <div className="stats-grid"><RoleStat label="Active people" value={String(employees.filter(employee => employee.is_active).length)} note="Consultants and staff" icon={<Users size={17}/>} tone="purple" onClick={() => onNavigate('Finance & HR')}/><RoleStat label="Pending onboarding" value={String(tasks.filter(task => task.status === 'Pending').length)} note="Tasks requiring follow-up" icon={<Check size={17}/>} tone="amber" onClick={() => onNavigate('Finance & HR')}/><RoleStat label="Available stock" value={String(inventory.available || 0)} note={`${inventory.reserved || 0} reserved`} icon={<Boxes size={17}/>} tone="blue" onClick={() => onNavigate('Inventory')}/><RoleStat label="Open jobs" value={String(jobs.filter(job => ['Scheduled', 'In progress'].includes(job.status)).length)} note="Installation workload" icon={<ClipboardCheck size={17}/>} tone="green" onClick={() => onNavigate('Job cards')}/></div>
    <div className="grid-main"><RolePanel title="Control centre" subtitle="Manager-owned settings and queues"><div className="role-summary-grid"><div><strong>{rules.length}</strong><span>commission rules</span></div><div><strong>{targets.length}</strong><span>consultant targets</span></div><div><strong>{orders.filter(order => order.status === 'Pending approval').length}</strong><span>PO approvals</span></div></div></RolePanel><RolePanel title="Next actions" subtitle="Current operational attention"><RoleList items={jobs.filter(job => !query || `${job.number} ${job.title} ${job.status}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5).map(job => ({ title: job.number, detail: `${job.title} · ${job.status}`, module: 'Job cards' as OpsModule }))} empty="No jobs require attention." onNavigate={onNavigate}/></RolePanel></div>
  </RoleFrame>;
}

function FinanceDashboard({ data, settings, query, onNavigate, error }: Omit<Props, 'role'> & { data: Record<string, Payload>; error: string }) {
  const expenses = list<Expense>(data, '/api/finance/expenses', 'expenses');
  const invoices = list<Invoice>(data, '/api/crm/invoices', 'invoices');
  const commissions = list<Commission>(data, '/api/finance/commissions', 'commissions');
  const outstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.outstanding || 0), 0);
  const overdue = invoices.filter(invoice => Number(invoice.outstanding || 0) > 0 && invoice.due_at && new Date(invoice.due_at).getTime() < Date.now());
  return <RoleFrame eyebrow="Finance desk" title="Finance dashboard" subtitle="Payments, debtors, invoices, expenses, and commission settlement" role="finance" query={query} actions={[['Finance & HR', CircleDollarSign], ['Reports', FileText]]} onNavigate={onNavigate} error={error}>
    <div className="stats-grid"><RoleStat label="Outstanding debtors" value={formatCurrency(outstanding, settings.currency, 0)} note="Open invoice balances" icon={<CircleDollarSign size={17}/>} tone="amber" onClick={() => onNavigate('Finance & HR')}/><RoleStat label="Overdue debtors" value={String(overdue.length)} note={formatCurrency(overdue.reduce((sum, invoice) => sum + Number(invoice.outstanding || 0), 0), settings.currency, 0)} icon={<CircleDollarSign size={17}/>} tone="red" onClick={() => onNavigate('Finance & HR')}/><RoleStat label="Pending expenses" value={String(expenses.filter(expense => expense.status === 'Pending').length)} note="Awaiting review" icon={<FileText size={17}/>} tone="purple" onClick={() => onNavigate('Finance & HR')}/><RoleStat label="Commission entries" value={String(commissions.length)} note="Visible finance ledger" icon={<Check size={17}/>} tone="green" onClick={() => onNavigate('Finance & HR')}/></div>
    <div className="grid-main"><RolePanel title="Debtors and payments" subtitle="Invoices requiring collection"><RoleList items={invoices.filter(invoice => !query || `${invoice.number} ${invoice.client_name || ''} ${invoice.status}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6).map(invoice => ({ title: invoice.number, detail: `${invoice.client_name || 'Client'} · ${formatCurrency(invoice.outstanding, settings.currency)} · ${invoice.status}`, module: 'Finance & HR' as OpsModule }))} empty="No outstanding invoices." onNavigate={onNavigate}/></RolePanel><RolePanel title="Expense queue" subtitle="Recent finance activity"><RoleList items={expenses.slice(0, 6).map(expense => ({ title: expense.number, detail: `${expense.description} · ${formatCurrency(expense.amount, settings.currency)} · ${expense.status}`, module: 'Finance & HR' as OpsModule }))} empty="No expenses recorded." onNavigate={onNavigate}/></RolePanel></div>
  </RoleFrame>;
}

function SalesDashboard({ data, settings, query, onNavigate, error }: Omit<Props, 'role'> & { data: Record<string, Payload>; error: string }) {
  const opportunities = list<unknown>(data, '/api/crm/opportunities', 'opportunities');
  const quotations = list<unknown>(data, '/api/crm/quotations', 'quotations');
  const sales = list<Sale>(data, '/api/crm/sales', 'sales');
  const jobs = list<Job>(data, '/api/jobs', 'jobs');
  const commissions = list<Commission>(data, '/api/finance/commissions', 'commissions');
  return <RoleFrame eyebrow="Sales workspace" title="Sales consultant dashboard" subtitle="CRM, pre-sales, confirmed sales, job cards, and your commission" role="sales_consultant" query={query} actions={[['Sales & CRM', BriefcaseBusiness], ['Job cards', ClipboardCheck], ['Reports', FileText]]} onNavigate={onNavigate} error={error}>
    <div className="stats-grid"><RoleStat label="Open opportunities" value={String(opportunities.length)} note="Active pipeline" icon={<BriefcaseBusiness size={17}/>} tone="blue" onClick={() => onNavigate('Sales & CRM')}/><RoleStat label="Pre-sales" value={String(quotations.length)} note="Quotes in progress" icon={<FileText size={17}/>} tone="purple" onClick={() => onNavigate('Sales & CRM')}/><RoleStat label="Confirmed sales" value={String(sales.length)} note="Converted transactions" icon={<ShoppingCart size={17}/>} tone="green" onClick={() => onNavigate('Sales & CRM')}/><RoleStat label="My commission" value={formatCurrency(commissions.reduce((sum, commission) => sum + Number(commission.amount || 0), 0), settings.currency, 0)} note={`${commissions.length} entries`} icon={<CircleDollarSign size={17}/>} tone="amber" onClick={() => onNavigate('Reports')}/></div>
    <div className="grid-main"><RolePanel title="My job cards" subtitle="Installation work linked to sales"><RoleList items={jobs.filter(job => !query || `${job.number} ${job.title} ${job.status}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6).map(job => ({ title: job.number, detail: `${job.title} · ${job.status}`, module: 'Job cards' as OpsModule }))} empty="No job cards found." onNavigate={onNavigate}/></RolePanel><RolePanel title="Commission ledger" subtitle="Read-only personal commission view"><RoleList items={commissions.slice(0, 6).map(commission => ({ title: commission.sale_number || 'Sale', detail: `${formatCurrency(commission.amount, settings.currency)} · ${commission.status}` }))} empty="No commission entries yet."/></RolePanel></div>
  </RoleFrame>;
}

function RoleFrame({ eyebrow, title, subtitle, role, query, actions, onNavigate, error, children }: { eyebrow: string; title: string; subtitle: string; role: string; query: string; actions: [OpsModule, React.ElementType][]; onNavigate: (module: OpsModule) => void; error: string; children: React.ReactNode }) {
  return <><div className="page-heading"><div><div className="eyebrow"><span className="live-dot"/> {eyebrow}</div><h1>{title}</h1><p>{subtitle} · {roleLabel(role)}</p></div><div className="heading-actions">{actions.filter(([module]) => modulesForRole(role).includes(module)).map(([module, Icon]) => <button key={module} className="btn secondary" onClick={() => onNavigate(module)}><Icon size={15}/> Open {module}</button>)}</div></div>{error && <p className="workflow-error" role="alert">{error}</p>}{children}</>;
}

function RoleStat({ label, value, note, icon, tone, onClick }: { label: string; value: string; note: string; icon: React.ReactNode; tone: string; onClick?: () => void }) { const content = <><div className="stat-top"><span className={`icon-box ${tone}`}>{icon}</span><span className="change">Live</span></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className="stat-note">{note}</div></>; return onClick ? <button className="stat-card role-stat-action" onClick={onClick}>{content}</button> : <div className="stat-card">{content}</div>; }
function RolePanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="panel"><div className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>; }
function RoleList({ items, empty, onNavigate }: { items: Array<{ title: string; detail: string; module?: OpsModule }>; empty: string; onNavigate?: (module: OpsModule) => void }) { return <div className="role-list">{items.map(item => item.module && onNavigate ? <button className="role-list-item" key={`${item.title}-${item.detail}`} onClick={() => onNavigate(item.module as OpsModule)}><div><strong>{item.title}</strong><span>{item.detail}</span></div><ArrowUpRight size={14}/></button> : <div className="role-list-item" key={`${item.title}-${item.detail}`}><div><strong>{item.title}</strong><span>{item.detail}</span></div><ArrowUpRight size={14}/></div>)}{!items.length && <div className="empty">{empty}</div>}</div>; }
