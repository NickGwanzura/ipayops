'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Boxes,
  BriefcaseBusiness,
  Check,
  CircleDollarSign,
  FileText,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import { formatCurrency, type OrganizationSettings } from './organization-settings';
import { normalizeRole, roleLabel } from '@/lib/rbac';
import type { OpsModule } from '@/lib/ops-data';
import { DashboardQuickActions } from './dashboard-guidance';
import { StatCard } from '@/components/ui/stat-card';

type Props = { role: string; settings: OrganizationSettings; query: string; onNavigate: (module: OpsModule) => void };
type Payload = Record<string, unknown>;
type InventorySummary = { total?: number; available?: number; reserved?: number; installed?: number };
type Dispatch = { id: string; number: string; status: string; destination_town: string; driver_name: string; sale_number?: string; client_name?: string; payment_status?: string };
type Expense = { number: string; amount: string | number; status: string; description: string };
type Invoice = { number: string; outstanding: string | number; status: string; client_name?: string; due_at?: string };
type Employee = { full_name: string; role: string; is_active: boolean; pending_tasks?: number };
type Task = { title: string; user_name?: string; status: string };
type Sale = { number: string; total: string | number; status: string; client_name?: string };
type Commission = { amount: string | number; clawback_amount?: string | number; status: string; sale_number?: string };
const netCommission = (commission: Commission) =>
  Number(commission.amount || 0) - Number(commission.clawback_amount || 0);

async function loadJson(path: string) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json() as Promise<Payload>;
}

