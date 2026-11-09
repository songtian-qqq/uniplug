/**
 * Middleware / pipeline bus ("hooks").
 *
 * A hook is a named chain of interceptors executed as an onion:
 *
 *   bus.add('request', async (payload, next) => {
 *     payload.headers['x-id'] = 'abc';
 *     const result = await next();      // hand over to the next interceptor
 *     result.timing = 12;
 *     return result;                   // returning !== undefined short-circuits
 *   });
 *
 * Returning `undefined` without calling `next()` means "pass the value through".
 * Returning a value terminates the chain and becomes the result.
 */

export class HookBus {
  constructor() {
    /** @type {Map<string, Entry[]>} */
    this._hooks = new Map();
    this._seq = 0;
  }

  /**
   * @param {string} name
   * @param {(value: any, next: (v?: any) => Promise<any>, meta: object) => any} fn
   * @param {{priority?: number, owner?: string, active?: boolean}} [opts]
   * @returns {() => void} remove
   */
  add(name, fn, opts = {}) {
    if (typeof fn !== 'function') throw new TypeError('hook must be a function');
    const entry = {
      name,
      fn,
      priority: opts.priority ?? 0,
      owner: opts.owner ?? null,
      active: opts.active !== false,
      seq: this._seq++,
    };
    const list = this._hooks.get(name) || [];
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    this._hooks.set(name, list);
    return () => this._remove(entry);
  }

  /** Alias kept for ergonomics: `bus.use(name, fn)`. */
  use(name, fn, opts) {
    return this.add(name, fn, opts);
  }

  _remove(entry) {
    const list = this._hooks.get(entry.name);
    if (!list) return false;
    const idx = list.indexOf(entry);
    if (idx === -1) return false;
    list.splice(idx, 1);
    if (!list.length) this._hooks.delete(entry.name);
    return true;
  }

  removeOwner(owner) {
    for (const [name, list] of this._hooks) {
      const kept = list.filter((e) => e.owner !== owner);
      if (kept.length) this._hooks.set(name, kept);
      else this._hooks.delete(name);
    }
  }

  setOwnerActive(owner, active) {
    for (const list of this._hooks.values()) {
      for (const e of list) if (e.owner === owner) e.active = active;
    }
  }

  has(name) {
    return (this._hooks.get(name) || []).some((e) => e.active);
  }

  count(name) {
    return (this._hooks.get(name) || []).filter((e) => e.active).length;
  }

  /**
   * Run the chain.
   * @param {string} name
   * @param {any} value initial value
   * @param {object} [meta] extra context handed to every interceptor
   * @returns {Promise<any>} the final value
   */
  async run(name, value, meta = {}) {
    const list = (this._hooks.get(name) || []).filter((e) => e.active);
    if (!list.length) return value;

    const chain = list.map((e) => e.fn);

    const dispatch = async (i, current) => {
      if (i >= chain.length) return current;
      let passed;
      let called = false;
      const next = async (v) => {
        called = true;
        passed = await dispatch(i + 1, v === undefined ? current : v);
        return passed;
      };
      const ret = await chain[i](current, next, { ...meta, hook: name, index: i });
      if (ret !== undefined) return ret;
      if (called) return passed;
      // Pass-through: the interceptor neither returned nor continued, so the
      // value moves on to the next interceptor unchanged.
      return dispatch(i + 1, current);
    };

    return dispatch(0, value);
  }

  /** Fire-and-forget variant: ignores the returned value. */
  async runAll(name, value, meta = {}) {
    await this.run(name, value, meta);
    return value;
  }
}
