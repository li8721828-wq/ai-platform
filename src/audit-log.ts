import { logger, type LogAudit } from './logger.js';
import { getTraceId, getUserId } from './trace-context.js';

export function auditLog(
  action: string,
  resource: string,
  resourceId?: string,
  before?: any,
  after?: any,
) {
  const audit: LogAudit = {
    action,
    resource,
    resourceId,
    before: before ? sanitizeForAudit(before) : undefined,
    after: after ? sanitizeForAudit(after) : undefined,
    performedBy: getUserId(),
  };

  logger.audit(`[Audit] ${action} ${resource}${resourceId ? ` #${resourceId}` : ''}`, {
    audit,
    traceId: getTraceId(),
  });
}

const AUDIT_SAFE_KEYS = new Set([
  'id', 'name', 'provider', 'enabled', 'model', 'temperature',
  'is_default', 'base_url', 'route', 'tools',
]);

function sanitizeForAudit(obj: any): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return { value: obj };
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (AUDIT_SAFE_KEYS.has(k)) {
      result[k] = typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : v;
    }
  }
  return result;
}
