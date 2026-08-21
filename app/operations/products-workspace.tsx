'use client';

import { useEffect, useState } from 'react';
import { Boxes, Laptop, Pencil, Plus, Save, Search, X } from 'lucide-react';
import { formatCurrency, useOrganizationSettings } from '../organization-settings';
import { normalizeRole } from '@/lib/rbac';
import { useDialogFocus } from '../dialog-focus';

type Product = { id: string; supplier_id: string; supplier_name: string; product_type: 'Laptop' | 'POS'; product_name: string; manufacturer?: string; model?: string; sku: string; warranty_months: number; cost_price?: string | number | null; selling_price: string | number; currency: string; serial_required: boolean; stock_count: number; available_count: number };
type Supplier = { id: string; name: string; code: string; status: string };

export default function ProductsWorkspace({ query = '', notify, role }: { query?: string; notify: (message: string) => void; role: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);
  const settings = useOrganizationSettings();
  const canEdit = ['ceo', 'manager'].includes(normalizeRole(role));

  const load = async () => {
    setError('');
    const response = await fetch(`/api/products${query ? `?q=${encodeURIComponent(query)}` : ''}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) { setError(data.error || 'Products are unavailable.'); return; }
    setProducts(data.products || []);
  };

  useEffect(() => { void load(); }, [query]);

  const openAdd = async () => {
    const response = await fetch('/api/suppliers', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) { setError(data.error || 'Unable to load suppliers.'); return; }
    setSuppliers((data.suppliers || []).filter((supplier: Supplier) => supplier.status === 'Active'));
    setAdding(true);
  };

  const margin = (product: Product) => {
    if (product.cost_price === null || product.cost_price === undefined) return null;
    const value = Number(product.selling_price) - Number(product.cost_price);
    return { value, percent: Number(product.selling_price) > 0 ? (value / Number(product.selling_price)) * 100 : 0 };
  };

  return <>
    <div className="ops-kpis">
      <Kpi label="Products" value={products.length} note="Active serialized catalog" icon={<Boxes size={16}/>} tone="blue"/>
      <Kpi label="Available units" value={products.reduce((sum, product) => sum + product.available_count, 0)} note="Live stock count" icon={<Save size={16}/>} tone="green"/>
      <Kpi label="Laptop products" value={products.filter(product => product.product_type === 'Laptop').length} note="Serial required" icon={<Laptop size={16}/>} tone="purple"/>
      <Kpi label="POS products" value={products.filter(product => product.product_type === 'POS').length} note="Serial required" icon={<Boxes size={16}/>} tone="amber"/>
    </div>
    <section className="ops-panel">
      <div className="ops-panel-head">
        <div><h2>Product master and pricing</h2><p>Every product is serialized. Cost is sourced from suppliers; selling price and margin are controlled here.</p></div>
        <div className="product-panel-actions"><span className="workflow-help"><Search size={13}/> {query || 'All products'}</span>{canEdit && <button className="ops-btn blue" onClick={() => void openAdd()}><Plus size={15}/> Add product</button>}</div>
      </div>
      {error && <p className="workflow-error" role="alert">{error}</p>}
      <div className="data-table">
        <div className="table-head ops-table-head"><span>Product</span><span>Supplier</span><span>Stock</span><span>Cost price</span><span>Selling price</span><span>Margin</span><span>Action</span></div>
        {products.map(product => { const productMargin = margin(product); return <div className="data-row" key={product.id}>
          <div><strong>{product.product_name}</strong><small>{product.product_type} · {product.sku} · {product.warranty_months} month warranty</small></div>
          <span>{product.supplier_name}</span>
          <span>{product.available_count}/{product.stock_count} available</span>
          <span>{product.cost_price == null ? '—' : formatCurrency(product.cost_price, settings.currency)}</span>
          <span>{formatCurrency(product.selling_price, settings.currency)}</span>
          <span>{productMargin ? <><strong className={productMargin.value >= 0 ? 'green-text' : 'amber-text'}>{formatCurrency(productMargin.value, settings.currency)}</strong><small>{productMargin.percent.toFixed(1)}% of selling price</small></> : '—'}</span>
          {canEdit ? <button className="row-action" onClick={() => setEditing(product)}><Pencil size={13}/> Edit</button> : <span className="workflow-help">Read-only</span>}
        </div>; })}
        {!products.length && <div className="empty-state"><Boxes size={22}/><strong>No products found</strong><span>{canEdit ? 'Add a serialized Laptop or POS product to begin.' : 'No active products are available.'}</span></div>}
      </div>
    </section>
    {(adding || editing) && <ProductDialog product={editing} suppliers={suppliers} close={() => { setAdding(false); setEditing(null); }} saved={() => { setAdding(false); setEditing(null); notify(editing ? 'Product updated' : 'Product created'); void load(); }} />}
  </>;
}

function ProductDialog({ product, suppliers, close, saved }: { product: Product | null; suppliers: Supplier[]; close: () => void; saved: () => void }) {
  const [form, setForm] = useState({ supplierId: product?.supplier_id || suppliers[0]?.id || '', productType: product?.product_type || 'Laptop', productName: product?.product_name || '', manufacturer: product?.manufacturer || '', model: product?.model || '', sku: product?.sku || '', warrantyMonths: String(product?.warranty_months ?? 12), costPrice: String(product?.cost_price ?? 0), sellingPrice: String(product?.selling_price ?? 0), currency: product?.currency || 'USD' });
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    const endpoint = product ? `/api/products/${product.id}` : '/api/products';
    const body = { ...form, warrantyMonths: Number(form.warrantyMonths), costPrice: Number(form.costPrice), sellingPrice: Number(form.sellingPrice), ...(product ? {} : { supplierId: form.supplierId }) };
    const response = await fetch(endpoint, { method: product ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error || 'Unable to save product.'); return; }
    saved();
  };
  const dialogRef = useDialogFocus<HTMLDivElement>(close);
  return <div className="workflow-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={dialogRef} className="workflow-dialog" role="dialog" aria-modal="true" aria-label={product ? 'Edit product' : 'Add product'} tabIndex={-1}><div className="workflow-dialog-head"><h3>{product ? `Edit ${product.product_name}` : 'Add serialized product'}</h3><button onClick={close} aria-label="Close"><X size={16}/></button></div><form className="workflow-form" onSubmit={submit}>
    {!product && <Field label="Supplier"><select required value={form.supplierId} onChange={event => setForm({ ...form, supplierId: event.target.value })}><option value="">Select supplier</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></Field>}
    <div className="stock-type-grid"><button type="button" className={form.productType === 'Laptop' ? 'stock-type selected' : 'stock-type'} onClick={() => setForm({ ...form, productType: 'Laptop' })}><Laptop size={20}/><strong>Laptop</strong><span>Serial required</span></button><button type="button" className={form.productType === 'POS' ? 'stock-type selected' : 'stock-type'} onClick={() => setForm({ ...form, productType: 'POS' })}><Boxes size={20}/><strong>POS</strong><span>Serial required</span></button></div>
    <Field label="Product name"><input required value={form.productName} onChange={event => setForm({ ...form, productName: event.target.value })}/></Field>
    <div className="workflow-form-grid"><Field label="SKU"><input required value={form.sku} onChange={event => setForm({ ...form, sku: event.target.value })}/></Field><Field label="Warranty (months)"><input required type="number" min="0" max="120" value={form.warrantyMonths} onChange={event => setForm({ ...form, warrantyMonths: event.target.value })}/></Field></div>
    <div className="workflow-form-grid"><Field label="Manufacturer"><input value={form.manufacturer} onChange={event => setForm({ ...form, manufacturer: event.target.value })}/></Field><Field label="Model"><input value={form.model} onChange={event => setForm({ ...form, model: event.target.value })}/></Field></div>
    <div className="workflow-form-grid"><Field label="Cost price"><input required type="number" min="0" step="0.01" value={form.costPrice} onChange={event => setForm({ ...form, costPrice: event.target.value })}/></Field><Field label="Selling price"><input required type="number" min="0" step="0.01" value={form.sellingPrice} onChange={event => setForm({ ...form, sellingPrice: event.target.value })}/></Field></div>
    <Field label="Currency"><select value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}><option>USD</option><option>ZAR</option><option>GBP</option><option>EUR</option><option>BWP</option><option>ZWL</option></select></Field>
    {error && <p className="workflow-error" role="alert">{error}</p>}<div className="workflow-dialog-actions"><button type="button" className="ops-btn ghost" onClick={close}>Cancel</button><button className="ops-btn blue" disabled={saving || (!product && !suppliers.length)}>{saving ? 'Saving…' : product ? 'Save product' : 'Create product'}</button></div>
  </form></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="workflow-field"><span>{label}</span>{children}</label>; }
function Kpi({ label, value, note, icon, tone }: { label: string; value: number; note: string; icon: React.ReactNode; tone: string }) { return <div className="ops-kpi"><span className={`kpi-icon ${tone}`}>{icon}</span><strong>{value.toLocaleString()}</strong><span>{label}</span><small>{note}</small></div>; }
