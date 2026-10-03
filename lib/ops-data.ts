export type OpsModule = 'Procurement' | 'Products' | 'Inventory' | 'Sales & CRM' | 'Job cards' | 'Warranty' | 'Finance & HR' | 'People & HR' | 'Reports' | 'Audit Logs';
export type RecordStatus = 'Approved' | 'Pending' | 'In transit' | 'Available' | 'Reserved' | 'Active' | 'Needs review' | 'In progress' | 'Paid';

export const moduleMeta: Record<OpsModule, { title:string; description:string; icon:string }> = {
  'Procurement': { title:'Procurement control', description:'Purchase orders, suppliers, receipts, and delivery commitments', icon:'shopping' },
  'Products': { title:'Products and pricing', description:'Serialized Laptop/POS products, cost prices, selling prices, and margin controls', icon:'products' },
  'Inventory': { title:'Serialized inventory', description:'Trace every device from supplier receipt to delivery and warranty', icon:'boxes' },
  'Sales & CRM': { title:'Sales & CRM', description:'Clients, pipeline, pre-sales, reservations, and confirmed sales', icon:'crm' },
  'Job cards': { title:'Jobs & installations', description:'Schedule, assign, configure, and sign off device installations', icon:'jobs' },
  'Warranty': { title:'Warranty service desk', description:'Check coverage, manage claims, repairs, and replacements', icon:'warranty' },
  'Finance & HR': { title:'Finance & HR', description:'Expenses, commissions, targets, and consultant lifecycle', icon:'finance' },
  'People & HR': { title:'People & HR', description:'Employees, invitations, onboarding, and lifecycle history', icon:'people' },
  'Reports': { title:'Reporting centre', description:'Operational performance, profitability, stock, and service analytics', icon:'reports' },
  'Audit Logs': { title:'Audit logs', description:'CEO-only oversight of actors, actions, and organization access context', icon:'audit' },
};
