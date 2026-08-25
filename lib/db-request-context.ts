import { AsyncLocalStorage } from 'node:async_hooks';
import { isValidRequestId } from '@/lib/observability';

export type DbRequestContext = {
  organizationId?: string;
  actorUserId?: string;
  requestId?: string;
};

type GlobalWithDbRequestContext = typeof globalThis & {
  __ipaytechDbRequestContext?: AsyncLocalStorage<DbRequestContext>;
};

const globalForDbRequestContext = globalThis as GlobalWithDbRequestContext;
const dbRequestContext = globalForDbRequestContext.__ipaytechDbRequestContext ?? new AsyncLocalStorage<DbRequestContext>();

globalForDbRequestContext.__ipaytechDbRequestContext = dbRequestContext;

export function setDbRequestContext(context: DbRequestContext) {
  dbRequestContext.enterWith({ ...dbRequestContext.getStore(), ...context });
}

export function setDbRequestId(requestId: string | null | undefined) {
  if (isValidRequestId(requestId)) setDbRequestContext({ requestId });
}

export function getDbRequestContext() {
  return dbRequestContext.getStore();
}

export function getOrganizationId() {
  return dbRequestContext.getStore()?.organizationId;
}

export function getActorUserId() {
  return dbRequestContext.getStore()?.actorUserId;
}

export function getRequestId() {
  return dbRequestContext.getStore()?.requestId;
}
