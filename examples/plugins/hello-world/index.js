/**
 * Example 1 — the smallest useful plugin.
 *
 * Shows: setup(), onEnable/onDisable/onUnload, events, commands, config.
 */

import { definePlugin } from '../../../src/index.js';

export default definePlugin({
  setup(api) {
    api.log.info('setup: registering declarations');

    // A command callable from the CLI or host: `uniplug run hello:greet World`
    api.command(
      'hello:greet',
      (who = 'world') => {
        const greeting = api.config.get('greeting', 'Hello');
        const text = `${greeting}, ${who}!`;
        return api.config.get('loud') ? text.toUpperCase() : text;
      },
      'Greet someone using the configured greeting word',
    );

    // React to anything that emits on the bus.
    api.on('demo:message', (payload) => {
      api.log.info(`heard demo:message → "${payload?.text}"`);
    });
  },

  async onEnable(api) {
    api.log.info('enabled');
  },

  async onDisable(api) {
    api.log.info('disabled (listeners stay registered but inactive)');
  },

  async onUnload(api) {
    api.log.info('unloaded');
  },
});
