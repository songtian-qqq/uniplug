/**
 * Framework error types.
 * Every error carries a stable `code` so callers can branch on it
 * instead of parsing messages.
 */

export class UniplugError extends Error {
  constructor(message, { code = 'UNIPLUG_ERROR', cause, details } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    if (details) this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class ManifestError extends UniplugError {
  constructor(message, details) {
    super(message, { code: 'MANIFEST_INVALID', details });
  }
}

export class DependencyError extends UniplugError {
  constructor(message, details) {
    super(message, { code: 'DEPENDENCY_ERROR', details });
  }
}

export class LifecycleError extends UniplugError {
  constructor(message, details) {
    super(message, { code: 'LIFECYCLE_ERROR', details });
  }
}

export class PermissionError extends UniplugError {
  constructor(message, details) {
    super(message, { code: 'PERMISSION_DENIED', details });
  }
}

export class LoadError extends UniplugError {
  constructor(message, details) {
    super(message, { code: 'LOAD_ERROR', details });
  }
}
