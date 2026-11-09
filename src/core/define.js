/**
 * `definePlugin()` — a no-op identity helper whose only job is to give
 * editors type hints and to normalize the two supported plugin shapes.
 *
 * Shape A (inline metadata, no plugin.json needed):
 *
 *   export default definePlugin({
 *     id: 'hello',
 *     version: '1.0.0',
 *     setup(api) { ... },
 *   });
 *
 * Shape B (plugin.json + lifecycle hooks):
 *
 *   export default definePlugin({
 *     setup(api) { ... },        // called once, at load
 *     async onEnable(api) {},
 *     async onDisable(api) {},
 *     async onUnload(api) {},
 *   });
 */

export function definePlugin(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('definePlugin expects an object');
  }
  const hasSetup = typeof definition.setup === 'function';
  const hasInstall = typeof definition.install === 'function';
  if (!hasSetup && !hasInstall) {
    throw new TypeError('definePlugin requires a setup(api) (or install(api)) function');
  }
  return { __uniplugPlugin: true, ...definition };
}

export function isPluginDefinition(value) {
  return Boolean(value && (value.__uniplugPlugin || typeof value.setup === 'function' || typeof value.install === 'function'));
}
