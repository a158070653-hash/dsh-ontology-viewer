# 开发指南

本文件面向在本仓库继续开发的 AI / 人类贡献者，只记录**开发、构建、验证**相关的约定。对外功能与用法见 [README](../README.md)，DSH 宿主扩展点契约见 [integration.md](integration.md)，贡献与发版流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 1. 模块职责

| 文件 | 职责 |
| --- | --- |
| `src/rdf-parse.js` | 零依赖 RDF 解析器。识别 Turtle（含 N3 / TriG）、N-Triples（含 N-Quads）、RDF/XML（含 `.owl`）、JSON-LD 子集，统一输出 `{ format, prefixes, base, baseSource, triples, stats, diagnostics, warnings, errors }`；`stats` 含 `truncated`/`truncation`，诊断按 code 聚合，解析永不抛异常。 |
| `src/graph-model.js` | `buildGraph` 把三元组转成 node-link 图（节点分类、字面量归属、平行边合并、列表管道过滤、分层预算与 truncation 元数据）；`layoutGraph` 确定性布局与可中断的 `createLayoutTask`；`matchNodes` / `subgraph` / `neighborhood`；`filterGraph` / `exploreNeighborhood` / `applyEdgeBudget` / `connectionGroups` 只读投影。 |
| `src/ontology-job.js` | 计算任务：状态机、generation 过期识别、Worker 终止/重建、Worker 不可用时的主线程分片布局降级、严格的降级预算。 |
| `src/worker-entry.js` | Worker 侧入口（compute / relayout 协议）。不进入主闭包，只由构建脚本内嵌为 `ONTOLOGY_WORKER_SOURCE`。 |
| `src/graph-view-style.js` | 视图 CSS、常量、kind 元数据（仅主题令牌）。 |
| `src/graph-view-controls.js` | 纯状态辅助函数 + 工具栏/搜索/过滤/探索/提示条组件工厂。 |
| `src/graph-view-details.js` | 纯详情辅助函数 + 详情面板组件工厂（分组、折叠、抽屉）。 |
| `src/graph-view.js` | `createOntologyGraphView(React)` 返回 SVG 图谱组件：编排过滤→探索→绘制预算、缩放平移、拖拽、悬停高亮、搜索、详情、主题令牌样式。布局坐标由 props 传入，视图不再自行布局。 |
| `src/main.js` | Client 插件入口 `apply(ctx)`：注册 locale、DSH 原生文档预览（`ctx.documentPreviews` + `sidebar.right.tab.document`）、可选 better-sidebar viewer / icon；`OntologyPanel` 负责读取状态、计算任务调度与错误展示。 |
| `build/build.mjs` | 把上述主闭包模块按固定顺序拼成单文件 `client.js`，并确定性生成内嵌 Worker 源；`--check` 只校验不写入。 |
| `index.js` | Host 半侧空实现，只为插件在 profile 中有一行可启停记录。 |
| `cordis.patch.yml` | 把 Host 行插入 profile 配置树。 |
| `tests/` | Node 单元测试：解析、图模型、计算任务、视图状态辅助函数、示例端到端、打包接线。 |
| `scripts/` | `check-i18n.mjs`、`pipeline-check.mjs`、`bench.mjs`、`pack-release.mjs`。 |

调用链（Client 侧）：`OntologyDocumentBody` / `OntologySidebarViewer` → `OntologyPanel` → `createOntologyRunner` →（Worker 或主线程降级）`parseOntology` → `buildGraph` → `layoutGraph`/`createLayoutTask` → `OntologyGraphView`（`filterGraph` → `exploreNeighborhood` → `applyEdgeBudget` → SVG）。

## 2. 构建与测试命令

在仓库根目录执行（Node.js >= 22，无需 `npm install`）：

```bash
npm test             # 当前全部单元测试（数量随演进，不是契约）
npm run build        # 由 src/ 重新生成 client.js（含内嵌 Worker 源，会写入文件）
npm run build:check  # 校验 client.js 与 src/ 字节一致（不写入）
npm run check        # node --check client.js + build --check + 全部测试
npm run i18n         # 全部 UI 模块文案 key 是否在 ZH / EN 字典中都存在
npm run stats        # 5 个示例 + 2 万语句压力用例的解析/建图/布局统计
npm run bench        # 五类夹具的分阶段性能基准（opt-in，不进 CI）
npm run pack:release # 生成 Release 用的固定文件名 dsh-ontology-viewer.tgz
```

CI（`.github/workflows/ci.yml`）在 Ubuntu + Node 22 上执行：`node --check client.js`、`build --check`、单元测试、`check-i18n.mjs`。CI **不执行** `stats` 与 `pack:release`。

## 3. Client bundle 的生成方式

