'use client';

import { useEffect, useMemo, useState } from 'react';
import { Boxes, Check, CircleDollarSign, ClipboardCheck, PackageCheck, Search, Truck } from 'lucide-react';

type InventoryItem = { id: string; serial_number: string; sku: string; description: string; location: string; status: string; client_name?: string };
type Summary = { total: number; available: number; reserved: number; in_transit: number; sold: number; installed: number; warranty: number };
type Transfer = { id: string; number: string; source_location: string; destination_location: string; status: string; items: Array<{ id: string; serialNumber: string; sku: string }> };

export default function InventoryWorkspace({ query, notify }: { query: string; notify: (message: string) => void }) {
  const [summary, setSummary] = useState<Summary>({ total: 0, available: 0, reserved: 0, in_transit: 0, sold: 0, installed: 0, warranty: 0 });
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [serial, setSerial] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [summaryResponse, inventoryResponse, transfersResponse] = await Promise.all([
        fetch('/api/inventory/summary', { cache: 'no-store' }),
        fetch(`/api/inventory${query ? `?q=${encodeURIComponent(query)}` : ''}`, { cache: 'no-store' }),
        fetch('/api/inventory/transfers', { cache: 'no-store' }),
      ]);
      if (!summaryResponse.ok || !inventoryResponse.ok || !transfersResponse.ok) throw new Error('Live inventory data is unavailable.');
      const summaryData = await summaryResponse.json(); const inventoryData = await inventoryResponse.json(); const transferData = await transfersResponse.json();
      setSummary(summaryData.summary || {}); setItems(inventoryData.inventory || []); setTransfers(transferData.transfers || []);
      if (!source && inventoryData.inventory?.[0]) setSource(inventoryData.inventory[0].location);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Live inventory data is unavailable.'); }
  };

  useEffect(() => { void load(); }, [query]);
  const availableItems = useMemo(() => items.filter(item => item.status === 'Available'), [items]);
  const locations = useMemo(() => Array.from(new Set(items.map(item => item.location).filter(Boolean))), [items]);
  const found = items.find(item => item.serial_number.toLowerCase() === serial.trim().toLowerCase());

  const createTransfer = async () => {
    if (!selected.length || !source || !destination) { setError('Choose available items, a source, and a different destination.'); return; }
    const response = await fetch('/api/inventory/transfers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceLocation: source, destinationLocation: destination, inventoryItemIds: selected }) });
    const data = await response.json(); if (!response.ok) { setError(data.error || 'Unable to create transfer.'); return; }
    setSelected([]); notify(`${data.transfer.number} dispatched`); await load();
  };
  const receiveTransfer = async (transfer: Transfer) => {
    const response = await fetch(`/api/inventory/transfers/${transfer.id}/receive`, { method: 'POST' }); const data = await response.json();
    if (!response.ok) { setError(data.error || 'Unable to receive transfer.'); return; } notify(`${transfer.number} received`); await load();
  };
  const createShipment = async (transfer: Transfer) => {
    const response = await fetch('/api/inventory/shipments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transferId: transfer.id, carrier, trackingNumber: tracking, status: 'Dispatched' }) }); const data = await response.json();
    if (!response.ok) { setError(data.error || 'Unable to create shipment.'); return; } setCarrier(''); setTracking(''); notify(`${data.shipment.number} created`);
  };

  return <>
    <div className="ops-kpis">
      <LiveKpi label="Available devices" value={summary.available} note={`${summary.total} total serialized units`} icon={<Boxes size={16}/>} tone="blue"/>
      <LiveKpi label="Reserved" value={summary.reserved} note={`${summary.in_transit} in transit`} icon={<ClipboardCheck size={16}/>} tone="amber"/>
      <LiveKpi label="Installed / sold" value={summary.installed + summary.sold} note={`${summary.warranty} in warranty service`} icon={<Truck size={16}/>} tone="purple"/>
      <LiveKpi label="Serialized stock" value={summary.total} note="Live PostgreSQL count" icon={<CircleDollarSign size={16}/>} tone="green"/>
    </div>
    <div className="trace-search"><div><span className="ops-kicker">Serial traceability</span><h2>Find a live device</h2><p>Searches current inventory state, location, and client assignment.</p></div><div className="serial-field"><Search size={15}/><input value={serial} onChange={e => setSerial(e.target.value)} placeholder="Enter serial, e.g. POS-884021"/><button onClick={() => notify(found ? `${found.serial_number} found` : 'No device found')}>Check</button></div></div>
    {serial && <div className="trace-result">{found ? <div className="trace-device"><span className="device-icon"><Boxes size={18}/></span><div><strong>{found.serial_number}</strong><span>{found.sku} · {found.description}</span></div><Status value={found.status}/></div> : <div className="empty-state"><Search size={22}/><strong>No matching device</strong><span>Check the serial formatting and try again.</span></div>}</div>}
    <Panel title="Live device register" subtitle="Every row is read from serialized inventory" actions={<button className="link-btn" onClick={() => void load()}><Check size={14}/> Refresh</button>}><div className="data-table"><TableHead labels={['Serial / product','Location','Status','Client','Action']}/>{items.map(item => <div className="data-row" key={item.id}><div><strong>{item.serial_number}</strong><small>{item.sku} · {item.description}</small></div><span>{item.location}</span><Status value={item.status}/><span>{item.client_name || '—'}</span><button className="row-action" onClick={() => { setSerial(item.serial_number); notify(`${item.serial_number} trace opened`); }}>Trace</button></div>)}{!items.length && <div className="empty-state"><Boxes size={22}/><strong>No inventory records</strong><span>Receive serialized stock to populate this register.</span></div>}</div></Panel>
    <Panel title="Transfers and shipping" subtitle="Dispatch available serials, receive them at destination, and attach shipment tracking"><div className="transfer-form"><label><span>Source</span><select value={source} onChange={e => setSource(e.target.value)}><option value="">Select source</option>{locations.map(location => <option key={location}>{location}</option>)}</select></label><label><span>Destination</span><input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Bulawayo Branch"/></label><button className="ops-btn blue" onClick={() => void createTransfer()}>Dispatch selected</button></div><div className="data-table"><TableHead labels={['Select','Serial','SKU','Location','Status']}/>{availableItems.slice(0, 20).map(item => <div className="data-row transfer-row" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/><strong>{item.serial_number}</strong><span>{item.sku}</span><span>{item.location}</span><Status value={item.status}/></div>)}</div>{transfers.length > 0 && <div className="transfer-list">{transfers.slice(0, 8).map(transfer => <div className="transfer-card" key={transfer.id}><div><strong>{transfer.number}</strong><span>{transfer.source_location} → {transfer.destination_location} · {transfer.items.length} serials</span></div><Status value={transfer.status}/><div className="transfer-card-actions">{transfer.status === 'In transit' && <button className="row-action" onClick={() => void receiveTransfer(transfer)}><PackageCheck size={14}/> Receive</button>}{transfer.status === 'In transit' && <><input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="Carrier"/><input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Tracking no."/><button className="row-action" onClick={() => void createShipment(transfer)}><Truck size={14}/> Ship</button></>}</div></div>)}</div>}{error && <p className="workflow-error" role="alert">{error}</p>}</Panel>
  </>;
}

function LiveKpi({ label, value, note, icon, tone }: { label: string; value: number; note: string; icon: React.ReactNode; tone: string }) { return <div className="ops-kpi"><span className={`kpi-icon ${tone}`}>{icon}</span><strong>{value.toLocaleString()}</strong><span>{label}</span><small>{note}</small></div>; }
function Panel({ title, subtitle, actions, children }: { title: string; subtitle: string; actions?: React.ReactNode; children: React.ReactNode }) { return <section className="ops-panel"><div className="ops-panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{actions}</div>{children}</section>; }
function TableHead({ labels }: { labels: string[] }) { return <div className="table-head ops-table-head">{labels.map(label => <span key={label}>{label}</span>)}</div>; }
function Status({ value }: { value: string }) { const key = value.toLowerCase().replaceAll(' ', '-'); return <span className={`status ${key}`}>{value}</span>; }
