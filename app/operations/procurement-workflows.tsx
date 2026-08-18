'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Boxes, PackageCheck, Plus, RefreshCw, ShoppingCart, Users, X } from 'lucide-react';

type Supplier = { id: string; code: string; name: string; contact_name?: string; status: string };
type PurchaseOrder = { id: string; number: string; supplier_name: string; destination?: string; status: string; ordered_quantity: number; received_quantity: number };
type PurchaseOrderItem = { id: string; sku: string; description: string; quantity: number; receivedQuantity: number };
type PurchaseOrderDetail = PurchaseOrder & { items: PurchaseOrderItem[] };

export default function ProcurementWorkflows({ notify }: { notify: (message: string) => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'supplier' | 'order' | 'receive' | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderDetail | null>(null);

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const [supplierResponse, orderResponse] = await Promise.all([
        fetch('/api/suppliers', { cache: 'no-store' }),
        fetch('/api/purchase-orders', { cache: 'no-store' }),
      ]);
      if (!supplierResponse.ok || !orderResponse.ok) throw new Error('Live procurement data is unavailable.');
      const supplierData = await supplierResponse.json();
      const orderData = await orderResponse.json();
      setSuppliers(supplierData.suppliers || []);
      setOrders(orderData.purchaseOrders || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Live procurement data is unavailable.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openReceive = async (orderId: string) => {
    setError('');
    const response = await fetch(`/api/purchase-orders/${orderId}`, { cache: 'no-store' });
    if (!response.ok) { setError('Could not load purchase order lines.'); return; }
    const data = await response.json();
    setSelectedOrder(data.purchaseOrder);
    setDialog('receive');
  };

  return <section className="ops-panel workflow-panel">
    <div className="ops-panel-head">
      <div><h2>Connected procurement workflows</h2><p>These actions write to PostgreSQL and preserve receiving and reservation rules.</p></div>
      <button className="link-btn" onClick={() => void load()} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''}/> Refresh</button>
    </div>
    <div className="workflow-summary">
      <div><Users size={15}/><span><strong>{suppliers.length}</strong> live suppliers</span></div>
      <div><ShoppingCart size={15}/><span><strong>{orders.length}</strong> live purchase orders</span></div>
      <div><Boxes size={15}/><span>Serialized receipts enabled</span></div>
    </div>
    <div className="workflow-actions">
      <button className="ops-btn ghost" onClick={() => setDialog('supplier')}><Plus size={15}/> Add supplier</button>
      <button className="ops-btn blue" onClick={() => setDialog('order')} disabled={!suppliers.length}><Plus size={15}/> Create purchase order</button>
    </div>
    {error && <p className="workflow-error" role="alert">{error}</p>}
    {orders.length > 0 && <div className="workflow-receiving"><strong>Receive a live purchase order</strong><div>{orders.filter(order => order.received_quantity < order.ordered_quantity).slice(0, 4).map(order => <button key={order.id} className="workflow-order" onClick={() => void openReceive(order.id)}><span>{order.number} · {order.supplier_name}</span><small>{order.received_quantity}/{order.ordered_quantity} received <PackageCheck size={13}/></small></button>)}</div></div>}
    {dialog === 'supplier' && <SupplierDialog close={() => setDialog(null)} onSaved={() => { setDialog(null); notify('Supplier created'); void load(); }}/>} 
    {dialog === 'order' && <OrderDialog suppliers={suppliers} close={() => setDialog(null)} onSaved={() => { setDialog(null); notify('Purchase order created'); void load(); }}/>} 
    {dialog === 'receive' && selectedOrder && <ReceiveDialog order={selectedOrder} close={() => { setDialog(null); setSelectedOrder(null); }} onSaved={() => { setDialog(null); setSelectedOrder(null); notify('Goods receipt posted and serial inventory created'); void load(); }}/>} 
  </section>;
}

function Dialog({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  return <div className="workflow-dialog-backdrop" role="presentation"><div className="workflow-dialog" role="dialog" aria-modal="true" aria-label={title}><div className="workflow-dialog-head"><h3>{title}</h3><button onClick={close} aria-label="Close"><X size={16}/></button></div>{children}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="workflow-field"><span>{label}</span>{children}</label>; }

function SupplierDialog({ close, onSaved }: { close: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', contactName: '', phone: '', paymentTerms: '30 days', leadTimeDays: '14' });
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); const response = await fetch('/api/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, leadTimeDays: Number(form.leadTimeDays) }) }); const data = await response.json(); setSaving(false); if (!response.ok) { setError(data.error || 'Unable to create supplier.'); return; } onSaved(); };
  return <Dialog title="Add supplier" close={close}><form className="workflow-form" onSubmit={submit}><Field label="Supplier name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="Contact name"><input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })}/></Field><Field label="Phone"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></Field><div className="workflow-form-grid"><Field label="Payment terms"><input value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })}/></Field><Field label="Lead time (days)"><input type="number" min="0" value={form.leadTimeDays} onChange={e => setForm({ ...form, leadTimeDays: e.target.value })}/></Field></div>{error && <p className="workflow-error" role="alert">{error}</p>}<div className="workflow-dialog-actions"><button type="button" className="ops-btn ghost" onClick={close}>Cancel</button><button className="ops-btn blue" disabled={saving}>{saving ? 'Saving…' : 'Save supplier'}</button></div></form></Dialog>;
}

function OrderDialog({ suppliers, close, onSaved }: { suppliers: Supplier[]; close: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ supplierId: suppliers[0]?.id || '', destination: 'Harare warehouse', sku: '', description: '', quantity: '1', unitCost: '0', expectedAt: '' });
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); const response = await fetch('/api/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierId: form.supplierId, destination: form.destination, expectedAt: form.expectedAt || undefined, items: [{ sku: form.sku, description: form.description, quantity: Number(form.quantity), unitCost: Number(form.unitCost) }] }) }); const data = await response.json(); setSaving(false); if (!response.ok) { setError(data.error || 'Unable to create purchase order.'); return; } onSaved(); };
  return <Dialog title="Create purchase order" close={close}><form className="workflow-form" onSubmit={submit}><Field label="Supplier"><select required value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></Field><Field label="Destination"><input required value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })}/></Field><div className="workflow-form-grid"><Field label="SKU"><input required value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })}/></Field><Field label="Quantity"><input required type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}/></Field></div><Field label="Description"><input required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field><div className="workflow-form-grid"><Field label="Unit cost"><input required type="number" min="0" step="0.01" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })}/></Field><Field label="Expected date"><input type="date" value={form.expectedAt} onChange={e => setForm({ ...form, expectedAt: e.target.value })}/></Field></div>{error && <p className="workflow-error" role="alert">{error}</p>}<div className="workflow-dialog-actions"><button type="button" className="ops-btn ghost" onClick={close}>Cancel</button><button className="ops-btn blue" disabled={saving}>{saving ? 'Saving…' : 'Create order'}</button></div></form></Dialog>;
}

