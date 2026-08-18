'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Check, CircleDollarSign, FileText, Paperclip, Plus, Upload, Users, X } from 'lucide-react';

type Expense = { id: string; number: string; category: string; description: string; amount: string; currency: string; status: string; submitted_at: string; submitter_name?: string; attachment_count?: number };
type Invoice = { id: string; number: string; status: string; total: string; paid_amount: string; outstanding: string; client_name: string; sale_number: string; due_at?: string };
type Rule = { id: string; name: string; rate: string; trigger_status: string; is_active: boolean };
type Target = { id: string; consultant_name: string; period_start: string; period_end: string; target_amount: string; achieved: string };
type User = { id: string; full_name: string; role: string };

export default function FinanceWorkspace({ notify }: { notify: (message: string) => void }) {
  const [expenses, setExpenses] = useState<Expense[]>([]); const [rules, setRules] = useState<Rule[]>([]); const [targets, setTargets] = useState<Target[]>([]); const [users, setUsers] = useState<User[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [dialog, setDialog] = useState<'expense' | 'payment' | 'rule' | 'target' | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [expenseResponse, invoiceResponse, rulesResponse, targetsResponse, usersResponse] = await Promise.all([
        fetch('/api/finance/expenses', { cache: 'no-store' }),
        fetch('/api/crm/invoices', { cache: 'no-store' }),
        fetch('/api/finance/commission-rules', { cache: 'no-store' }),
        fetch('/api/finance/targets', { cache: 'no-store' }),
        fetch('/api/users', { cache: 'no-store' }),
      ]);
      if ([expenseResponse, invoiceResponse, rulesResponse, targetsResponse, usersResponse].some(response => !response.ok)) throw new Error('Live finance data is unavailable.');
      const [expenseData, invoiceData, rulesData, targetsData, usersData] = await Promise.all([expenseResponse.json(), invoiceResponse.json(), rulesResponse.json(), targetsResponse.json(), usersResponse.json()]);
      setExpenses(expenseData.expenses || []);
      setInvoices(invoiceData.invoices || []);
      setRules(rulesData.rules || []); setTargets(targetsData.targets || []); setUsers(usersData.users || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Live finance data is unavailable.');
    }
  };

  useEffect(() => { void load(); }, []);

  const updateExpense = async (expense: Expense, status: 'Approved' | 'Rejected' | 'Paid') => {
    const response = await fetch(`/api/finance/expenses/${expense.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const data = await response.json();
    if (!response.ok) { notify(data.error || 'Unable to update expense.'); return; }
    notify(`${expense.number} marked ${status.toLowerCase()}`);
    void load();
  };

  const saved = (message: string) => { setDialog(null); notify(message); void load(); };
  const pendingTotal = expenses.filter(expense => expense.status === 'Pending').reduce((sum, expense) => sum + Number(expense.amount), 0);
  const outstandingTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.outstanding || 0), 0);
  return <>
    <div className="ops-kpis">
      <LiveKpi label="Pending expenses" value={pendingTotal.toLocaleString(undefined, { style: 'currency', currency: 'USD' })} note={`${expenses.filter(expense => expense.status === 'Pending').length} awaiting review`} icon={<CircleDollarSign size={16}/>} tone="amber"/>
      <LiveKpi label="Outstanding invoices" value={outstandingTotal.toLocaleString(undefined, { style: 'currency', currency: 'USD' })} note={`${invoices.filter(invoice => Number(invoice.outstanding) > 0).length} accounts receivable`} icon={<FileText size={16}/>} tone="blue"/>
      <LiveKpi label="Recorded invoices" value={invoices.length.toString()} note="Payment lifecycle enabled" icon={<Check size={16}/>} tone="green"/>
      <LiveKpi label="Receipts attached" value={expenses.reduce((sum, expense) => sum + Number(expense.attachment_count || 0), 0).toString()} note="S3/local storage" icon={<Paperclip size={16}/>} tone="purple"/>
    </div>
    <div className="workflow-actions crm-actions"><button className="ops-btn blue" onClick={() => setDialog('expense')}><Plus size={15}/> Submit expense</button><button className="link-btn" onClick={() => void load()}>Refresh</button></div>
    {error && <p className="workflow-error" role="alert">{error}</p>}
    <div className="ops-grid-two">
      <LivePanel title="Expenses & approvals" subtitle="Receipt-backed claims with controlled status transitions">
        <div className="data-table"><TableHead labels={['Expense','Submitter','Amount','Status','Action']}/>
          {expenses.map(expense => <div className="data-row" key={expense.id}>
            <div><strong>{expense.number}</strong><small>{expense.category} · {expense.description}</small></div><span>{expense.submitter_name || 'Current user'}</span><span>{Number(expense.amount).toLocaleString(undefined, { style: 'currency', currency: expense.currency || 'USD' })}</span><Status value={expense.status}/>
            <div className="transfer-card-actions">{expense.attachment_count ? <span title="Receipt attached"><Paperclip size={13}/>{expense.attachment_count}</span> : null}{expense.status === 'Pending' && <><button className="row-action" onClick={() => void updateExpense(expense, 'Approved')}><Check size={14}/> Approve</button><button className="row-action" onClick={() => void updateExpense(expense, 'Rejected')}><X size={14}/> Reject</button></>}{expense.status === 'Approved' && <button className="row-action" onClick={() => void updateExpense(expense, 'Paid')}><CircleDollarSign size={14}/> Mark paid</button>}</div>
          </div>)}
          {!expenses.length && <Empty title="No expense claims" detail="Submit the first live expense claim." icon={<CircleDollarSign size={22}/>}/>} 
        </div>
      </LivePanel>
      <LivePanel title="Invoices & payments" subtitle="Record partial payments and close invoices against the outstanding balance">
        <div className="data-table"><TableHead labels={['Invoice','Client','Total','Outstanding','Action']}/>
          {invoices.map(invoice => <div className="data-row" key={invoice.id}><div><strong>{invoice.number}</strong><small>{invoice.sale_number}</small></div><span>{invoice.client_name}</span><span>{Number(invoice.total).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</span><Status value={Number(invoice.outstanding) <= 0 ? 'Paid' : invoice.status}/><button className="row-action" disabled={invoice.status === 'Void' || Number(invoice.outstanding) <= 0} onClick={() => { setSelectedInvoice(invoice); setDialog('payment'); }}><CircleDollarSign size={14}/> Record payment</button></div>)}
          {!invoices.length && <Empty title="No invoices" detail="Invoices generated from confirmed sales will appear here." icon={<FileText size={22}/>}/>} 
        </div>
      </LivePanel>
    </div>
    <LivePanel title="Finance controls" subtitle="Commission rules and consultant targets are configured per organization"><div className="workflow-summary"><div><Users size={14}/><strong>{rules.length} commission rules</strong><button className="link-btn" onClick={() => setDialog('rule')}><Plus size={12}/> Add rule</button></div><div><Check size={14}/><strong>{targets.length} consultant targets</strong><button className="link-btn" onClick={() => setDialog('target')}><Plus size={12}/> Add target</button></div><div><Paperclip size={14}/><strong>Receipt storage</strong>Cloudflare R2 or local adapter</div></div>{rules.length > 0 && <div className="data-table"><TableHead labels={['Rule','Rate','Trigger','Status']}/>{rules.map(rule => <div className="data-row" key={rule.id}><strong>{rule.name}</strong><span>{Number(rule.rate).toFixed(2)}%</span><span>{rule.trigger_status}</span><Status value={rule.is_active ? 'Active' : 'Inactive'}/></div>)}</div>}{targets.length > 0 && <div className="data-table"><TableHead labels={['Consultant','Period','Target','Achieved']}/>{targets.map(target => <div className="data-row" key={target.id}><strong>{target.consultant_name}</strong><span>{target.period_start} → {target.period_end}</span><span>${Number(target.target_amount).toLocaleString()}</span><span className="green-text">${Number(target.achieved).toLocaleString()}</span></div>)}</div>}{!rules.length && !targets.length && <p className="workflow-help">Add the first commission rule or consultant target to make the finance controls visible.</p>}</LivePanel>
    {dialog === 'expense' && <ExpenseDialog close={() => setDialog(null)} saved={() => saved('Expense submitted')}/>} 
    {dialog === 'payment' && selectedInvoice && <PaymentDialog invoice={selectedInvoice} close={() => setDialog(null)} saved={() => saved('Payment recorded')}/>} 
    {dialog === 'rule' && <RuleDialog close={() => setDialog(null)} saved={() => saved('Commission rule created')}/>} 
    {dialog === 'target' && <TargetDialog users={users} close={() => setDialog(null)} saved={() => saved('Consultant target created')}/>} 
  </>;
}

function ExpenseDialog({ close, saved }: { close: () => void; saved: () => void }) {
  const [form, setForm] = useState({ category: 'Travel', description: '', amount: '' });
  const [file, setFile] = useState<File | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { const response = await fetch('/api/finance/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, amount: Number(form.amount) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to submit expense.'); if (file) { const upload = new FormData(); upload.set('entityType', 'expense'); upload.set('entityId', data.expense.id); upload.set('file', file); const uploadResponse = await fetch('/api/attachments', { method: 'POST', body: upload }); if (!uploadResponse.ok) throw new Error('Expense saved, but the receipt upload failed.'); } saved(); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Unable to submit expense.'); } finally { setBusy(false); } };
  return <Dialog title="Submit expense" close={close}><form className="workflow-form" onSubmit={submit}><Field label="Category"><select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}><option>Travel</option><option>Client meeting</option><option>Equipment</option><option>Office</option><option>Other</option></select></Field><Field label="Description"><textarea required rows={3} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })}/></Field><Field label="Amount (USD)"><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })}/></Field><Field label="Receipt (optional)"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setFile(event.target.files?.[0] || null)}/></Field>{error && <p className="workflow-error">{error}</p>}<Actions close={close} label={busy ? 'Submitting…' : 'Submit expense'} disabled={busy}/></form></Dialog>;
}

function PaymentDialog({ invoice, close, saved }: { invoice: Invoice; close: () => void; saved: () => void }) {
  const [form, setForm] = useState({ amount: Number(invoice.outstanding).toFixed(2), method: 'Bank transfer', reference: '' }); const [error, setError] = useState('');
  const submit = async (event: FormEvent) => { event.preventDefault(); const response = await fetch(`/api/crm/invoices/${invoice.id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, amount: Number(form.amount) }) }); const data = await response.json(); if (!response.ok) { setError(data.error || 'Unable to record payment.'); return; } saved(); };
  return <Dialog title={`Record payment · ${invoice.number}`} close={close}><form className="workflow-form" onSubmit={submit}><p className="workflow-help">Outstanding balance: <strong>${Number(invoice.outstanding).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></p><Field label="Amount (USD)"><input required type="number" min="0.01" max={invoice.outstanding} step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })}/></Field><Field label="Method"><select value={form.method} onChange={event => setForm({ ...form, method: event.target.value })}><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Mobile money</option><option>Other</option></select></Field><Field label="Reference"><input value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })}/></Field>{error && <p className="workflow-error">{error}</p>}<Actions close={close} label="Record payment"/></form></Dialog>;
}

