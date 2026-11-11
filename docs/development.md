# 开发指南

本文件面向在本仓库继续开发的 AI / 人类贡献者，只记录**开发、构建、验证**相关的约定。对外功能与用法见 [README](../README.md)，DSH 宿主扩展点契约见 [integration.md](integration.md)，贡献与发版流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 1. 模块职责

| 文件 | 职责 |
| --- | --- |
| `src/rdf-parse.js` | 零依赖 RDF 解析器。识别 Turtle（含 N3 / TriG）、N-Triples（含 N-Quads）、RDF/XML（含 `.owl`）、JSON-LD 子集，统一输出 `{ format, prefixes, base, baseSource, triples, stats, diagnostics, warnings, errors }`；每条语句含 `graph={kind:default|iri|blank|unknown,value?}` 与 `location=null`；`stats` 含 `truncated`/`truncation`，诊断按 code 聚合，解析永不抛异常。身份适配：`navigationAddress`（DSH 路由）不参与 Base，`absolutePath` 经统一转换函数得到 `file:` URI。 |
| `src/ontology-identity.js` | 跨文件实体键：绝对 IRI 自证身份；空白节点、未解析相对 IRI、unknown 图按来源隔离；内部键使用 U+0000 标记 + 长度前缀，不能被 RDF 字符串伪造。 |
| `src/graph-model.js` | `buildGraph` 把语句转成 node-link 图（节点分类、字面量归属、平行边合并、列表管道过滤、分层预算与 truncation 元数据），并为节点/字面量/边附加 `sourceIds`/`statementIds`/`graphs` 来源；`layoutGraph` 确定性布局与可中断的 `createLayoutTask`；`matchNodes` / `subgraph` / `neighborhood`；`filterGraph` / `filterBySources` / `exploreNeighborhood` / `applyEdgeBudget` / `connectionGroups` 只读投影。 |
| `src/ontology-workspace.js` | 多文件 L0：来源记录与准入预算（文件数/总字节/语句出现记录）、添加/移除/原子重载、合并索引（相同语句保留全部来源）、单/联合工作集组合为 L1 图、来源摘要。 |
| `src/ontology-views.js` | 类/属性层级投影（显式 `rdfs:subClassOf` / `rdfs:subPropertyOf`、根/孤立/多重继承/循环 SCC、惰性展示引用与预算）、分层关系图（谓词投影、SCC 收缩、确定性分层布局、内部边/组）。 |
| `src/graph-export.js` | 显示场景快照（视口/完整布局两种范围）、白名单安全 SVG 渲染与转义、PNG 像素/单边预算预检、浏览器内栅格化与失败回退。 |
| `src/ontology-job.js` | 计算任务：状态机、generation 过期识别、Worker 终止/重建、主线程分片布局降级；工作区协议：`parse-source` / `compose` / `drop-source`，一个 Workspace Worker 缓存已解析来源，组合不重新解析。 |
| `src/worker-entry.js` | Worker 侧入口（compute / relayout / parse-source / compose 协议）。不进入主闭包，只由构建脚本内嵌为 `ONTOLOGY_WORKER_SOURCE`。 |
| `src/graph-view-style.js` | 视图 CSS、常量、kind 元数据（仅主题令牌）。 |
| `src/graph-view-controls.js` | 纯状态辅助函数 + 工具栏/搜索/过滤/探索/提示条组件工厂。 |
| `src/graph-view-details.js` | 纯详情辅助函数 + 详情面板组件工厂（分组、折叠、抽屉）。 |
| `src/graph-view.js` | `createOntologyGraphView(React)` 返回 SVG 图谱组件：编排过滤→探索→绘制预算、缩放平移、拖拽、悬停高亮、搜索、详情、主题令牌样式；支持受控选择与相机上报（供工作区与导出使用）。 |
| `src/graph-view-multiview.js` | 工作区 UI：紧凑工具栏、来源面板、类层级树、分层关系图、来源详情、导出菜单；纯辅助函数（展开列表、来源状态 key、谓词选项）。 |
| `src/graph-view-workspace.js` | 工作区控制器 `OntologyWorkspacePanel`：主文件 + 附加本地来源、视图切换、共享选择、导出；管理 runner 生命周期与状态屏。 |
| `src/main.js` | Client 插件入口 `apply(ctx)`：注册 locale、DSH 原生文档预览（`ctx.documentPreviews` + `sidebar.right.tab.document`）、可选 better-sidebar viewer / icon；两个正文都渲染工作区面板，并从宿主资源元数据取得 `absolutePath`。 |
| `build/build.mjs` | 把上述主闭包模块按固定顺序拼成单文件 `client.js`，并确定性生成内嵌 Worker 源；`--check` 只校验不写入。 |
| `index.js` | Host 半侧空实现，只为插件在 profile 中有一行可启停记录。 |
| `cordis.patch.yml` | 把 Host 行插入 profile 配置树。 |
| `tests/` | Node 单元测试：解析、身份/Base、工作区合并、图模型、查看投影、导出、计算任务、视图状态辅助函数、示例端到端、打包接线。 |
| `scripts/` | `check-i18n.mjs`、`pipeline-check.mjs`、`bench.mjs`（含多文件 compose/投影基准）、`pack-release.mjs`。 |

