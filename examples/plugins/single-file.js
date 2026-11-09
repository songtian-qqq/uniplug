/**
 * Example 5 — single-file plugin, no plugin.json, metadata inline.
 *
 * Any `*.js` file dropped in a plugin directory with this shape is loaded.
 */

import { definePlugin } from '../../src/index.js';

export default definePlugin({
  id: 'single-file',
  name: 'Single File Plugin',
  version: '0.3.0',
  description: 'Demonstrates metadata-in-code plugins.',
  setup(api) {
    api.command('single:ping', () => 'pong');
  },
});