function list<T>(data: Record<string, Payload>, path: string, key: string) {
  const value = data[path]?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

function summary(data: Record<string, Payload>, path: string) {
  const value = data[path]?.summary;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export default function RoleDashboard({ role, settings, query, onNavigate }: Props) {
  const normalizedRole = normalizeRole(role);
  const [data, setData] = useState<Record<string, Payload>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const paths = useMemo(() => {
    if (normalizedRole === 'manager')
      return [
        '/api/inventory/summary',
        '/api/hr/employees',
        '/api/hr/onboarding',
        '/api/finance/commission-rules',
        '/api/finance/targets',
        '/api/purchase-orders',
        '/api/dispatches',
      ];
    if (normalizedRole === 'finance')
      return ['/api/finance/expenses', '/api/crm/invoices', '/api/finance/commissions', '/api/crm/returns'];
    return ['/api/crm/opportunities', '/api/crm/quotations', '/api/crm/sales', '/api/dispatches', '/api/finance/commissions'];
  }, [normalizedRole]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.allSettled(paths.map(loadJson)).then((results) => {
      if (!active) return;
      const next: Record<string, Payload> = {};
      let successful = 0;
      const failedPaths: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          next[paths[index]] = result.value;
          successful += 1;
        } else failedPaths.push(paths[index]);
      });
      setData(next);
      if (!successful) setError('This role dashboard could not load its live data.');
      else if (failedPaths.length)
        setError(
          `Some live panels are unavailable: ${failedPaths.map((path) => path.replace('/api/', '')).join(', ')}.`,
        );
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [paths]);

  if (loading)
    return (
      <section className="panel role-loading" aria-label="Loading role dashboard">
        <div className="role-loading-skeleton">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="role-loading-skeleton wide" />
      </section>
    );
  if (normalizedRole === 'manager')
    return <ManagerDashboard data={data} settings={settings} query={query} onNavigate={onNavigate} error={error} />;
  if (normalizedRole === 'finance')
    return <FinanceDashboard data={data} settings={settings} query={query} onNavigate={onNavigate} error={error} />;
  return <SalesDashboard data={data} settings={settings} query={query} onNavigate={onNavigate} error={error} />;
}

function ManagerDashboard({
  data,
  settings,
  query,
  onNavigate,
  error,
}: Omit<Props, 'role'> & { data: Record<string, Payload>; error: string }) {
  const inventory = summary(data, '/api/inventory/summary') as InventorySummary;
  const employees = list<Employee>(data, '/api/hr/employees', 'employees');
  const tasks = list<Task>(data, '/api/hr/onboarding', 'tasks');
  const rules = list<unknown>(data, '/api/finance/commission-rules', 'rules');
  const targets = list<unknown>(data, '/api/finance/targets', 'targets');
  const orders = list<{ number: string; status: string; supplier_name?: string }>(
    data,
    '/api/purchase-orders',
    'purchaseOrders',
  );
  const dispatches = list<Dispatch>(data, '/api/dispatches', 'dispatches');
  return (
    <RoleFrame
      eyebrow="Management cockpit"
      title="Manager dashboard"
      subtitle="People, stock, onboarding, commissions, and operational control"
      role="manager"
      onNavigate={onNavigate}
      error={error}
    >
      <div className="stats-grid">
        <StatCard
          label="Active people"
          help="Employees with an active account. Deactivated people are not counted."
          value={String(employees.filter((employee) => employee.is_active).length)}
          note="Consultants and staff"
          icon={<Users size={17} />}
          tone="purple"
          onClick={() => onNavigate('Finance & HR')}
        />
        <StatCard
          label="Pending onboarding"
          help="Onboarding tasks still open for new staff. New sales consultants get a default checklist when they accept their invitation."
          value={String(tasks.filter((task) => task.status === 'Pending').length)}
          note="Tasks requiring follow-up"
          icon={<Check size={17} />}
          tone="amber"
          onClick={() => onNavigate('Finance & HR')}
        />
        <StatCard
          label="Available stock"
          help="Serialized units ready to sell or transfer. Reserved units are shown beneath."
          value={String(inventory.available || 0)}
          note={`${inventory.reserved || 0} reserved`}
          icon={<Boxes size={17} />}
          tone="blue"
          onClick={() => onNavigate('Inventory')}
        />
        <StatCard
          label="Open dispatches"
          help="Devices sent to other towns that are Prepared or In transit."
          value={String(dispatches.filter((dispatch) => ['Prepared', 'In transit'].includes(dispatch.status)).length)}
          note="Town delivery workload"
          icon={<Truck size={17} />}
          tone="green"
          onClick={() => onNavigate('Dispatch')}
        />
      </div>
      <div className="grid-main">
        <RolePanel
          title="Control centre"
          subtitle="Manager-owned settings and queues"
          action={{ label: 'Open controls', onClick: () => onNavigate('Finance & HR') }}
        >
          <div className="role-summary-grid">
            <div>
              <strong>{rules.length}</strong>
              <span>commission rules</span>
            </div>
            <div>
              <strong>{targets.length}</strong>
              <span>consultant targets</span>
            </div>
            <div>
              <strong>{orders.filter((order) => order.status === 'Pending approval').length}</strong>
              <span>PO approvals</span>
            </div>
          </div>
        </RolePanel>
        <RolePanel
          title="Next dispatch actions"
          subtitle={`Showing ${Math.min(dispatches.length, 5)} of ${dispatches.length} dispatches`}
          action={{ label: 'View dispatches', onClick: () => onNavigate('Dispatch') }}
        >
          <RoleList
            items={dispatches
              .filter(
                (dispatch) =>
                  !query || `${dispatch.number} ${dispatch.destination_town} ${dispatch.driver_name} ${dispatch.status}`.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 5)
              .map((dispatch) => ({
                title: dispatch.number,
                detail: `${dispatch.destination_town} · ${dispatch.driver_name} · ${dispatch.status}`,
                module: 'Dispatch' as OpsModule,
              }))}
            empty="No dispatches require attention."
            onNavigate={onNavigate}
          />
        </RolePanel>
      </div>
    </RoleFrame>
  );
}

function FinanceDashboard({
  data,
  settings,
  query,
  onNavigate,
  error,
}: Omit<Props, 'role'> & { data: Record<string, Payload>; error: string }) {
  const expenses = list<Expense>(data, '/api/finance/expenses', 'expenses');
  const invoices = list<Invoice>(data, '/api/crm/invoices', 'invoices').filter(
    (invoice) => invoice.status === 'Issued' && Number(invoice.outstanding || 0) > 0,
  );
  const totals = summary(data, '/api/crm/invoices');
  const commissions = list<Commission>(data, '/api/finance/commissions', 'commissions').filter(
    (commission) => commission.status !== 'Voided',
  );
  const overdue = invoices.filter((invoice) => invoice.due_at && new Date(invoice.due_at).getTime() < Date.now());
  const outstanding =
    totals.outstanding !== undefined
      ? Number(totals.outstanding)
      : invoices.reduce((sum, invoice) => sum + Number(invoice.outstanding || 0), 0);
  const overdueCount = totals.overdue_count !== undefined ? Number(totals.overdue_count) : overdue.length;
  const overdueAmount =
    totals.overdue_amount !== undefined
      ? Number(totals.overdue_amount)
      : overdue.reduce((sum, invoice) => sum + Number(invoice.outstanding || 0), 0);
  return (
    <RoleFrame
      eyebrow="Finance desk"
      title="Finance dashboard"
      subtitle="Payments, debtors, invoices, expenses, and commission settlement"
      role="finance"
      onNavigate={onNavigate}
      error={error}
    >
      <div className="stats-grid">
        <StatCard
          label="Outstanding debtors"
          help="Issued invoice totals minus payments received, across all open invoices. Void invoices are excluded."
          value={formatCurrency(outstanding, settings.currency, 0)}
          note="Open invoice balances"
          icon={<CircleDollarSign size={17} />}
          tone="amber"
          onClick={() => onNavigate('Finance & HR')}
        />
        <StatCard
          label="Overdue debtors"
          help="Open invoices past their due date, with the amount still owed."
          value={String(overdueCount)}
          note={formatCurrency(overdueAmount, settings.currency, 0)}
          icon={<CircleDollarSign size={17} />}
          tone="red"
          onClick={() => onNavigate('Finance & HR')}
        />
        <StatCard
          label="Pending expenses"
          help="Expense claims submitted and waiting for review."
          value={String(expenses.filter((expense) => expense.status === 'Pending').length)}
          note="Awaiting review"
          icon={<FileText size={17} />}
          tone="purple"
          onClick={() => onNavigate('Finance & HR')}
        />
        <StatCard
          label="Commission entries"
          help="Commission records in the ledger, excluding voided ones."
          value={String(commissions.length)}
          note="Visible finance ledger"
          icon={<Check size={17} />}
          tone="green"
          onClick={() => onNavigate('Finance & HR')}
        />
      </div>
      <div className="grid-main">
        <RolePanel
          title="Debtors and payments"
          subtitle={`Showing ${Math.min(invoices.length, 6)} of ${invoices.length} invoices`}
          action={{ label: 'Open finance', onClick: () => onNavigate('Finance & HR') }}
        >
          <RoleList
            items={invoices
              .filter(
                (invoice) =>
                  !query ||
                  `${invoice.number} ${invoice.client_name || ''} ${invoice.status}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .slice(0, 6)
              .map((invoice) => ({
                title: invoice.number,
                detail: `${invoice.client_name || 'Client'} · ${formatCurrency(invoice.outstanding, settings.currency)} · ${invoice.status}`,
                module: 'Finance & HR' as OpsModule,
              }))}
            empty="No outstanding invoices."
            onNavigate={onNavigate}
          />
        </RolePanel>
        <RolePanel
          title="Expense queue"
          subtitle={`Showing ${Math.min(expenses.length, 6)} of ${expenses.length} expenses`}
          action={{ label: 'View all expenses', onClick: () => onNavigate('Finance & HR') }}
        >
          <RoleList
            items={expenses.slice(0, 6).map((expense) => ({
              title: expense.number,
              detail: `${expense.description} · ${formatCurrency(expense.amount, settings.currency)} · ${expense.status}`,
              module: 'Finance & HR' as OpsModule,
            }))}
            empty="No expenses recorded."
            onNavigate={onNavigate}
          />
        </RolePanel>
      </div>
    </RoleFrame>
  );
}

function SalesDashboard({
  data,
  settings,
  query,
  onNavigate,
  error,
}: Omit<Props, 'role'> & { data: Record<string, Payload>; error: string }) {
  const opportunities = list<{ stage: string }>(data, '/api/crm/opportunities', 'opportunities').filter(
    (opportunity) => !['Won', 'Lost'].includes(opportunity.stage),
  );
  const quotations = list<{ status: string }>(data, '/api/crm/quotations', 'quotations').filter((quotation) =>
    ['Draft', 'Sent', 'Accepted'].includes(quotation.status),
  );
  const sales = list<Sale>(data, '/api/crm/sales', 'sales').filter(
    (sale) => !['Cancelled', 'Returned'].includes(sale.status),
  );
  const dispatches = list<Dispatch>(data, '/api/dispatches', 'dispatches');
  const commissions = list<Commission>(data, '/api/finance/commissions', 'commissions').filter(
    (commission) => commission.status !== 'Voided',
  );
  return (
    <RoleFrame
      eyebrow="Sales workspace"
      title="Sales consultant dashboard"
      subtitle="CRM, pre-sales, confirmed sales, dispatch tracking, and your commission"
      role="sales_consultant"
      onNavigate={onNavigate}
      error={error}
    >
      <div className="stats-grid">
        <StatCard
          label="Open opportunities"
          help="Pipeline deals that are not yet Won or Lost."
          value={String(opportunities.length)}
          note="Active pipeline"
          icon={<BriefcaseBusiness size={17} />}
          tone="blue"
          onClick={() => onNavigate('Sales & CRM')}
        />
        <StatCard
          label="Pre-sales"
          help="Quotes in Draft, Sent or Accepted status that have not been converted or cancelled."
          value={String(quotations.length)}
          note="Quotes in progress"
          icon={<FileText size={17} />}
          tone="purple"
          onClick={() => onNavigate('Sales & CRM')}
        />
        <StatCard
          label="Confirmed sales"
          help="Your sales that are not cancelled or fully returned."
          value={String(sales.length)}
          note="Converted transactions"
          icon={<ShoppingCart size={17} />}
          tone="green"
          onClick={() => onNavigate('Sales & CRM')}
        />
        <StatCard
          label="My commission"
          help="Your commission after any clawbacks, excluding voided entries. Status flows Provisional → Approved → Paid."
          value={formatCurrency(
            commissions.reduce((sum, commission) => sum + netCommission(commission), 0),
            settings.currency,
            0,
          )}
          note={`${commissions.length} entries`}
          icon={<CircleDollarSign size={17} />}
          tone="amber"
          onClick={() => onNavigate('Reports')}
        />
      </div>
      <div className="grid-main">
        <RolePanel
          title="My dispatches"
          subtitle={`Showing ${Math.min(dispatches.length, 6)} of ${dispatches.length} dispatches`}
          action={{ label: 'View dispatches', onClick: () => onNavigate('Dispatch') }}
        >
          <RoleList
            items={dispatches
              .filter(
                (dispatch) =>
                  !query || `${dispatch.number} ${dispatch.destination_town} ${dispatch.driver_name} ${dispatch.status}`.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 6)
              .map((dispatch) => ({
                title: dispatch.number,
                detail: `${dispatch.destination_town} · ${dispatch.driver_name} · ${dispatch.payment_status || dispatch.status}`,
                module: 'Dispatch' as OpsModule,
              }))}
            empty="No dispatches found."
            onNavigate={onNavigate}
          />
        </RolePanel>
        <RolePanel
          title="Commission ledger"
          subtitle={`Showing ${Math.min(commissions.length, 6)} of ${commissions.length} entries`}
          action={{ label: 'Open reports', onClick: () => onNavigate('Reports') }}
        >
          <RoleList
            items={commissions.slice(0, 6).map((commission) => ({
              title: commission.sale_number || 'Sale',
              detail: `${formatCurrency(commission.amount, settings.currency)} · ${commission.status}`,
            }))}
            empty="No commission entries yet."
          />
        </RolePanel>
      </div>
    </RoleFrame>
  );
}

function RoleFrame({
  eyebrow,
  title,
  subtitle,
  role,
  onNavigate,
  error,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  role: string;
  onNavigate: (module: OpsModule) => void;
  error: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> {eyebrow}
          </div>
          <h1>{title}</h1>
          <p>
            {subtitle} · {roleLabel(role)}
          </p>
        </div>
      </div>
      <DashboardQuickActions role={role} onNavigate={onNavigate} />
      {error && (
        <p className="workflow-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </>
  );
}

function RolePanel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {action && (
          <button className="text-btn" onClick={action.onClick}>
            {action.label} <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
function RoleList({
  items,
  empty,
  onNavigate,
}: {
  items: Array<{ title: string; detail: string; module?: OpsModule }>;
  empty: string;
  onNavigate?: (module: OpsModule) => void;
}) {
  return (
    <div className="role-list">
      {items.map((item) =>
        item.module && onNavigate ? (
          <button
            className="role-list-item"
            key={`${item.title}-${item.detail}`}
            onClick={() => onNavigate(item.module as OpsModule)}
          >
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            <ArrowUpRight size={14} />
          </button>
        ) : (
          <div className="role-list-item" key={`${item.title}-${item.detail}`}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            <ArrowUpRight size={14} />
          </div>
        ),
      )}
      {!items.length && <div className="empty">{empty}</div>}
    </div>
  );
}
