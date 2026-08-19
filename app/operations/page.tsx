'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, ArrowUpRight, Boxes, BriefcaseBusiness, Check, ChevronDown, CircleDollarSign, ClipboardCheck, Download, FileText, Filter, Laptop, PackageCheck, Plus, Search, Settings2, ShieldCheck, ShoppingCart, Truck, Upload, Users, Wrench, X, Zap } from 'lucide-react';
import { clients, devices, expenses, jobs, moduleMeta, people, presales, purchaseOrders, reportRows, suppliers, warranties, type OpsModule } from '@/lib/ops-data';
import ProcurementWorkflows from './procurement-workflows';
import InventoryWorkspace from './inventory-workspace';
import CrmWorkspace from './crm-workspace';
import FinanceWorkspace from './finance-workspace';
import ReportsWorkspace from './reports-workspace';
import { JobsWorkspace, WarrantyWorkspace } from './service-workspace';
import './ops.css';

type Tab = 'overview' | 'records' | 'trace';
const modules: OpsModule[] = ['Procurement','Inventory','Sales & CRM','Job cards','Warranty','Finance & HR','Reports'];
type User = { fullName: string };

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';
}

export default function OperationsPage() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const requested = params?.get('module') as OpsModule | null;
  const [module, setModule] = useState<OpsModule>(requested && modules.includes(requested) ? requested : 'Inventory');
  const [tab, setTab] = useState<Tab>('overview'); const [query, setQuery] = useState(''); const [toast, setToast] = useState(''); const [serial, setSerial] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const meta = moduleMeta[module];
  useEffect(() => { void fetch('/api/auth/me', { cache: 'no-store' }).then(async response => { if (!response.ok) { window.location.href = '/login'; return; } const data = await response.json(); setUser(data.user); }).catch(() => { window.location.href = '/login'; }); }, []);
  const notify = (message:string) => { setToast(message); window.setTimeout(()=>setToast(''),2500); };
  const goToProfile = () => { window.location.href = '/profile'; };
  const goToConfiguration = () => { window.location.href = '/configuration'; };
  const setModuleAndReset = (next:OpsModule) => { setModule(next); setTab('overview'); setQuery(''); window.history.replaceState(null,'',`/operations?module=${encodeURIComponent(next)}`); };
  const data = useMemo(() => query.toLowerCase(), [query]);
  const match = (values:unknown[]) => values.join(' ').toLowerCase().includes(data);
  const foundDevice = devices.find(device => device.serial.toLowerCase() === serial.trim().toLowerCase());
  return <div className="ops-shell"><aside className="ops-rail"><a className="ops-brand" href="/"><Image className="ops-logo" src="/iPaytechLogo.jpg" alt="iPayTech" width={160} height={67} priority /></a><div className="ops-rail-title">OPERATIONS</div>{modules.map(item=><button key={item} className={module===item?'ops-nav active':'ops-nav'} onClick={()=>setModuleAndReset(item)}>{iconFor(item)}<span>{item}</span>{item==='Inventory'&&<b>1,248</b>}</button>)}<div className="ops-rail-bottom"><button className="ops-nav" onClick={goToConfiguration}><Settings2 size={16}/><span>Configuration</span></button><a className="back-dashboard" href="/"><ArrowLeft size={15}/> Dashboard</a></div></aside><main className="ops-main"><header className="ops-top"><div className="ops-breadcrumb"><a href="/">Overview</a><span>/</span><strong>{meta.title}</strong></div><div className="ops-top-actions"><div className="ops-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search this module..."/><kbd>⌘ K</kbd></div><button className="ops-avatar" onClick={goToProfile} title="Open profile" aria-label="Open profile">{initials(user?.fullName || 'User')}</button></div></header><div className="ops-content"><div className="ops-heading"><div><span className="ops-kicker">Operations workspace</span><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="ops-heading-actions"><button className="ops-btn ghost" onClick={()=>notify('Import workflow opened')}><Upload size={15}/> Import</button><button className="ops-btn blue" onClick={()=>notify(`New ${module.toLowerCase()} record started`)}><Plus size={16}/> New record</button></div></div><div className="module-strip">{modules.map(item=><button key={item} className={module===item?'module-chip selected':'module-chip'} onClick={()=>setModuleAndReset(item)}>{iconFor(item)}{item}</button>)}</div>{module==='Procurement'&&<Procurement query={data} match={match} notify={notify}/>} {module==='Inventory'&&<Inventory query={data} match={match} serial={serial} setSerial={setSerial} foundDevice={foundDevice} notify={notify}/>} {module==='Sales & CRM'&&<Sales query={data} match={match} notify={notify}/>} {module==='Job cards'&&<Jobs query={data} match={match} notify={notify}/>} {module==='Warranty'&&<Warranty query={data} match={match} serial={serial} setSerial={setSerial} foundDevice={foundDevice} notify={notify}/>} {module==='Finance & HR'&&<FinanceHR query={data} match={match} notify={notify}/>} {module==='Reports'&&<Reports notify={notify}/>}<div className="ops-footer"><span><span className="status-dot"/> Database-sourced view · Last synced just now</span><span>Timezone: Africa/Harare · Currency: USD</span></div></div></main>{toast&&<div className="ops-toast"><span><Check size={13}/></span>{toast}</div>}</div>
}