function RuleDialog({ close, saved }: { close: () => void; saved: () => void }) { const [form, setForm] = useState({ name: '', rate: '5', triggerStatus: 'Confirmed' }); const [error, setError] = useState(''); const submit = async (event: FormEvent) => { event.preventDefault(); const response = await fetch('/api/finance/commission-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, rate: Number(form.rate) }) }); const data = await response.json(); if (!response.ok) { setError(data.error || 'Unable to create rule.'); return; } saved(); }; return <Dialog title="Add commission rule" close={close}><form className="workflow-form" onSubmit={submit}><Field label="Rule name"><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></Field><Field label="Rate (%)"><input required type="number" min="0" max="100" step="0.01" value={form.rate} onChange={event => setForm({ ...form, rate: event.target.value })}/></Field><Field label="Trigger"><select value={form.triggerStatus} onChange={event => setForm({ ...form, triggerStatus: event.target.value })}><option>Confirmed</option><option>Delivered</option><option>Paid</option></select></Field>{error && <p className="workflow-error">{error}</p>}<Actions close={close} label="Save rule"/></form></Dialog>; }
function TargetDialog({ users, close, saved }: { users: User[]; close: () => void; saved: () => void }) { const [form, setForm] = useState({ consultantId: users[0]?.id || '', periodStart: `${new Date().getFullYear()}-01-01`, periodEnd: `${new Date().getFullYear()}-12-31`, targetAmount: '' }); const [error, setError] = useState(''); const submit = async (event: FormEvent) => { event.preventDefault(); const response = await fetch('/api/finance/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, targetAmount: Number(form.targetAmount) }) }); const data = await response.json(); if (!response.ok) { setError(data.error || 'Unable to create target.'); return; } saved(); }; return <Dialog title="Set consultant target" close={close}><form className="workflow-form" onSubmit={submit}><Field label="Consultant"><select required value={form.consultantId} onChange={event => setForm({ ...form, consultantId: event.target.value })}>{users.map(user => <option key={user.id} value={user.id}>{user.full_name} · {user.role}</option>)}</select></Field><div className="workflow-form-grid"><Field label="Start date"><input required type="date" value={form.periodStart} onChange={event => setForm({ ...form, periodStart: event.target.value })}/></Field><Field label="End date"><input required type="date" value={form.periodEnd} onChange={event => setForm({ ...form, periodEnd: event.target.value })}/></Field></div><Field label="Target amount (USD)"><input required type="number" min="0" step="0.01" value={form.targetAmount} onChange={event => setForm({ ...form, targetAmount: event.target.value })}/></Field>{error && <p className="workflow-error">{error}</p>}<Actions close={close} label="Save target"/></form></Dialog>; }

function Dialog({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) { return <div className="workflow-dialog-backdrop"><div className="workflow-dialog" role="dialog" aria-modal="true"><div className="workflow-dialog-head"><h3>{title}</h3><button onClick={close} aria-label="Close"><X size={16}/></button></div>{children}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="workflow-field"><span>{label}</span>{children}</label>; }
function Actions({ close, label, disabled }: { close: () => void; label: string; disabled?: boolean }) { return <div className="workflow-dialog-actions"><button type="button" className="ops-btn ghost" onClick={close}>Cancel</button><button className="ops-btn blue" disabled={disabled}>{label}</button></div>; }
function LivePanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="ops-panel"><div className="ops-panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>; }
function TableHead({ labels }: { labels: string[] }) { return <div className="table-head ops-table-head">{labels.map(label => <span key={label}>{label}</span>)}</div>; }
function Status({ value }: { value: string }) { const key = value.toLowerCase().replaceAll(' ', '-'); return <span className={`status ${key}`}>{value}</span>; }
function LiveKpi({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: React.ReactNode; tone: string }) { return <div className="ops-kpi"><span className={`kpi-icon ${tone}`}>{icon}</span><strong>{value}</strong><span>{label}</span><small>{note}</small></div>; }
function Empty({ title, detail, icon }: { title: string; detail: string; icon: React.ReactNode }) { return <div className="empty-state">{icon}<strong>{title}</strong><span>{detail}</span></div>; }
