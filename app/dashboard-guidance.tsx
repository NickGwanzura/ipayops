'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Boxes, BriefcaseBusiness, Check, CircleDollarSign, ClipboardCheck, FileText, Plus, ShieldCheck, ShoppingCart, Users, X } from 'lucide-react';
import { normalizeRole, roleLabel } from '@/lib/rbac';
import type { OpsModule } from '@/lib/ops-data';
import { useDialogFocus } from './dialog-focus';

type DashboardRole = 'ceo' | 'manager' | 'finance' | 'sales_consultant';
type QuickAction = { label: string; detail: string; module: OpsModule; icon: React.ElementType; tone: string };
type GuideStep = { title: string; detail: string; module?: OpsModule; moduleLabel?: string; icon: React.ElementType };

const quickActions: Record<DashboardRole, QuickAction[]> = {
  ceo: [
    { label: 'Review approvals', detail: 'Purchase orders, expenses, and exceptions', module: 'Finance & HR', icon: Check, tone: 'green' },
    { label: 'Open profitability', detail: 'Revenue, cost, margin, and product filters', module: 'Reports', icon: CircleDollarSign, tone: 'amber' },
    { label: 'Inspect inventory', detail: 'Serialized stock, reservations, and movements', module: 'Inventory', icon: Boxes, tone: 'blue' },
    { label: 'Review audit logs', detail: 'Oversight of organization activity', module: 'Audit Logs', icon: FileText, tone: 'purple' },
  ],
  manager: [
    { label: 'Add consultant', detail: 'Invite a user and start onboarding', module: 'Finance & HR', icon: Users, tone: 'purple' },
    { label: 'Control stock', detail: 'Receive, reserve, transfer, and ship devices', module: 'Inventory', icon: Boxes, tone: 'blue' },
    { label: 'Manage procurement', detail: 'Suppliers, purchase orders, and receipts', module: 'Procurement', icon: ShoppingCart, tone: 'amber' },
    { label: 'Set commissions', detail: 'Rules and consultant targets', module: 'Finance & HR', icon: CircleDollarSign, tone: 'green' },
  ],
  finance: [
    { label: 'Review payments', detail: 'Open invoices, debtors, and receipts', module: 'Finance & HR', icon: CircleDollarSign, tone: 'amber' },
    { label: 'Process expenses', detail: 'Review claims and receipt attachments', module: 'Finance & HR', icon: FileText, tone: 'purple' },
    { label: 'Open finance reports', detail: 'Export filtered financial records', module: 'Reports', icon: BriefcaseBusiness, tone: 'blue' },
    { label: 'Check products', detail: 'Verify cost, selling price, and margin', module: 'Products', icon: Boxes, tone: 'green' },
  ],
  sales_consultant: [
    { label: 'Create a lead', detail: 'Start a client and opportunity workflow', module: 'Sales & CRM', icon: Plus, tone: 'blue' },
    { label: 'Raise a quotation', detail: 'Use live product prices and serial stock', module: 'Sales & CRM', icon: FileText, tone: 'purple' },
    { label: 'Open job cards', detail: 'Track installations and client sign-offs', module: 'Job cards', icon: ClipboardCheck, tone: 'green' },
    { label: 'View commission', detail: 'See your sales-linked commission ledger', module: 'Reports', icon: CircleDollarSign, tone: 'amber' },
  ],
};

const guideSteps: Record<DashboardRole, GuideStep[]> = {
  ceo: [
    { title: 'Start with the KPI strip', detail: 'Use revenue, confirmed sales, stock, and open jobs to understand the organization at a glance.', icon: CircleDollarSign },
    { title: 'Work from approvals', detail: 'Open the approval inbox to review purchase orders, expenses, warranty exceptions, and reservations that need oversight.', module: 'Finance & HR', moduleLabel: 'Open approvals', icon: Check },
    { title: 'Drill into performance', detail: 'Use Reports for filtered profitability and Audit Logs for a complete organization activity trail.', module: 'Reports', moduleLabel: 'Open CEO reports', icon: FileText },
  ],
  manager: [
    { title: 'Set up your team', detail: 'Invite consultants, assign onboarding tasks, and review employee lifecycle history in Finance & HR.', module: 'Finance & HR', moduleLabel: 'Open team controls', icon: Users },
    { title: 'Keep stock moving', detail: 'Use Inventory for serialized intake, reservations, transfers, shipping, and release controls.', module: 'Inventory', moduleLabel: 'Open stock control', icon: Boxes },
    { title: 'Control sales operations', detail: 'Configure commission rules and targets, then use Procurement and Job cards to manage delivery.', module: 'Procurement', moduleLabel: 'Open procurement', icon: ShoppingCart },
  ],
  finance: [
    { title: 'Start with the finance KPI strip', detail: 'Outstanding debtors, overdue balances, pending expenses, and commission entries show your current workload.', icon: CircleDollarSign },
    { title: 'Resolve the payment queue', detail: 'Open Finance & HR to inspect invoices, download documents, record partial payments, and process refunds.', module: 'Finance & HR', moduleLabel: 'Open finance desk', icon: FileText },
    { title: 'Validate the numbers', detail: 'Use Products to check pricing and Reports to export the filtered records needed for reconciliation.', module: 'Reports', moduleLabel: 'Open reports', icon: Check },
  ],
  sales_consultant: [
    { title: 'Build your pipeline', detail: 'Start in Sales & CRM with clients, leads, opportunities, and quotations.', module: 'Sales & CRM', moduleLabel: 'Open CRM', icon: BriefcaseBusiness },
    { title: 'Convert with serialized stock', detail: 'Confirm a sale by assigning the exact available serial numbers from the quotation workflow.', module: 'Sales & CRM', moduleLabel: 'Open sales workspace', icon: ShoppingCart },
    { title: 'Deliver and earn', detail: 'Use Job cards for installation and sign-off, then Reports for your commission view.', module: 'Job cards', moduleLabel: 'Open job cards', icon: ClipboardCheck },
  ],
};

