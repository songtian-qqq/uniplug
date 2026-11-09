/**
 * Event bus.
 *
 * Features
 * - priority ordering (higher first)
 * - `once`
 * - wildcard listeners: `'*'` (everything) and `'ns:*'` (prefix)
 * - cancellation: a handler returning `false` stops the remaining handlers
 * - owner tagging: the kernel activates/deactivates a plugin's listeners
 *   when that plugin is enabled/disabled, without losing registrations
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Listener[]>} */
    this._listeners = new Map();
    this._seq = 0;
  }

  /**
   * @param {string} name event name, `'*'` or prefix wildcard `'ns:*'`
   * @param {(payload: any, meta: {name: string, owner?: string}) => any} handler
   * @param {{priority?: number, once?: boolean, owner?: string}} [opts]
   * @returns {() => void} unsubscribe
   */
  on(name, handler, opts = {}) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    const entry = {
      name,
      handler,
      priority: opts.priority ?? 0,
      once: Boolean(opts.once),
      owner: opts.owner ?? null,
      active: opts.active !== false,
      seq: this._seq++,
    };
    const list = this._listeners.get(name) || [];
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    this._listeners.set(name, list);
    return () => this.offEntry(entry);
  }

  once(name, handler, opts = {}) {
    return this.on(name, handler, { ...opts, once: true });
  }

  off(name, handler) {
    const list = this._listeners.get(name);
    if (!list) return false;
    const idx = list.findIndex((e) => e.handler === handler);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  offEntry(entry) {
    const list = this._listeners.get(entry.name);
    if (!list) return false;
    const idx = list.indexOf(entry);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  /** Remove every listener registered by an owner (used on unload). */
  removeOwner(owner) {
    for (const [name, list] of this._listeners) {
      const kept = list.filter((e) => e.owner !== owner);
      if (kept.length) this._listeners.set(name, kept);
      else this._listeners.delete(name);
    }
  }

  /** Enable/disable a plugin's listeners without removing them. */
  setOwnerActive(owner, active) {
    for (const list of this._listeners.values()) {
      for (const e of list) if (e.owner === owner) e.active = active;
    }
  }

  _matches(pattern, name) {
    if (pattern === '*') return true;
    if (pattern.endsWith(':*')) return name.startsWith(pattern.slice(0, -1));
    return pattern === name;
  }

  listenerCount(name) {
    let n = 0;
    for (const [pattern, list] of this._listeners) {
      if (this._matches(pattern, name)) n += list.filter((e) => e.active).length;
    }
    return n;
  }

  /**
   * @returns {Promise<{name: string, cancelled: boolean, results: any[], payload: any}>}
   */
  async emit(name, payload) {
    const handlers = [];
    for (const [pattern, list] of this._listeners) {
      if (!this._matches(pattern, name)) continue;
      for (const e of list) if (e.active) handlers.push(e);
    }
    handlers.sort((a, b) => b.priority - a.priority || a.seq - b.seq);

    const results = [];
    let cancelled = false;
    for (const entry of handlers) {
      if (entry.once) this.offEntry(entry);
      const meta = { name, owner: entry.owner };
      try {
        const ret = await entry.handler(payload, meta);
        results.push(ret);
        if (ret === false) {
          cancelled = true;
          break;
        }
      } catch (err) {
        if (name === 'error') throw err;
        // A failing listener must not break the emitter: report and continue.
        const errorPayload = { error: err, event: name, owner: entry.owner };
        if (this.listenerCount('error') > 0) {
          await this.emit('error', errorPayload);
        } else {
          throw err;
        }
      }
    }
    return { name, cancelled, results, payload };
  }
}
