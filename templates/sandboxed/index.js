/**
 * __NAME__ — sandboxed template (CommonJS only).
 *
 * Sandboxed plugins run in a fresh vm context: no require() of arbitrary
 * modules, no process-wide globals, no filesystem or network unless the
 * manifest declares the matching permission.
 */

module.exports = {
  setup(api) {
    api.log.info('setup inside the sandbox');

    api.command('__ID__:hello', (name = 'sandbox') => `hello ${name} from a sandboxed plugin`);

    api.on('__ID__:ping', () => ({ ok: true, sandboxed: true }));
  },

  async onEnable(api) {
    api.log.info('enabled');
  },
};
