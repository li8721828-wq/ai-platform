type Handler = (...args: any[]) => void;

class EventBus {
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach(h => {
      try { h(...args); } catch (e) { console.error(`EventBus[${event}]:`, e); }
    });
  }
}

export const eventBus = new EventBus();
