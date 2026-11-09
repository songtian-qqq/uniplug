/**
 * Example 2 — services and cross-plugin calls.
 *
 * Provides `greeter` so other plugins can `api.use('greeter')` without
 * importing this file, and shows how to call another plugin's command.
 */

import { definePlugin } from '../../../src/index.js';

export default definePlugin({
  setup(api) {
    // Service value is a plain object; consumers resolve it lazily.
    api.provide('greeter', {
      greet: (name = 'world') => {
        const mark = api.config.get('punctuation', '!');
        return `Hey ${name}${mark}`;
      },
      shout: (name) => api.use('greeter').greet(name).toUpperCase(),
    });

    api.command(
      'greeter:hi',
      async (name = 'world') => {
        // Call another plugin's command through the kernel.
        const fromHello = await api.runCommand('hello:greet', name);
        return api.use('greeter').greet(name) + ` (hello-world says: ${fromHello})`;
      },
      'Greet via the greeter service and the hello-world command',
    );
  },

  async onEnable(api) {
    api.log.info('service "greeter" available');
  },

  async onDisable(api) {
    api.log.info('service "greeter" hidden while disabled');
  },
});
