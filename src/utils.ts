export function safeJsonParse(str: string, fallback: any = null): any {
  try { return JSON.parse(str); } catch { return fallback; }
}

export function safeJson(val: any, fallback = '{}'): string {
  try { return JSON.stringify(val); } catch { return fallback; }
}

export function now(): number {
  return Date.now();
}

export function genId(prefix = ''): string {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