function Procurement({query,match,notify}:{query:string;match:(v:unknown[])=>boolean;notify:(m:string)=>void}) { const po=purchaseOrders.filter(x=>match([x.number,x.supplier,x.status])); return <><Kpis items={[['Open POs','12','3 due this week',ShoppingCart,'blue'],['On order','$102,380','84 units outstanding',Truck,'amber'],['Suppliers','18','3 active delivery risks',Users,'purple'],['Avg. lead time','14 days','-2 days vs. last month',Zap,'green']]}/><ProcurementWorkflows notify={notify}/><div className="ops-grid-two"><Panel title="Purchase orders" subtitle="Approval, receiving, and delivery commitments" actions={<ExportActions notify={notify}/>}>{po.map((x,i)=><RecordRow key={x.id} icon={<ShoppingCart size={15}/>} tone={i===0?'amber':'blue'} primary={x.number} secondary={`${x.supplier} · ${x.destination}`} status={x.status} right={`${x.received}/${x.ordered} received`} meta={`Due ${x.due}`} onClick={()=>notify(`${x.number} opened`)}/>)}</Panel><Panel title="Supplier directory" subtitle="Active supplier relationships" actions={<button className="link-btn" onClick={()=>notify('Use the connected workflow above to add a supplier')}><Plus size={14}/> Add supplier</button>}>{suppliers.map((x,i)=><RecordRow key={x.id} icon={<Users size={15}/>} tone={i===1?'green':'purple'} primary={x.name} secondary={`${x.code} · ${x.contact}`} status={x.status} right={x.terms} meta={`Lead time ${x.lead}`} onClick={()=>notify(`${x.name} opened`)}/>)}</Panel></div><Panel title="Receiving queue" subtitle="Partial deliveries preserve the outstanding balance"><div className="data-table"><TableHead labels={['Purchase order','Supplier','Received','Outstanding','Action']}/>{po.map(x=><div className="data-row" key={x.id}><strong>{x.number}</strong><span>{x.supplier}</span><span>{x.received} / {x.ordered}</span><span className="amber-text">{x.ordered-x.received} units</span><button className="row-action" onClick={()=>notify('Use the connected workflow above to receive a live order')}><PackageCheck size={14}/> Receive stock</button></div>)}</div></Panel></> }

function Inventory({query,notify}: { query: string; notify: (m: string) => void; match?: (v: unknown[]) => boolean; serial?: string; setSerial?: (v: string) => void; foundDevice?: typeof devices[number] }) { return <InventoryWorkspace query={query} notify={notify}/> }

function Sales({notify}: { notify: (m: string) => void; query?: string; match?: (v: unknown[]) => boolean }) { return <CrmWorkspace notify={notify}/> }