function ReceiveDialog({ order, close, onSaved }: { order: PurchaseOrderDetail; close: () => void; onSaved: () => void }) {
  const line = order.items.find(item => item.receivedQuantity < item.quantity);
  const remaining = line ? line.quantity - line.receivedQuantity : 0;
  const [quantity, setQuantity] = useState(String(Math.max(1, remaining))); const [serialNumbers, setSerialNumbers] = useState(''); const [location, setLocation] = useState(order.destination || 'Main warehouse'); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!line) return; setSaving(true); setError(''); const serials = serialNumbers.split(/[\n,]+/).map(value => value.trim()).filter(Boolean); const response = await fetch(`/api/purchase-orders/${order.id}/receive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location, items: [{ purchaseOrderItemId: line.id, quantity: Number(quantity), serialNumbers }] }) }); const data = await response.json(); setSaving(false); if (!response.ok) { setError(data.error || 'Unable to receive stock.'); return; } onSaved(); };
  return <Dialog title={`Receive ${order.number}`} close={close}>{line ? <form className="workflow-form" onSubmit={submit}><p className="workflow-help">{line.sku} · {line.description} · {remaining} units outstanding. Enter one unique serial number per received unit.</p><Field label="Quantity"><input required type="number" min="1" max={remaining} value={quantity} onChange={e => setQuantity(e.target.value)}/></Field><Field label="Serial numbers"><textarea required rows={4} value={serialNumbers} onChange={e => setSerialNumbers(e.target.value)} placeholder="SN-001, SN-002"/></Field><Field label="Location"><input required value={location} onChange={e => setLocation(e.target.value)}/></Field>{error && <p className="workflow-error" role="alert">{error}</p>}<div className="workflow-dialog-actions"><button type="button" className="ops-btn ghost" onClick={close}>Cancel</button><button className="ops-btn blue" disabled={saving}>{saving ? 'Posting…' : 'Post goods receipt'}</button></div></form> : <div className="empty-state"><PackageCheck size={22}/><strong>Nothing outstanding</strong><span>This purchase order is fully received.</span></div>}</Dialog>;
}