DSH 每个 Client 模块只加载一个文件，浏览器模块表只解析 `react` 这类包名，不支持相对 import。因此：

- `src/*.js` 保持普通 ES module，便于 Node 直接 import 测试；
- `build/build.mjs` 按固定顺序拼接主闭包模块（`rdf-parse` → `graph-model` → `ontology-job` → `graph-view-style` → `graph-view-controls` → `graph-view-details` → `graph-view` → `main`），包进 `window.__ModuleLoader__.load({ id: 'dsh-ontology-viewer', factory(require) { ... } })`；
- 构建同时读取 `rdf-parse` + `graph-model` + `worker-entry`，按同样规则去掉 `export`、包成 IIFE，确定性生成 `const ONTOLOGY_WORKER_SOURCE = "..."` 内嵌进 `client.js`；这保持"一个 Client 文件、不额外请求资源"的契约；
- 构建会**拒绝**源码中的 `import` 语句与 `export default`，并剥离 named export；源码模块之间通过同一闭包内的标识符直接调用；
- 生成的文件是 `client.js`，安装后浏览器实际加载它，必须与源码一起提交；
- `npm run build:check` 是逐字节比较，不一致时退出码 1；`.gitattributes` 固定 LF，避免跨平台换行差异。

不要手改 `client.js`。改 `src/` 后运行 `npm run build`，再跑 `npm run check`。

## 4. DSH 接入方式

### 4.1 原生右侧栏预览（必需）

```js
ctx.documentPreviews.register({
  id: 'dsh-ontology-viewer/graph',
  extensions: ONTOLOGY_EXTENSIONS,
  priority: 'extension',
  title: () => ...,
  loading: 'bytes-complete',
  wrap: false,
})
ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
  { name: 'sidebar.right.tab.document', key: 'dsh-ontology-viewer/graph' },
  OntologyDocumentBody,
))
```

元数据注册与 keyed 槽位正文必须成对出现，key 一致。`bytes-complete` 表示一次性拿全文，适合图谱；用户仍可在预览头部下拉框切回宿主纯文本。

### 4.2 better-sidebar（可选）

```js
ctx.inject(['betterSidebar'], (inner) => {
  inner.effect(() => inner.betterSidebar.registerFileViewer({ /* id, exts, priority, fetchStrategy: 'fsRead', component */ }))
  inner.effect(() => inner.betterSidebar.registerFileIcon({ /* id, exts, icon */ }))
})
```

未安装 `dsh-better-sidebar` 时 `ctx.inject` 回调不会执行，插件退化为仅原生预览。不要把该依赖改成硬依赖。完整参数与坑位见 [integration.md](integration.md)。

## 5. 运行时探查与验证方法

按“从静态到真实界面”的顺序逐级验证，不要跳级宣称通过：

1. **静态与产物**：`node --check client.js`、`npm run build:check`。
2. **逻辑行为**：`npm test`，必要时 `npm run stats` 看示例与压力用例的解析/建图/布局是否符合预期。
3. **打包接线**：`tests/bundle.test.mjs` 用 VM + fake React / fake ctx 加载**打包后的** `client.js`，验证 `documentPreviews`、`sidebar.right.tab.document`、`betterSidebar` viewer/icon、locale 四类注册；它不渲染组件，不是 UI 测试。
4. **宿主挂载**：以 link 或 GitHub 方式安装后刷新 DSH 页面，确认插件行可启停；可用 `dsh --profile <name> --dump-config` 检查 bundle 是否进入 profile（Electron 托管的 profile 可能拒绝 CLI 调用，此时以应用内插件列表为准）。创造模式下若提供 `cordis_inspect_list` / `cordis_inspect_query`，用它们查询真实 Slots、Service、Config 与 Theme；否则以浏览器控制台和 integration.md 第 5 节排查清单为准。
5. **Worker 探针（新增能力）**：在真实页面确认 client.js 被加载（Network rev / 刷新）、主文档 CSP（含 `worker-src` / `default-src` 回退）、classic Blob Worker 构造与 `postMessage` 往返、worker 内真实解析结果与主线程一致、`terminate()` 与 `revokeObjectURL` 后无残留且可重建。**其它插件的 Worker 先例不构成可用性证据**；未通过则必须走降级路线。
6. **真实 UI 验收**：在 DSH 页面点开 `examples/` 中的文件，检查明暗主题、窗口宽度、过滤/多跳/详情/搜索、悬停/拖拽/缩放/适配、错误与截断提示等。视觉与交互无法由 Node 测试替代。

**验证边界**：仓库现有证据是当前全部 Node 测试（数量随演进，不是契约）+ 构建一致性 + i18n 覆盖 + VM 级 bundle 接线 + 性能基准；README 的“验证状态”也明确说明作者环境未做浏览器视觉验收。因此：

