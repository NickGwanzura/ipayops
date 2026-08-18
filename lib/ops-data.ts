export type OpsModule = 'Procurement' | 'Inventory' | 'Sales & CRM' | 'Job cards' | 'Warranty' | 'Finance & HR' | 'Reports';
export type RecordStatus = 'Approved' | 'Pending' | 'In transit' | 'Available' | 'Reserved' | 'Active' | 'Needs review' | 'In progress' | 'Paid';

export const suppliers = [
  { id:'sup-1', code:'SUP-0041', name:'TechCore Distributors', contact:'Nadia Mbeki', phone:'+263 77 412 8890', terms:'30 days', lead:'14 days', status:'Active' },
  { id:'sup-2', code:'SUP-0028', name:'ByteBridge Africa', contact:'Tendai Ncube', phone:'+263 71 223 1456', terms:'COD', lead:'7 days', status:'Active' },
  { id:'sup-3', code:'SUP-0019', name:'POS Global Systems', contact:'Mandla Dube', phone:'+263 78 903 4471', terms:'45 days', lead:'21 days', status:'Active' },
];
export const purchaseOrders = [
  { id:'po-1', number:'PO-2026-000084', supplier:'TechCore Distributors', destination:'Harare HQ', ordered:40, received:18, total:'$42,680', status:'Partially received', due:'24 Aug 2026' },
  { id:'po-2', number:'PO-2026-000083', supplier:'ByteBridge Africa', destination:'Bulawayo Branch', ordered:24, received:24, total:'$31,200', status:'Fully received', due:'15 Aug 2026' },
  { id:'po-3', number:'PO-2026-000082', supplier:'POS Global Systems', destination:'Harare HQ', ordered:60, received:0, total:'$28,500', status:'Approved', due:'30 Aug 2026' },
];
export const devices = [
  { serial:'POS-884021', product:'iPay POS Pro 5', category:'POS Machines', location:'Harare HQ', batch:'BAT-2026-000073', status:'Reserved', client:'Mavuno Foods', cost:'$420', sale:'SAL-2026-000179' },
  { serial:'POS-884022', product:'iPay POS Pro 5', category:'POS Machines', location:'Harare HQ', batch:'BAT-2026-000073', status:'Available', client:'—', cost:'$420', sale:'—' },
  { serial:'LAP-552018', product:'iPayBook Air 14', category:'Laptops', location:'Bulawayo Branch', batch:'BAT-2026-000071', status:'In progress', client:'Apex Retail', cost:'$685', sale:'SAL-2026-000184' },
  { serial:'LAP-552019', product:'iPayBook Air 14', category:'Laptops', location:'Harare HQ', batch:'BAT-2026-000071', status:'Available', client:'—', cost:'$685', sale:'—' },
  { serial:'POS-883910', product:'iPay Mini Kiosk', category:'POS Machines', location:'Harare HQ', batch:'BAT-2026-000069', status:'Active', client:'Apex Retail', cost:'$315', sale:'SAL-2026-000176' },
];
export const clients = [
  { code:'CLI-00182', name:'Apex Retail (Pvt) Ltd', type:'Organisation', contact:'Sarah Chikore', phone:'+263 77 892 4410', consultant:'Tafadzwa Moyo', pipeline:'Won', value:'$24,840' },
  { code:'CLI-00181', name:'Mavuno Foods', type:'Organisation', contact:'Brian Ndlovu', phone:'+263 71 442 1180', consultant:'Kudzai Dube', pipeline:'Pre-sale', value:'$8,420' },
  { code:'CLI-00180', name:'Tinashe Chirwa', type:'Person', contact:'Tinashe Chirwa', phone:'+263 78 113 0062', consultant:'Rudo Nyathi', pipeline:'Quotation', value:'$1,280' },
];
export const presales = [
  { number:'PRE-2026-000094', client:'Mavuno Foods', consultant:'Kudzai Dube', lines:'4 × iPay POS Pro 5', value:'$8,420', status:'Under review', expiry:'28 Aug 2026' },
  { number:'PRE-2026-000093', client:'Tinashe Chirwa', consultant:'Rudo Nyathi', lines:'1 × iPayBook Air 14', value:'$1,280', status:'Stock reserved', expiry:'25 Aug 2026' },
  { number:'PRE-2026-000092', client:'Kubatana Pharmacy', consultant:'Tafadzwa Moyo', lines:'6 × iPay Mini Kiosk', value:'$7,680', status:'Submitted', expiry:'31 Aug 2026' },
];
export const jobs = [
  { number:'JOB-2026-000184', title:'Apex Retail — POS rollout', client:'Apex Retail (Pvt) Ltd', sales:'Tafadzwa Moyo', installer:'Farai Chanda', scheduled:'20 Aug 2026', status:'In progress', devices:'4 devices' },
  { number:'JOB-2026-000183', title:'Mavuno Foods — Site configuration', client:'Mavuno Foods', sales:'Kudzai Dube', installer:'Shingai Ncube', scheduled:'22 Aug 2026', status:'Scheduled', devices:'4 devices' },
  { number:'JOB-2026-000181', title:'Bulawayo branch setup', client:'Kubatana Pharmacy', sales:'Rudo Nyathi', installer:'Farai Chanda', scheduled:'18 Aug 2026', status:'Completed', devices:'6 devices' },
];
export const warranties = [
  { claim:'WAR-2026-000021', serial:'POS-884021', product:'iPay POS Pro 5', client:'Mavuno Foods', start:'12 Feb 2026', expiry:'12 Aug 2026', status:'Expired', issue:'Receipt printer intermittent' },
  { claim:'WAR-2026-000020', serial:'LAP-552018', product:'iPayBook Air 14', client:'Apex Retail', start:'05 Jul 2026', expiry:'05 Jan 2027', status:'Active', issue:'Keyboard replacement' },
  { claim:'WAR-2026-000019', serial:'POS-883910', product:'iPay Mini Kiosk', client:'Apex Retail', start:'18 Mar 2026', expiry:'18 Sep 2026', status:'Near expiry', issue:'Screen calibration' },
];
export const expenses = [
  { number:'EXP-2026-00118', submitter:'Farai Chanda', category:'Travel', description:'Bulawayo installation travel', amount:'$184.00', status:'Pending', submitted:'18 Aug 2026' },
  { number:'EXP-2026-00117', submitter:'Kudzai Dube', category:'Client meeting', description:'Mavuno Foods discovery workshop', amount:'$72.50', status:'Approved', submitted:'17 Aug 2026' },
  { number:'EXP-2026-00116', submitter:'Rudo Nyathi', category:'Travel', description:'Mutare prospect visit', amount:'$210.00', status:'Paid', submitted:'15 Aug 2026' },
];
export const people = [
  { number:'EMP-00021', name:'Tafadzwa Moyo', role:'Sales Consultant', department:'Stores', target:'$48,000', achieved:'$36,400', status:'Active', onboarding:'Complete' },
  { number:'EMP-00018', name:'Kudzai Dube', role:'Sales Consultant', department:'Stores', target:'$42,000', achieved:'$29,820', status:'Active', onboarding:'Complete' },
  { number:'EMP-00014', name:'Farai Chanda', role:'Configuration Consultant', department:'Laptops', target:'—', achieved:'—', status:'Active', onboarding:'3 of 5 complete' },
];
export const reportRows = [
  { period:'01–07 Aug', revenue:'$48,200', cost:'$31,600', profit:'$16,600', units:'42', jobs:'11' },
  { period:'08–14 Aug', revenue:'$62,840', cost:'$40,210', profit:'$22,630', units:'57', jobs:'16' },
  { period:'15–18 Aug', revenue:'$73,250', cost:'$51,050', profit:'$22,200', units:'48', jobs:'15' },
];

export const moduleMeta: Record<OpsModule, { title:string; description:string; icon:string }> = {
  'Procurement': { title:'Procurement control', description:'Purchase orders, suppliers, receipts, and delivery commitments', icon:'shopping' },
  'Inventory': { title:'Serialized inventory', description:'Trace every device from supplier receipt to delivery and warranty', icon:'boxes' },
  'Sales & CRM': { title:'Sales & CRM', description:'Clients, pipeline, pre-sales, reservations, and confirmed sales', icon:'crm' },
  'Job cards': { title:'Jobs & installations', description:'Schedule, assign, configure, and sign off device installations', icon:'jobs' },
  'Warranty': { title:'Warranty service desk', description:'Check coverage, manage claims, repairs, and replacements', icon:'warranty' },
  'Finance & HR': { title:'Finance & HR', description:'Expenses, commissions, targets, and consultant lifecycle', icon:'finance' },
  'Reports': { title:'Reporting centre', description:'Operational performance, profitability, stock, and service analytics', icon:'reports' },
};
