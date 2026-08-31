import type { OpsModule } from './ops-data';

export const ALL_OPS_MODULES: OpsModule[] = ['Procurement', 'Products', 'Inventory', 'Sales & CRM', 'Job cards', 'Warranty', 'Finance & HR', 'People & HR', 'Reports'];
export const CEO_ONLY_MODULES: OpsModule[] = ['Audit Logs'];

export const ROLE_LABELS = {
  ceo: 'CEO',
  manager: 'Manager',
  finance: 'Finance',
  sales_consultant: 'Sales Consultant',
} as const;

export type BusinessRole = keyof typeof ROLE_LABELS;

export const ROLE_MODULES: Record<BusinessRole, OpsModule[]> = {
  ceo: [...ALL_OPS_MODULES, ...CEO_ONLY_MODULES],
  manager: ALL_OPS_MODULES,
  finance: ['Products', 'Finance & HR', 'Reports'],
  sales_consultant: ['Products', 'Sales & CRM', 'Job cards', 'Reports'],
};

export function normalizeRole(role: string): BusinessRole {
  const normalized = role.trim().toLowerCase();
  if (normalized === 'admin' || normalized === 'hr' || normalized === 'operator') return 'manager';
  if (normalized === 'installer' || normalized === 'viewer') return 'sales_consultant';
  if (normalized in ROLE_LABELS) return normalized as BusinessRole;
  return 'sales_consultant';
}

export function roleLabel(role: string) {
  return ROLE_LABELS[normalizeRole(role)];
}

export function modulesForRole(role: string) {
  return ROLE_MODULES[normalizeRole(role)];
}

export function canAccessModule(role: string, module: OpsModule) {
  return modulesForRole(role).includes(module);
}

export function canAccessConfiguration(role: string) {
  return normalizeRole(role) === 'ceo';
}

export function isLeadershipRole(role: string) {
  return normalizeRole(role) === 'ceo';
}
