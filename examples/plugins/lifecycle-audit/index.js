/**
 * Example 4 — wildcard listeners, persistent storage, cleanup, timers.
 *
 * Open this file while `demo-app.js` runs to see hot reload in action:
 * the counters survive because they live in the plugin's store.
 */

import { definePlugin } from '../../../src/index.js';

export default definePlugin({
  setup(api) {
    // `'*'` sees every event, including lifecycle ones.
    api.on(
      '*',
      (payload, meta) => {
        if (!api.config.get('verbose')) return;
        if (meta.name.startsWith('demo:') || meta.name.startsWith('plugin:')) {
          api.log.debug(`event ${meta.name}`);
        }
      },
      { priority: -10 },
    );

    api.on('demo:message', async () => {
      await api.store.update('messages', (n) => (n || 0) + 1);
    });

    api.on('kernel:ready', async () => {
      const count = await api.store.get('messages', 0);
      api.log.info(`booted · ${count} message(s) seen so far · data: ${api.dataDir}`);
    });

    // Managed timer: automatically cleared on disable/unload/reload.
    api.poll(5000, async () => {
      const count = await api.store.get('messages', 0);
      api.log.info(`heartbeat · messages=${count}`);
    });
  },

  async onDisable(api) {
    await api.store.flush();
    api.log.info('disabled (store flushed, timers cleared)');
  },
});
