# 接入笔记：DSH 里做"文件预览"类插件

这份笔记记录 `dsh-ontology-viewer` 实际用到的宿主扩展点、契约和踩过的坑，方便写同类插件时少走弯路。以下 API 以 DSH 0.2.1-rc 系列（`ui-sidebar-documentpreview` / `dsh-better-sidebar` 0.28）为准，具体版本请以你环境里的实现为准。

## 1. 宿主自带右侧栏预览：`ctx.documentPreviews`

DSH 的文件预览是"元数据注册 + keyed 槽位正文"两件套，缺一不可：

```js
// 1) 声明后缀与加载方式，决定下拉框里出现什么、谁默认选中
ctx.documentPreviews.register({
  id: 'my-plugin/graph',                 // 唯一实现 id，同时是槽位 key
  extensions: ['ttl', 'owl', 'rdf'],     // 不带点，小写；'tar.gz' 这样的复合后缀也支持
  priority: 'extension',                 // 'extension' 档优先于宿主 'builtin'
  title: () => '本体图谱',                // 视图下拉框里的名字（可函数，随语言变化）
  loading: 'bytes-complete',             // 'text-pages' | 'bytes-complete' | 'renderer'
  wrap: false,                           // true 才显示换行开关
})

// 2) 正文：keyed、session 作用域的槽位，key = 上面的 id
ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
  name: 'sidebar.right.tab.document',
  key: 'my-plugin/graph',
}, MyBody)))
```

正文组件拿到的 owner props：

| prop | 说明 |
| --- | --- |
| `content` | 按 `loading` 决定形状（见下） |
| `resourceAddress` | 完整文件地址，可用来解出文件名 |
| `wrap` | 头部当前的换行偏好 |
| `scrollportRef` | 把滚动职责交给你的元素；不调用则宿主共享正文负责滚动 |
| `addResource` / `setResources` | 声明依赖文件（变更时自动重载） |
| 标准 hooks | `useTabInfo` / `useResource` / `useSessions` 等，按需解构 |

`loading` 三种模式的取舍：

- `text-pages`：按行分页，**首屏只读第 1 页**；后续分页由文本渲染器自己滚动触发。你的正文如果直接用 `content.text`，会永远只拿到第一页——除非你自己驱动继续读。适合真正的文本类渲染（Markdown、代码高亮）。
- `bytes-complete`：一次性读完整个文件，`content = { kind: 'bytes', data: Uint8Array }`。适合"必须看全文"的渲染（图表、图片、PDF、**本体图谱**）。读取受宿主 `maxFileBytes` 上限（默认 32 MiB）。
- `renderer`：正文自己发起加载请求（`content.reload()` / `content.failed()` / `content.loaded(version)`），最自由也最麻烦。

```js
function MyBody({ content, resourceAddress }) {
  const text = content?.kind === 'bytes' ? new TextDecoder('utf-8').decode(content.data) : ''
  return h(MyView, { text, name: resourceAddress })
}
```

两个容易踩的点：

1. **下拉框排序**：外部注册（`priority: 'extension'`）排在宿主 `builtin` 之前，同档内按后缀长度降序、再按注册顺序。所以声明 `ttl` 就能拿到默认渲染权；用户仍可在头部下拉框切回宿主纯文本。
2. **`binaryExtensions`**：只有当某个后缀的字节**永远不是可读文本**时才声明它；声明后该后缀不再提供纯文本回退，也不会走"未知扩展名当文本读"的兜底。

## 2. dsh-better-sidebar：`ctx.betterSidebar`

装了 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 时，可以用它的服务再挂一个入口（文件树里点开即开页签）：

```js
ctx.inject(['betterSidebar'], (ctx) => {
  ctx.effect(() => ctx.betterSidebar.registerFileViewer({
    id: 'my-plugin/graph',
    title: () => '本体图谱',
    icon: (size) => h(MyIcon, { size }),
    exts: ['ttl', 'owl', 'rdf'],
    priority: 30,                  // 高于内置（0），低于想覆盖它的插件
    fetchStrategy: 'fsRead',       // 宿主读文本后通过 props.content 给你
    component: (props) => h(MyView, props),
  }))
  // 可选：文件树图标
  ctx.effect(() => ctx.betterSidebar.registerFileIcon({
    id: 'my-plugin/icons', exts: ['ttl', 'owl'], icon: (path, size) => h(MyIcon, { size }),
  }))
})
```

