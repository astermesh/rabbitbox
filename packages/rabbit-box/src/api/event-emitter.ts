/**
 * Minimal typed event emitter for cross-platform use.
 *
 * Avoids Node.js EventEmitter dependency so RabbitBox works in
 * browsers, Deno, Bun, and Node without polyfills.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => void;

export class EventEmitter<Events> {
  private readonly listeners = new Map<keyof Events, Set<Fn>>();

  on<E extends keyof Events>(event: E, listener: Events[E] & Fn): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  once<E extends keyof Events>(event: E, listener: Events[E] & Fn): this {
    const wrapped = ((...args: unknown[]) => {
      this.off(event, wrapped as Events[E] & Fn);
      (listener as Fn)(...args);
    }) as Events[E] & Fn;
    return this.on(event, wrapped);
  }

  off<E extends keyof Events>(event: E, listener: Events[E] & Fn): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(event);
    }
    return this;
  }

  removeAllListeners(event?: keyof Events): this {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  protected emit<E extends keyof Events>(
    event: E,
    ...args: Events[E] extends Fn ? Parameters<Events[E]> : never
  ): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const listener of set) {
      listener(...args);
    }
    return true;
  }

  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
