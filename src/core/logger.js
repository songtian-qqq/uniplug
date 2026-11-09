/**
 * Tiny leveled logger with per-plugin child loggers.
 * No dependency, ANSI colors only when stdout is a TTY.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

function supportsColor() {
  return Boolean(process.stdout && process.stdout.isTTY) && !process.env.NO_COLOR;
}

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

export class Logger {
  /**
   * @param {object} [options]
   * @param {string} [options.name] scope shown in every line
   * @param {string} [options.level] debug|info|warn|error|silent
   * @param {(entry: object) => void} [options.sink] custom output
   */
  constructor({ name = 'uniplug', level = process.env.LOG_LEVEL || 'info', sink = null } = {}) {
    this.name = name;
    this.level = LEVELS[level] === undefined ? LEVELS.info : LEVELS[level];
    this.sink = sink;
    this.color = supportsColor();
  }

  child(name, level) {
    return new Logger({ name: `${this.name}:${name}`, level: level || this.levelName, sink: this.sink });
  }

  get levelName() {
    for (const [k, v] of Object.entries(LEVELS)) {
      if (v === this.level) return k;
    }
    return 'info';
  }

  setLevel(level) {
    if (LEVELS[level] !== undefined) this.level = LEVELS[level];
    return this;
  }

  _write(level, args) {
    if (LEVELS[level] < this.level) return;
    const entry = { time: new Date().toISOString(), level, scope: this.name, msg: args };
    if (this.sink) {
      this.sink(entry);
      return;
    }
    const paint = (text, c) => (this.color ? `${c}${text}${COLORS.reset}` : text);
    const prefix = `${paint(stamp(), COLORS.dim)} ${paint(level.toUpperCase().padEnd(5), COLORS[level] || '')} ${paint(`[${this.name}]`, COLORS.dim)}`;
    const out = level === 'error' || level === 'warn' ? console.error : console.log;
    out(prefix, ...args);
  }

  debug(...args) { this._write('debug', args); }
  info(...args) { this._write('info', args); }
  warn(...args) { this._write('warn', args); }
  error(...args) { this._write('error', args); }
}

export function createLogger(options) {
  return new Logger(options);
}
