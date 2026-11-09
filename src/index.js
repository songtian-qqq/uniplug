/**
 * uniplug — a universal, dependency-free plugin system for JavaScript.
 *
 * Typical host application:
 *
 *   import { createKernel, definePlugin } from 'uniplug';
 *
 *   const kernel = await createKernel({ pluginDirs: ['plugins'] });
 *   await kernel.start();
 *   ...
 *   await kernel.stop();
 */

export { createKernel, Kernel, KERNEL_STATE, STATE } from './core/kernel.js';
export { Plugin } from './core/plugin.js';
export { EventBus } from './core/events.js';
export { HookBus } from './core/hooks.js';
export { ServiceContainer } from './core/services.js';
export { Logger, createLogger } from './core/logger.js';
export { ConfigStore } from './core/config.js';
export { Store } from './core/store.js';
export { Scheduler } from './core/scheduler.js';
export { PluginFs } from './core/storage.js';
export { PermissionSet, normalizePermissions } from './core/permissions.js';
export { readManifest, normalizeManifest } from './core/manifest.js';
export { discoverPlugins, resolveOrder, importPluginModule } from './core/loader.js';
export { definePlugin, isPluginDefinition } from './core/define.js';
export { satisfies, valid, compareVersions, parse as parseVersion } from './core/semver.js';
export {
  UniplugError,
  ManifestError,
  DependencyError,
  LifecycleError,
  PermissionError,
  LoadError,
} from './core/errors.js';