调用链（Client 侧）：`OntologyDocumentBody` / `OntologySidebarViewer` → `OntologyWorkspacePanel` → `createOntologyRunner` →（Worker 或主线程降级）`parseOntology`（每来源）→ `addSource`（L0）→ `composeWorkspaceGraph` → `buildGraph`（L1）→ `layoutGraph`/`createLayoutTask` → `OntologyGraphView`（`filterBySources` → `filterGraph` → `exploreNeighborhood` → `applyEdgeBudget` → SVG）或 `buildHierarchy`/`layoutLayeredGraph`（类树/分层视图）。

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
- `build/build.mjs` 按固定顺序拼接主闭包模块（`rdf-parse` → `ontology-identity` → `graph-model` → `ontology-workspace` → `ontology-views` → `graph-export` → `ontology-job` → `graph-view-style` → `graph-view-controls` → `graph-view-details` → `graph-view` → `graph-view-multiview` → `graph-view-workspace` → `main`），包进 `window.__ModuleLoader__.load({ id: 'dsh-ontology-viewer', factory(require) { ... } })`；
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

**验证边界**：1.1.0 已保留 DSH Desktop 0.2.2-rc.1（Windows x64）的真实页面记录、原生预览与 better-sidebar 0.30.1 的选定路径、SVG/PNG 样例，以及 Node 测试、构建一致性、i18n、VM 接线与基准。详细证据见 [验收归档](../openspec/changes/archive/2026-11-11-add-ontology-multiview-workspace/verification.md)；平台与版本范围见 [兼容说明](compatibility.md)。后续改动仍需按范围重新验证：

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
- **TriG / N-Quads**：保留可解析的图身份到语句 `graph={kind:default|iri|blank|unknown,value?}`；正常保留时不发 `named-graph-ignored`；无法可靠保留的图上下文标 `unknown` 并给分类诊断。仍未实现 dataset 查询/推理语义。
- **JSON-LD**：仅实现常用 1.1 子集；不支持的结构改为分类诊断（`jsonld-*` code）；节点级 `@index` / `@language` 仍静默跳过（无单独诊断）；带 `@id` 的命名 `@graph` 保留语句但标 `unknown` 图身份并诊断 `named-graph-unavailable`。
- **身份与 Base**：`src/rdf-parse.js` 的 `navigationAddress`（DSH 会话路由）永不作为 RDF Base；`absolutePath` 经 `fileUriFromPath` 统一转换（Windows 盘符大写、UNC authority、POSIX、按路径段 UTF-8 百分号编码，原始 `%20` 编码为 `%2520`，已编码 URI 不重复解码）。原生入口从宿主资源元数据取 `absolutePath`；取不到时相对 IRI 来源隔离并诊断，不伪造路径。
- **多文件合并**：L0 为有界解析语句，L1 为预算图；相同完整 IRI 合并、空白节点按来源隔离、重复语句保留全部来源与命名图身份。来源移除/重载按贡献更新，不从裁剪图逆推。工作区候选护栏：16 文件 / 24 MiB 总源 / 12 万语句出现记录（可下调，以基准为准）。
- **导出**：SVG 白名单 + 文本转义，禁止脚本/外部引用/事件属性/DTD/CSS URL；PNG 先做 16M 像素、8192 单边预检，失败回退 SVG；下载只能确认“已发起”。
- **RDF/XML**：`rdf:ID` 具体化未实现、未支持的 `rdf:parseType` 会给出诊断；一个属性元素多个对象时只取第一个并诊断。
- **CRLF**：输入不会被 CRLF 归一化；仅剥离开头 BOM，`\r` 作为空白被接受，多行字面量内部保留原始换行。
- **搜索排序**：`matchNodes` 的“前缀匹配”层只覆盖 label / local 前缀；IRI 前缀命中落在最低的“local/IRI 子串”层。
- **断开分量的布局**：按连通分量网格播种加弱重力，只保证“分散、不全部挤在中心”，不保证任意节点互不重叠。
- **预算默认值**：解析器默认 `maxTriples=100000`（宿主传 120000）、`buildGraph` 默认 `maxNodes=1200`（宿主传 1500）、绘制边 6000、降级模式 60000/800/3000、`layoutGraph` 默认 320 次迭代（上限 2000）。这些是可被调用方覆盖的当前默认值，不是永久契约；数字以 `npm run bench` 的测量结果为依据调整。
- **Worker 可用性**：1.1.0 的真实 DSH 探针记录了 Blob Worker 构造/通信/终止/URL 回收与工作区导入组合；证据只适用于已验收环境。新宿主或 CSP 改动后需重新探测；不可用时走降级路径，不以其它插件的 Worker 先例推断可用。
- **多文件入口**：方案 A（官方 `remote.workspaceFiles` 逐目录复选）的客户端授权、取消与读取尚未在真实运行环境验证，因此当前 UI 只用方案 B（浏览器本地文件选择）；A 的实现保留为后续启用项，不能把 README/Inspect 的接口存在当作已验收。
- **bundle 体积**：含内嵌 Worker 源与多视图模块后 `client.js` 约 8.8×10^5 字符（构建产物以 `npm run build` 输出为准），比 V1.0.0 的约 1.96×10^5 字符显著增大；这是保持单文件加载契约的代价。
- **测试数量**：`npm test` 的数量随功能演进，验证要求是“仓库当前全部测试通过”，不要把具体数字写成门槛。
- **发布包内容**：`package.json.files` 包含运行文件、README、CHANGELOG 与 `docs/compatibility.md`；不含测试、示例、其余开发文档、CI 与 OpenSpec 验收归档。安装包与完整仓库用途不同；发版时必须核对实际 tarball 清单。

## 7. OpenSpec

本仓库使用 OpenSpec `spec-driven` 工作流，配置在 `openspec/config.yaml`，已确认能力在 `openspec/specs/`，进行中变更在 `openspec/changes/`。新功能、重大修复、接口变更与重要重构先走 Explore / Propose；实施后按影响运行第 2 节命令并做必要人工验收；Archive 只在人工明确要求时单独执行。规则入口见 [AGENTS.md](../AGENTS.md)。
