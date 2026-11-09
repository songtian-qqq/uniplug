/**
 * Host-side config file. `createKernel()` picks this up automatically.
 *
 * Everything here can be overridden by passing options to createKernel().
 */

export default {
  pluginDirs: ['examples/plugins'],
  dataDir: '.uniplug',
  logLevel: 'info',
  autoEnable: true,
  continueOnError: true,
  hotReload: false,
};
