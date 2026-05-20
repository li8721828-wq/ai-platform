import { logger } from './logger.js';

type Handler<A extends any[]> = (...args: A) => void | Promise<void>;

interface Listener<A extends any[]> {
  handler: Handler<A>;
  once: boolean;
}

export class TypedEventBus {
  private listeners = new Map<string, Set<Listener<any[]>>>();
  private wsBroadcast: ((event: string, data: any) => void) | null = null;

  setWsBroadcast(fn: ((event: string, data: any) => void) | null) {
    this.wsBroadcast = fn;
  }

  on<E extends string, A extends any[]>(event: E, handler: Handler<A>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const entry: Listener<A> = { handler, once: false };
    this.listeners.get(event)!.add(entry);
    return () => this.off(event, handler);
  }

  once<E extends string, A extends any[]>(event: E, handler: Handler<A>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const entry: Listener<A> = { handler, once: true };
    this.listeners.get(event)!.add(entry);
    return () => this.off(event, handler);
  }

  off<E extends string>(event: E, handler: (...args: any[]) => void) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const entry of set) {
      if (entry.handler === handler) {
        set.delete(entry);
        break;
      }
    }
    if (set.size === 0) this.listeners.delete(event);
  }

  async emit<E extends string>(event: E, ...args: any[]): Promise<void> {
    const set = this.listeners.get(event);
    if (set) {
      const toRemove: Listener<any[]>[] = [];
      for (const entry of set) {
        try {
          await entry.handler(...args);
        } catch (err) {
          logger.error(`EventBus[${event}] handler error`, { error: (err as Error).message });
        }
        if (entry.once) toRemove.push(entry);
      }
      for (const entry of toRemove) set.delete(entry);
      if (set.size === 0) this.listeners.delete(event);
    }

    if (this.wsBroadcast) {
      try {
        this.wsBroadcast(event, args.length === 1 ? args[0] : args);
      } catch (err) {
        logger.error(`EventBus[${event}] wsBroadcast error`, { error: (err as Error).message });
      }
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear() {
    this.listeners.clear();
  }
}

export const eventBus = new TypedEventBus();