`fetchStrategy` 取值与 `FileViewerProps`：

| 策略 | 正文拿到什么 |
| --- | --- |
| `fsRead` | `content: string`（超过可编辑阈值时无 `content`，改给 `largeFile: { size }`） |
| `mediaUrl` | `mediaUrl: string` |
| `custom` | `load(path, scope, signal)` 的返回值 → `customData` |
| `none` | 什么都不给（自己按需取） |
| `binary-download` | 不渲染，只给下载按钮 |

`registerFileViewer` 还支持 `detect(path, head)` 做内容嗅探、`settings` 声明插件设置页里的开关。服务遵循"注册即 effect"：`ctx.effect(() => ctx.betterSidebar.registerFileViewer(...))`，插件卸载时自动撤销。未安装该插件时 `ctx.inject(['betterSidebar'], ...)` 的回调永远不会执行——这就是"可选集成"的正确写法。

## 3. Client 模块格式

DSH 的浏览器插件是一个惰性工厂，浏览器模块表只解析 `react` 这类包名，**不支持相对 import**：

```js
window.__ModuleLoader__.load({
  id: 'my-plugin',                       // = package.json name
  factory(require) {
    const React = require('react')
    const h = React.createElement
    return { inject: ['slots', 'locale'], apply(ctx) { /* ... */ } }
  },
})
```

`package.json` 里声明加载方式：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "immediately": true, "inject": [] }
}
```

- `immediately: true`：启动即加载（注册表类插件必须这样，不能等用户点到才注册）。
- `inject`：客户端模块加载顺序依赖（不是 Cordis 服务注入）；服务依赖在工厂返回的 `inject` 里声明。
- 单文件约束：要么用打包器产出一个文件，要么像本仓库这样把 `src/*.js` 拼接进同一个闭包（源码保持 ES module 便于 Node 测试，构建时去掉 `import`/`export` 再包进工厂）。**记得提交构建产物**，因为安装后浏览器加载的就是它。

## 4. 主题与文案

- 颜色只用 `--dsw-alias-*` 令牌（`bg-layer-1/2/3`、`label-primary/secondary/tertiary`、`border-l1/l2`、`interactive-bg-hover/active`、`brand-primary`），每个都带字面量兜底；需要半透明时用 `color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent)`。
- 文案走宿主 locale：`ctx.locale.register(ns, { zh, en })` + `ctx.locale.bind(ns)`；切换语言时用 `ctx.locale.subscribe` 触发重渲染，别只在挂载时读一次。
- 组件本地样式可以随组件渲染一个 `<style>` 子元素，卸载即清理；不要读写其它插件的 DOM。

## 5. 排查清单

| 现象 | 先看 |
| --- | --- |
| 装了插件但预览没变 | 刷新页面（Client 模块只在页面加载时注册）；确认后缀在 `extensions` 里；看 `<id>/graph` 是否出现在 `sidebar.right.tab.document` 槽位的 occupants（`cordis_inspect_query` 的 `Slots.listSubTree`） |
| 只渲染第一页文本 | `loading` 用了 `text-pages`；改成 `bytes-complete` 或自己驱动分页 |
| 正文高度塌陷 | 外层容器需要 `height: 100%` / `min-height: 0`；或调用 `scrollportRef` 接管滚动 |
| 槽位注册抛错整块空白 | 组件抛异常会让该 slot entry 崩掉（控制台 `slot entry crashed`）；给组件加防御性判空 |
| 换行/下拉框不出现 | `wrap: true` 才有换行；下拉框只在匹配到多个渲染器时出现 |

本仓库中对应的实现：`src/main.js`（两个扩展点注册）、`src/graph-view.js`（视图与主题令牌）、`build/build.mjs`（单文件构建）。