function Jobs({notify}:{notify:(m:string)=>void; query?:string; match?: (v:unknown[])=>boolean}) { return <JobsWorkspace notify={notify}/> }

function Warranty({notify}:{notify:(m:string)=>void; query?:string; match?: (v:unknown[])=>boolean; serial?:string; setSerial?: (v:string)=>void; foundDevice?: typeof devices[number] }) { return <WarrantyWorkspace notify={notify}/> }

function FinanceHR({notify}:{query?:string;match?:(v:unknown[])=>boolean;notify:(m:string)=>void}) { return <FinanceWorkspace notify={notify}/> }

function Reports({notify}:{notify:(m:string)=>void}) { return <ReportsWorkspace notify={notify}/> }

function Kpis({items}:{items:[string,string,string,React.ElementType,string][]}) { return <div className="ops-kpis">{items.map(([label,value,note,Icon,tone])=><div className="ops-kpi" key={label}><span className={`kpi-icon ${tone}`}><Icon size={16}/></span><strong>{value}</strong><span>{label}</span><small>{note}</small></div>)}</div> }
function Panel({title,subtitle,actions,children}:{title:string;subtitle:string;actions?:React.ReactNode;children:React.ReactNode}) { return <section className="ops-panel"><div className="ops-panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{actions}</div>{children}</section> }
function RecordRow({icon,tone,primary,secondary,status,right,meta,onClick}:{icon:React.ReactNode;tone:string;primary:string;secondary:string;status:string;right:string;meta:string;onClick:()=>void}) { return <button className="record-row" onClick={onClick}><span className={`record-icon ${tone}`}>{icon}</span><span className="record-copy"><strong>{primary}</strong><small>{secondary}</small><em>{meta}</em></span><span className="record-right"><b>{right}</b><Status value={status}/></span><ArrowUpRight size={14} className="record-arrow"/></button> }
function Status({value}:{value:string}) { const key=value.toLowerCase().replaceAll(' ','-'); return <span className={`status ${key}`}>{value}</span> }
function TableHead({labels}:{labels:string[]}) { return <div className="table-head ops-table-head">{labels.map(label=><span key={label}>{label}</span>)}</div> }
function CheckItem({label,done=false}:{label:string;done?:boolean}) { return <div className="check-item"><span className={done?'check done':'check'}>{done&&<Check size={12}/>}</span><span>{label}</span>{done&&<small>Complete</small>}</div> }
function TimelineItem({title,detail,date}:{title:string;detail:string;date:string}) { return <div className="timeline-item"><span className="timeline-dot"/><div><strong>{title}</strong><span>{detail}</span></div><small>{date}</small></div> }
function ExportActions({notify}:{notify:(m:string)=>void}) { const exportFile=(type:string)=>{window.location.href=`/api/exports?type=${type}`;notify(`${type.toUpperCase()} export downloaded`)}; return <span className="export-actions"><button onClick={()=>exportFile('csv')} title="Export CSV"><Download size={14}/> CSV</button><button onClick={()=>exportFile('xlsx')} title="Export XLSX">XLSX</button><button onClick={()=>exportFile('pdf')} title="Export PDF"><FileText size={14}/> PDF</button></span> }
function ReportCard({title,detail,icon,notify}:{title:string;detail:string;icon:React.ReactNode;notify:(m:string)=>void}) { return <button className="report-card" onClick={()=>notify(`${title} report opened`)}><span className="report-icon">{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={14}/></button> }
function iconFor(item:OpsModule) { const props={size:16}; if(item==='Procurement')return <ShoppingCart {...props}/>; if(item==='Inventory')return <Boxes {...props}/>; if(item==='Sales & CRM')return <BriefcaseBusiness {...props}/>; if(item==='Job cards')return <ClipboardCheck {...props}/>; if(item==='Warranty')return <ShieldCheck {...props}/>; if(item==='Finance & HR')return <Users {...props}/>; return <FileText {...props}/>; }