export function dashboardRole(role: string): DashboardRole {
  return normalizeRole(role);
}

export function DashboardQuickActions({ role, onNavigate }: { role: string; onNavigate: (module: OpsModule) => void }) {
  const normalizedRole = dashboardRole(role);
  const actions = quickActions[normalizedRole];
  return <section className="dashboard-quick-actions panel">
    <div className="dashboard-quick-copy"><span className="eyebrow">Quick actions</span><h2>Move work forward</h2><p>Shortcuts for the tasks most important to your {roleLabel(normalizedRole).toLowerCase()} workflow.</p></div>
    <div className="dashboard-quick-list">{actions.map(action => { const Icon = action.icon; return <button className="dashboard-quick-action" key={`${action.label}-${action.module}`} onClick={() => onNavigate(action.module)}><span className={`dashboard-quick-icon ${action.tone}`}><Icon size={16}/></span><span><strong>{action.label}</strong><small>{action.detail}</small></span><ArrowRight size={15}/></button>; })}<DashboardOnboarding role={normalizedRole} onNavigate={onNavigate}/></div>
  </section>;
}

function DashboardOnboarding({ role, onNavigate }: { role: DashboardRole; onNavigate: (module: OpsModule) => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const steps = useMemo(() => guideSteps[role], [role]);
  const storageKey = `ipaytech:dashboard-guide:${role}`;
  const close = () => { setOpen(false); window.localStorage.setItem(storageKey, 'dismissed'); };

  useEffect(() => {
    try { if (window.localStorage.getItem(storageKey) !== 'dismissed') setOpen(true); } catch { setOpen(true); }
  }, [storageKey]);

  const openGuide = () => { setStep(0); setOpen(true); };
  const finish = () => { window.localStorage.setItem(storageKey, 'dismissed'); setOpen(false); };
  return <>
    <button className="dashboard-guide-action" onClick={openGuide}><span className="dashboard-guide-icon"><ShieldCheck size={16}/></span><span><strong>Dashboard guide</strong><small>Learn your role in 3 steps</small></span><ArrowRight size={15}/></button>
    {open && <DashboardGuideDialog role={role} steps={steps} step={step} setStep={setStep} close={close} finish={finish} onNavigate={onNavigate}/>}
  </>;
}

function DashboardGuideDialog({ role, steps, step, setStep, close, finish, onNavigate }: { role: DashboardRole; steps: GuideStep[]; step: number; setStep: (value: number) => void; close: () => void; finish: () => void; onNavigate: (module: OpsModule) => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(close);
  const current = steps[step];
  const Icon = current.icon;
  return <div className="dashboard-guide-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={dialogRef} className="dashboard-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="dashboard-guide-title" tabIndex={-1}>
    <div className="dashboard-guide-header"><div><span className="eyebrow">New user onboarding</span><h2 id="dashboard-guide-title">Your {roleLabel(role)} dashboard</h2><p>A quick tour of the workspaces and actions you use most.</p></div><button className="dashboard-guide-close" onClick={close} aria-label="Close dashboard guide"><X size={18}/></button></div>
    <div className="dashboard-guide-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>{steps.map((item, index) => <span key={item.title} className={index <= step ? 'active' : ''}>{index + 1}</span>)}</div>
    <div className="dashboard-guide-step"><span className="dashboard-guide-step-icon"><Icon size={22}/></span><div><span className="dashboard-guide-step-count">Step {step + 1} of {steps.length}</span><h3>{current.title}</h3><p>{current.detail}</p></div></div>
    <div className="dashboard-guide-actions">{current.module && <button className="btn secondary" onClick={() => { close(); onNavigate(current.module as OpsModule); }}>{current.moduleLabel || 'Open workspace'} <ArrowRight size={15}/></button>}<span className="dashboard-guide-spacer"/><button className="btn secondary" onClick={close}>Skip for now</button>{step > 0 && <button className="btn secondary" onClick={() => setStep(step - 1)}>Back</button>}{step < steps.length - 1 ? <button className="btn primary" onClick={() => setStep(step + 1)}>Next <ArrowRight size={15}/></button> : <button className="btn primary" onClick={finish}><Check size={15}/> Finish</button>}</div>
  </div></div>;
}
