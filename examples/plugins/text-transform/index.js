/**
 * Example 3 — middleware hooks (onion model).
 *
 * Both interceptors sit on the same hook; the one with the higher priority
 * runs first, and `next()` hands the value to the next interceptor.
 */

import { definePlugin } from '../../../src/index.js';

export default definePlugin({
  setup(api) {
    // priority 10 → runs before the default (0) interceptor
    api.hook(
      'demo:transform',
      async (value, next) => {
        value.steps.push('uppercase');
        const result = await next({ ...value, text: value.text.toUpperCase() });
        result.steps.push('uppercase:done');
        return result;
      },
      { priority: 10 },
    );

    // default priority → runs second
    api.hook(
      'demo:transform',
      async (value, next) => {
        value.steps.push('banner');
        const line = '='.repeat(value.text.length + 4);
        return next({ ...value, text: `${line}\n| ${value.text} |\n${line}` });
      },
      { priority: 0 },
    );

    api.log.info(`registered ${api.hookCount('demo:transform')} interceptors`);
  },
});
