# uniplug 中文速览

一个**零依赖**的通用 JavaScript 插件系统：清单式插件、生命周期、事件总线、
中间件 Hook、服务注入、配置/存储、托管定时器、权限声明、热重载、脚手架 CLI。
不需要从零开始写插件框架，也不需要写插件的人去猜宿主怎么调用。

完整文档为英文（`README.md`、`docs/`），本页给出最短上手路径。

## 快速开始

```bash
git clone https://github.com/songtian-qqq/uniplug.git
cd uniplug
node bin/uniplug.js init plugins/demo --template advanced
node bin/uniplug.js list
node bin/uniplug.js run demo:status
node examples/demo-app.js
npm test
```

## 宿主接入（三行）

```js
import { createKernel } from 'uniplug';

const kernel = await createKernel({ pluginDirs: ['plugins'] });
await kernel.start();          // 发现 → 依赖排序 → 加载 → 启用
await kernel.emit('app:ready', { port: 8080 });
```

## 插件长什么样

```
plugins/my-plugin/
├── plugin.json      清单：id / version / main / dependencies / permissions / config
├── index.js         代码：export default definePlugin({ setup(api) {...} })
└── README.md
```

```js
export default definePlugin({
  setup(api) {
    api.command('my:hello', (n = 'world') => `你好，${n}`);   // 命令
    api.on('app:ready', (p) => api.log.info('ready', p));      // 事件
    api.hook('http:response', async (res, next) => next(res)); // 中间件
    api.provide('cache', { get: () => {} });                   // 提供服务
    api.poll(10_000, () => api.store.update('ticks', (n) => (n ?? 0) + 1));
  },
  async onEnable(api) {},
  async onDisable(api) {},
});
```

## 关键设计

| 设计 | 含义 |
|---|---|
| `setup` 只执行一次 | 注册的是"声明"，启用/禁用只切换声明是否生效，不会重复注册监听 |
| 禁用即静默 | 事件、Hook、服务、命令全部自动下线，重新启用恢复，无需重跑 `setup` |
| 托管定时器 | `api.every/poll/after`，禁用/重载/卸载自动清理，避免定时器泄漏 |
| 依赖图 + 语义化版本 | 缺依赖直接报错并列出可用插件；循环依赖拒绝启动；可选依赖缺失不致命 |
| 权限声明 | 未声明 `net`/`fs`/`env`/`process` 时调用对应能力抛 `PermissionError` |
| 软沙箱 | `"sandbox": true` 用 `vm` 限制全局与 `require`；**不是安全边界**，见 `docs/SECURITY.md` |
| 错误隔离 | 单个插件 setup/监听器/定时器抛错不影响内核，其余插件照常运行 |

## 目录

```
src/core/     内核、插件状态机、事件、Hook、服务、配置、存储、定时器、权限、沙箱
bin/uniplug.js  CLI：init / list / commands / run / doctor / template
templates/    basic · advanced · sandboxed
examples/     5 个示例插件 + demo-app
test/         node:test 测试套件
docs/         API 参考 · 插件编写指南 · 架构说明 · 安全模型
```

MIT License.
