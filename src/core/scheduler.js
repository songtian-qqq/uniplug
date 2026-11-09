/**
 * Managed timers.
 *
 * Plugins that call `setInterval` directly leak timers after they are
 * disabled — a classic plugin-system bug. Everything registered here is
 * cleared automatically when the plugin is disabled or reloaded.
 */

export class Scheduler {
  constructor() {
    this._timers = new Set();
    this.disposed = false;
    this.onError = null;
  }

  /** Wrap a plugin callback so a throw never escapes the timer machinery. */
  _safe(fn) {
    return async () => {
      try {
        await fn();
      } catch (err) {
        if (this.onError) this.onError(err);
        else console.error('[uniplug] timer callback failed:', err);
      }
    };
  }

  _track(handle) {
    const entry = { handle };
    this._timers.add(entry);
    return entry;
  }

  /**
   * @param {number} ms
   * @param {() => any} fn
   * @param {{immediate?: boolean}} [opts]
   * @returns {() => void} stop
   */
  every(ms, fn, opts = {}) {
    if (this.disposed) throw new Error('scheduler disposed');
    const run = this._safe(fn);
    const handle = setInterval(run, ms);
    handle.unref?.();
    const entry = this._track(handle);
    if (opts.immediate) run();
    return () => {
      clearInterval(handle);
      this._timers.delete(entry);
    };
  }

  /** @returns {() => void} cancel */
  after(ms, fn) {
    if (this.disposed) throw new Error('scheduler disposed');
    const entry = this._track(null);
    const handle = setTimeout(async () => {
      this._timers.delete(entry);
      await this._safe(fn)();
    }, ms);
    handle.unref?.();
    entry.handle = handle;
    return () => {
      clearTimeout(handle);
      this._timers.delete(entry);
    };
  }

  /** Run now, then repeat `ms` after each completion (no overlap, no drift). */
  poll(ms, fn) {
    if (this.disposed) throw new Error('scheduler disposed');
    const run = this._safe(fn);
    let stopped = false;
    const entry = this._track(null);
    const tick = async () => {
      if (stopped) return;
      await run();
      if (!stopped) {
        entry.handle = setTimeout(tick, ms);
        entry.handle.unref?.();
      }
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(entry.handle);
      this._timers.delete(entry);
    };
  }

  /** Clear all pending timers but keep the scheduler usable (used on disable). */
  clear() {
    for (const { handle } of this._timers) {
      if (handle) {
        clearInterval(handle);
        clearTimeout(handle);
      }
    }
    this._timers.clear();
  }

  dispose() {
    this.clear();
    this.disposed = true;
  }

  get size() {
    return this._timers.size;
  }
}
