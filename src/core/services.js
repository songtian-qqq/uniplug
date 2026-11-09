/**
 * Service container: cross-plugin dependency injection without imports.
 *
 *   api.provide('greeter', { greet(name) { ... } });
 *   const greeter = api.use('greeter');
 *
 * Entries are owner-tagged so disabling a plugin hides the services it
 * provides and re-enabling brings them back.
 */

export class ServiceContainer {
  constructor() {
    /** @type {Map<string, {name: string, value: any, owner: string|null, active: boolean}>} */
    this._services = new Map();
    this._seq = 0;
  }

  /**
   * @param {string} name
   * @param {any} value
   * @param {{owner?: string, overwrite?: boolean}} [opts]
   */
  provide(name, value, opts = {}) {
    if (typeof name !== 'string' || !name) throw new TypeError('service name must be a non-empty string');
    const existing = this._services.get(name);
    if (existing && !opts.overwrite) {
      throw new Error(
        `service "${name}" is already provided by plugin "${existing.owner || 'unknown'}"; ` +
          `pass { overwrite: true } to replace it intentionally`,
      );
    }
    this._services.set(name, {
      name,
      value,
      owner: opts.owner ?? null,
      active: true,
      seq: this._seq++,
    });
    return value;
  }

  /** @returns {any} */
  use(name) {
    const entry = this._services.get(name);
    if (!entry || !entry.active) {
      const available = this.names();
      throw new Error(
        `service "${name}" is not available. Available: ${available.length ? available.join(', ') : '(none)'}`,
      );
    }
    return entry.value;
  }

  tryUse(name, fallback = undefined) {
    const entry = this._services.get(name);
    return entry && entry.active ? entry.value : fallback;
  }

  has(name) {
    const entry = this._services.get(name);
    return Boolean(entry && entry.active);
  }

  names() {
    return [...this._services.values()].filter((e) => e.active).map((e) => e.name);
  }

  remove(name) {
    return this._services.delete(name);
  }

  removeOwner(owner) {
    for (const [name, entry] of this._services) {
      if (entry.owner === owner) this._services.delete(name);
    }
  }

  setOwnerActive(owner, active) {
    for (const entry of this._services.values()) {
      if (entry.owner === owner) entry.active = active;
    }
  }
}