- 不得把“注册成功 / 测试通过”写成“UI 已验证”；
- 视觉或交互改动需在真实 DSH 页面验证，并在 PR 描述中给出步骤或截图；
- Worker 与主线程分片布局的收益/降级必须记录真实页面证据；
- 未执行的验证必须标注。

## 6. 已知边界与文档差异（当前代码事实，勿据此改行为）

以下是当前实现与部分文档表述的差异，记录用于避免误判；各能力规格末尾的“已知偏差与待修复事项”是这些条目的规格侧对应记录：

- **`f` 快捷键**：`0` 与 `f` 当前都执行适配视图，没有键盘重新布局；“重新布局”只有按钮。规格已按实际行为校准，是否给 `f` 单独语义属于后续产品决策。
- **整个 locale 服务缺失不受支持**：Client 工厂声明 `inject: ['slots', 'locale']`，`apply` 在 `ctx.effect` 中直接调用 `ctx.locale.register(...)`，没有服务存在性判断；完全无 `ctx.locale` 时插件不会正常装载。现有回退只覆盖“locale 服务存在但单次查询失败/未就绪”的词典回退。
- **`.xml` 后缀**：解析器 `detectFormat` 能识别 `.xml` 为 RDF/XML，README 格式表也列出 `.xml`；但 `src/main.js` 的 `ONTOLOGY_EXTENSIONS` 未包含 `xml`，因此原生预览/文件树不会默认接管 `.xml` 文件。
- **源大小上限**：`MAX_SOURCE_BYTES = 12 MiB`，已按 UTF-8 字节测量（字节内容用 `byteLength`，字符串用 `TextEncoder`）；better-sidebar 入口受其宿主 5 MiB 读取阈值限制，两入口上限不同且分别提示。
- **构建剥离 import**：文档写作“去掉 import/export”，实际 `build/build.mjs` 遇到 `import` 会直接报错拒绝；源码必须自包含。
- **TriG / N-Quads**：仍不实现 dataset / named graph 语义；图标签/第四列被忽略时产生 `named-graph-ignored` 诊断，内部三元组保留。
- **JSON-LD**：仅实现常用 1.1 子集；不支持的结构改为分类诊断（`jsonld-*` code）；节点级 `@index` / `@language` 仍静默跳过（无单独诊断）。
- **RDF/XML**：`rdf:ID` 具体化未实现、未支持的 `rdf:parseType` 会给出诊断；一个属性元素多个对象时只取第一个并诊断。
- **CRLF**：输入不会被 CRLF 归一化；仅剥离开头 BOM，`\r` 作为空白被接受，多行字面量内部保留原始换行。
- **搜索排序**：`matchNodes` 的“前缀匹配”层只覆盖 label / local 前缀；IRI 前缀命中落在最低的“local/IRI 子串”层。
- **断开分量的布局**：按连通分量网格播种加弱重力，只保证“分散、不全部挤在中心”，不保证任意节点互不重叠。
- **预算默认值**：解析器默认 `maxTriples=100000`（宿主传 120000）、`buildGraph` 默认 `maxNodes=1200`（宿主传 1500）、绘制边 6000、降级模式 60000/800/3000、`layoutGraph` 默认 320 次迭代（上限 2000）。这些是可被调用方覆盖的当前默认值，不是永久契约；数字以 `npm run bench` 的测量结果为依据调整。
- **Worker 可用性**：Worker 路线依赖真实 DSH 页面探针结果；本仓库当前没有该探针的运行时证据，未通过时必须走降级路线，不得把源码中的其它 Worker 先例当成通过证据。
- **bundle 体积**：内嵌 Worker 源后 `client.js` 约 6.0×10^5 字符（构建产物以 `npm run build` 输出为准），比 V1.0.0 的约 1.96×10^5 字符显著增大；这是保持单文件加载契约的代价。
- **测试数量**：`npm test` 当前为 130 个测试；数量随代码演进，验证要求是“仓库当前全部测试通过”，不要把具体数字写成门槛。
- **发布包内容**：`package.json` 的 `files` 不含 `tests/`、`examples/`、`docs/`、`.github/`、`openspec/`，这是 npm 安装包与仓库的区别，不是遗漏。

## 7. OpenSpec

本仓库使用 OpenSpec `spec-driven` 工作流，配置在 `openspec/config.yaml`，已确认能力在 `openspec/specs/`，进行中变更在 `openspec/changes/`。新功能、重大修复、接口变更与重要重构先走 Explore / Propose；实施后按影响运行第 2 节命令并做必要人工验收；Archive 只在人工明确要求时单独执行。规则入口见 [AGENTS.md](../AGENTS.md)。
