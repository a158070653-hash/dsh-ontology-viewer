# Design

## Context

本设计以 V1.0.0 基线（`openspec/specs/`）与当前源码为事实基础，证据来自 2026-11-09 的只读审计（文件与行号），不是对历史审查结论的转述。审计确认的关键事实：

- 解析入口 `parseOntology` 只透传 `fileName/format/maxTriples`（`src/rdf-parse.js:2592`），Base IRI 来自 `ontoRdfFileBase(fileName)`（`:119-127, 487-488, 1140-1141, 1379-1380, 1963-1964`），而两个宿主入口都只传显示文件名（`src/main.js:178-187, 332, 385`）。
- 解析结果 stats 只有 4 个计数（`src/rdf-parse.js:206-219`），内部 `truncated` 未输出（`:144`）；`src/main.js:229/258` 读取不存在的 `stats.truncated`，截断徽标不可达。
- 解析、建图与布局全部同步跑在主线程；布局在渲染期 `useMemo` 中执行 320 次迭代（`src/graph-view.js:228-230`），`setTimeout(...,0)` 是唯一的异步让步（`src/main.js:221`）。
- 预算只有源大小/三元组/节点/字面量/标签/搜索，没有边数或 SVG 元素预算；1500 节点/5 万边约 5.75 万 SVG 元素（`src/graph-view.js:670-755`）。
- `graph-view.js` 共 899 行，其中单个组件约 731 行；`no-import` + 固定拼接顺序是硬约束（`build/build.mjs:22-27,36-41`）。
- DSH 运行时：活动 profile 为 desktop，插件以 `link:` 安装；渲染页 `dsh-app://app/`，client.js 经 `/plugins` 路由以经典 `<script>` 加载；主文档静态未发现 CSP；DSH 自身客户端已有 3 处 Blob URL Worker 先例（classic ×2、module ×1）。这些是**代码事实**，Worker 真机行为仍属待验证假设（见 §12）。

## 1. 解析层与图模型的数据契约

### 1.1 三个概念分离：显示名 / 真实资源地址 / RDF Base IRI

| 概念 | 来源 | 用途 |
| --- | --- | --- |
| 显示名 `displayName` | `fileNameOf(resourceAddress)`（原生预览）、`fileNameOf(path)`（better-sidebar） | 标题、`data-ontology-source`、诊断文案；**不再参与 IRI 构造** |
| 真实资源地址 `address` | 原生预览 `resourceAddress`；better-sidebar `path`（绝对文件路径） | Base IRI 的候选来源；未来源文件定位的锚点 |
| RDF Base IRI | 由 `address` 规范化，再被文档内 `@base` / `xml:base` / JSON-LD `@base` 覆盖 | 相对 IRI 解析 |

Base 解析优先级（从高到低）：

1. 文档内声明（`@base`、`xml:base`、JSON-LD `@context.@base`）——保持现行为，且**优先于任何资源地址**；
2. 资源地址映射（见下）；
3. 无可用地址：Base 为空，相对 IRI 保持原样并产生 `base-unavailable` 诊断，**不再伪造 `file:///文件名`**。

资源地址映射策略（不假设 `resourceAddress` 一定是标准文件 URI）：

| 地址形态 | 处理 |
| --- | --- |
| 绝对 URI：`http:` / `https:` / `file:` | 原样作为 Base（剥离 fragment） |
| 其它自定义 scheme（如宿主自定义协议） | 仅当能解析出绝对分层 URI（scheme + authority 或绝对 path）时原样用作 Base；否则不猜、不拼 `file:///`，退化为“无可用地址”并给 `base-unavailable` 诊断 |
| POSIX 绝对路径 `/...`、Windows 盘符路径 `X:\...`/`X:/...`、UNC `\\server\share` | 规范化为 `file:///` URL（保持现有编码规则） |
| 缺失、相对路径、空串、无法判定 | 视为不可用；显示名仍可用于标题，但不参与身份 |

- 剥离 fragment 只影响 Base 推导，显示名保持完整派生结果。
- `resourceAddress` 的真实格式在 DSH 运行时未完全验证（见 §12），因此映射必须防御性实现：无法可靠映射时给出诊断而不是猜测；两个入口传入不同 form（原生预览地址 / better-sidebar 绝对路径）也必须落到同一映射规则。
- 兼容策略：`parseOntology` 新增可选 `resourceAddress`；旧 `fileName` 仅在“未提供 resourceAddress”时按旧行为推导（供库调用者与既有测试），但 `src/main.js` 两个入口都必须传真实地址，显示名单独传递。不同目录的同名文件因此得到不同 IRI；同一文件在原生预览与 better-sidebar 两个入口得到一致 IRI。

不做：不联网、不用 `document.baseURI`（与文件资源无关）、不改变 `detectFormat` 对文件名的使用。

### 1.2 `parseOntology` 返回契约（向后兼容的增量）

```text
{
  format, prefixes,
  base: string,                       // 解析结束时的有效 Base（保持字符串）
  baseSource: 'document'|'resource'|'none',
  triples: [{ s, p, o, oKind, dt?, lang? , g? }],
  stats: {
    tripleCount, subjectCount, predicateCount, objectCount,
    truncated: boolean,               // 新增
    truncation: null | { reason:'triple-limit', limit, kept }  // 新增
  },
  diagnostics: [{ code, severity, message, count, sample? }],  // 新增，按 code 聚合
  warnings: string[],                 // 保持（人类可读、既有测试依赖）
  errors: string[]                    // 保持
}
```

- `warnings/errors` 继续存在，保证既有调用与测试的兼容；新增 `diagnostics` 是机器可读的分类视图（UI 用它做本地化与聚合）。
- 达到 `maxTriples` 后，**所有格式**都必须停止继续解析：构建器的 `add()` 返回 false，解析循环检查 `builder.truncated` 并退出（当前 Turtle/N-Triples 已短路，JSON-LD/RDF-XML 未短路，需补齐）。
- `g`（命名图）本次**不保留**：TriG/N-Quads 仍按"忽略图名、保留内部三元组"处理，但必须产生 `named-graph-ignored` 诊断，并在文档中明确数据集语义不支持。保留 `g` 会改变三元组身份与建图语义，超出本次范围。

### 1.3 诊断分类（语义损失的能力边界）

诊断对象 `{ code, severity, message, count, sample }`，同一 code 聚合并累计 `count`，`sample` 最多保留 3 条原始消息；原始 `warnings/errors` 也设置条数上限（默认 200 条，超出后 `diagnostics` 记 `diagnostics-truncated` 并继续计数）。诊断 code 初版：

| code | 触发 | 级别 |
| --- | --- | --- |
| `base-unavailable` | 相对 IRI 需要 Base，但文档声明与可映射资源地址都不存在 | warning |
| `named-graph-ignored` | TriG 图标签 / N-Quads 第四列被忽略 | warning |
| `jsonld-remote-context-skipped` | 远程 `@context` 不联网 | warning |
| `jsonld-node-reverse-ignored` | 节点级 `@reverse` 跳过 | warning |
| `jsonld-included-nest-ignored` | `@included` / `@nest` 跳过 | warning |
| `jsonld-value-object-dropped` | 节点位置出现 `@value/@list/@set` | warning |
| `jsonld-graph-sibling-ignored` | 顶层 `@graph` 的兄弟键被丢弃（**修复后**改为按节点合并，不再丢） | warning→无 |
| `jsonld-container-unsupported` | 不支持的 `@container` | warning |
| `jsonld-reverse-term-forward` | term 级 `@reverse` 按正向展开 | warning |
| `rdfxml-reification-ignored` | 属性元素上的 `rdf:ID` 具体化未实现 | warning（每文档一次） |
| `rdfxml-parsetype-unsupported` | 未支持的 `rdf:parseType` | warning |
| `rdfxml-multiple-objects` | 一个属性元素多个对象，只取第一个 | warning（按父节点去重） |
| `nesting-limit` | 嵌套深度超过上限，停止该分支 | error |
| `literal-limit` | 字面量长度超过上限被截断 | warning |
| `triple-limit` | 三元组达到上限 | warning |
| `diagnostics-truncated` | 诊断条数超过上限 | warning |

明确修复（不是新增诊断）：

- JSON-LD term 级 `@container:"@list"` 必须按列表展开（修正 `src/rdf-parse.js:2310-2315` 的提前展开顺序）。
- JSON-LD 顶层对象同时含 `@graph` 与兄弟键时，兄弟键不得被丢弃：`@graph` 内容与兄弟键共同处理（`examples/courses.jsonld` 的 2 条丢失三元组必须恢复，回归测试固化）。

OWL 复杂限制表达式：审计确认现有通用映射会把 `owl:Restriction` / `onProperty` / `someValuesFrom` 等保留为普通三元组（`examples/zoo.owl` 实测 5 条三元组、0 警告），因此本次不新增 OWL 专用诊断或推理语义；只用回归测试固化“结构被保留、不伪造推理关系”，并在 README 声明不支持 OWL 推理的能力边界。

### 1.4 图模型契约

`buildGraph(parsed, options)` 保持 `{ nodes, edges, stats, warnings }` 形状并增量扩展：

```text
{
  nodes: [{ id,label,iri,local,kind,types,degree,literals,outEdges,inEdges,
            literalsTruncated,          // 新增：被丢弃的字面量条数（0 表示未截断）
            source: null }],            // 新增：为源文件定位预留，本次恒为 null，不得伪造
  edges: [{ id,source,target,p,label,kind,count }],
  stats: { ...现有, droppedNodes, droppedEdges, droppedLiterals },
  truncation: {                          // 新增，全部为 0 时不存在或为 null
    nodes: { kept, dropped },
    literals: { perNodeLimit, truncatedNodes },
    edges: { kept }
  },
  source: { address, displayName, format }   // 新增：来源元数据，供详情/诊断显示
}
```

- 节点/边/字面量上限继续由调用方传入；新增可选 `maxEdges`（默认不启用，渲染层预算见 §8）。
- `layoutGraph` 签名、默认值与确定性保持不变；新增不改变数学结果的替代入口 `createLayoutTask(graph, options)`（见 §3.4），供主线程分片使用。
- 新增纯函数（可 Node 测试，不依赖 React/DOM）：
  - `filterGraph(graph, criteria, options)` → `{ graph, stats, hidden }`，`criteria = { kinds?: string[], predicates?: string[], direction: 'both'|'out'|'in', anchorId?: string }`；
  - `exploreNeighborhood(graph, options)` → `{ nodeIds, edges, stats, truncated, nextBudget }`，`options = { startId, depth, direction, predicates, budget }`；保留 `neighborhood` 不变；
  - `connectionGroups(graph, nodeId)` → 按谓词分组的入/出边列表（供详情面板，见 §6）；
  - `applyEdgeBudget(graph, budget)` → `{ nodes, edges, stats:{keptEdges, hiddenEdges} }`，纯函数、确定性。

### 1.5 五层数据模型与统计来源（评审补强）

必须显式区分以下五层，任何功能都必须声明自己读取哪一层：

| 层 | 内容 | 产生方式 | 允许的消费者 |
| --- | --- | --- | --- |
| L0 原始解析数据 | `parsed.triples`（可能被 `maxTriples` 截断）、diagnostics | 解析器 | 建图、诊断展示、计数来源 |
| L1 已保留图模型 | `fullGraph`（节点/字面量/边已受建模预算） | 建模 | 搜索、详情关系、邻域遍历、总计统计 |
| L2 过滤后模型 | `filteredGraph` | 只读投影 | 探索起点、过滤计数 |
| L3 探索结果 | `exploredGraph` | 受预算的多跳 BFS | 探索计数、绘制输入 |
| L4 实际绘制结果 | `drawnGraph` | 边/元素预算投影 | **仅 SVG 渲染与"已绘制"计数** |

硬规则：

- 搜索、邻域遍历、关系详情与"总数"统计 MUST NOT 依赖 L4；绘制裁剪只影响显示。
- 详情面板的关系列表来自 L1（完整已保留模型），并标注当前是否在绘制集合中；不得因边预算裁剪而假装节点没有关系。
- 头部计数必须同时给出"可见（L4）/ 总数（L1）"，多跳与过滤分别报告自己的层级统计。
- 每一级预算都记录 `{ total, kept, truncated, reason }`：解析层按三元组，建模层按节点/字面量/边，绘制层按边与元素，探索层按每跳新增节点与全局边。任何 `truncated > 0` 都必须进入结构化提示。

### 1.6 入口可读上限差异

- DSH 原生预览：宿主 `bytes-complete` 上限默认 32 MiB，插件自身 12 MiB 上限先生效。
- better-sidebar：其文件读取上限为 5 MiB（`MAX_EDITABLE_BYTES`），超过后只提供 `largeFile: { size }`，插件实际拿不到内容。
- 结论：两个入口可处理的文件大小不同，插件 MUST 按入口能力提示各自的真实上限（原生预览 12 MiB；better-sidebar 5 MiB 由宿主限制，插件不修改其配置），不得把 12 MiB 文案套用到 better-sidebar，也不得为了让 better-sidebar 读大文件去修改宿主/其它插件。

## 2. 截断与诊断信息的传递

### 2.1 传递链路

```text
parser: builder.truncated ──► parsed.stats.truncated + parsed.stats.truncation + diagnostics[triple-limit]
   │
buildGraph: 上限丢弃 ──► graph.truncation.{nodes,literals} + graph.stats.droppedNodes/droppedLiterals + warnings
   │
view projection: 边预算 ──► render.stats.{keptEdges,hiddenEdges}（不修改 graph）
   │
UI: 顶部状态条 + 徽标 + 详情内的 per-node 提示；计数按"可见/总数"显示
```

- `src/main.js` 不再读取不存在的字段，改为组合 `parsed.stats.truncated`、`graph.truncation` 与投影预算，向视图传 `truncation = { source, triples, nodes, literals, edges }` 的结构化对象；视图不再只依赖一个布尔。
- 用户可见文案分三类：**输入截断**（三元组达到上限）、**图谱裁剪**（节点/边被预算裁剪）、**字面量截断**（每节点上限）。每类都给出"保留 X / 上限 Y"的数量，而不是笼统的"已截断"。
- 诊断在提示条中按 code 聚合显示（本地化标签 + 次数），展开后才显示原始消息样本；错误与警告分区。避免当前 5000 条错误逐条渲染。

### 2.2 不变式

- 任何预算都不得静默生效：只要发生截断/裁剪，就必须有结构化字段与 UI 提示，且计数与实际渲染规模一致。
- 截断不影响"重复解析结果稳定"：相同输入 + 相同 options 得到相同诊断与计数。

## 3. 异步计算方案与 DSH 兼容性

### 3.1 目标

主线程在解析、建模与布局期间不得出现长时间不可响应；输入变化或面板卸载后过期结果不得覆盖新结果；布局保持确定性与现有交互（拖拽、重排、适配视图）。

### 3.2 首选路线：内嵌源码的 Blob Web Worker（待验证假设，不写成已决）

设计路线（依据：DSH 客户端已有 3 处 Blob Worker 先例、主文档静态未见 CSP、client.js 运行在页面主 realm）：

- 构建期把 `src/rdf-parse.js` + `src/graph-model.js` + `src/worker-entry.js` 拼接为自包含 worker 脚本字符串，内嵌进 `client.js`（不新增第二个资源文件，保持单文件加载契约）。
- 运行时：`URL.createObjectURL(new Blob([source], { type:'text/javascript' }))` + `new Worker(url)`（classic）；不依赖相对 import，因此不用 module worker。用后 `revokeObjectURL`。
- worker 只接收 `{ text, options, layout:{width,height,seed,iterations} }`，返回 `{ graph, base, prefixes, diagnostics, stats, truncation, positions }`；`positions` 以 `Float64Array` transferable 传回。原始 `triples` 不回传，降低结构化克隆成本。
- 视图不再在渲染期调用 `layoutGraph`；布局坐标作为输入/任务结果进入视图。尺寸变化时发送 `relayout` 消息，worker 复用缓存的 graph，避免重复解析。
- 单 worker、按输入 generation 复用；输入变化/卸载时 `terminate()`，新任务重新创建（解析器是纯函数，重建成本可接受）。

**验证门（Apply 第一阶段必须先做，失败即降级）**：在真实 DSH 页面执行探针，逐项记录：

1. `typeof Worker`、主文档响应头与 `meta` CSP（含 `worker-src` / `default-src` 回退）；
2. classic Blob worker 构造、`postMessage` 往返、错误事件；
3. worker 内加载内嵌源码并完成一次真实解析，与主线程结果做语义一致性对照；
4. 释放行为：`terminate()` 后无残留任务/事件，`URL.revokeObjectURL` 后再次创建正常；
5. 构建产物在真实页面被加载（Network 中 `client.js` rev 变化，或刷新后生效）。

判定：上述第 2-4 项全部通过才可采用 Worker 路线；任何一项失败（含 CSP 违规、构造失败、通信超时、释放异常）都切换到 §3.4 降级路线。**不得仅依据 DSH 源码中其它插件使用 Worker 的先例推断本插件可用**；先例只用于说明候选路线存在，不构成证据。失败证据（原文 + 截图 + 环境版本）记录到变更验证说明。

**体积影响（实测更新）**：内嵌解析器、模型与 worker 入口后，`npm run build` 实际生成 `client.js` 约 6.07×10^5 字符（内嵌 worker 源约 1.8×10^5 字符），V1.0.0 基线约 1.96×10^5 字符，增幅约 3.1 倍，显著高于设计初期约 310KB 的估算。架构评审已明确"实际体积以构建结果为准且接受 Worker 优先方案"，因此按实测记录并接受；若后续需要减小体积，可改为只内嵌 graph-model + 分片布局的降级方案，作为独立变更评估。

### 3.3 任务协议

```text
解析任务 = { generation, text, resourceAddress, displayName,
             limits:{maxTriples,maxNodes,maxEdges,maxLiteralsPerNode},
             layout:{width,height,seed,iterations} }
结果     = { generation, status:'ready'|'error', graph, diagnostics, stats, positions, timing }
```

- `generation` 单调递增，只用于**识别并丢弃过期结果**，不等同于真正取消计算：worker 中正在执行的同步解析无法被中断。
- 真正取消的机制：worker 路线在输入变化/卸载/视图切换时 `terminate()` 并丢弃 Blob URL，然后按需重建 worker；主线程路线在分片边界检查取消标记。
- `AbortController` 在 panel 卸载、text 变化、宿主切换视图时触发；取消后不得再有任何 setState 或结果提交。
- 状态机：`idle → reading → parsing → modeling → layout → ready`，失败进 `error`；`empty` 在"读取完成且文本为空"时直接进入，不经过解析。状态回调用于 `data-ontology-state` 与文案，避免 UI 用猜测的 loading 布尔。

### 3.4 降级路线：主线程分片

- 降级路线**只把布局分片**，解析与建图仍是同步调用：UI/文档不得把降级模式描述为"整个解析流程已非阻塞"。降级时主线程会在解析/建图阶段短暂阻塞，设计通过更严格的输入预算限制最坏情况，并在界面明确提示降级模式。
- 降级预算（初始值，基准校准）：源大小上限不变（12 MiB UTF-8），但三元组/节点/绘制边预算按比例收紧（例如 60k 三元组 / 800 节点 / 3000 边），并在状态条提示"性能降级模式：已降低解析与显示上限"。
- 布局改为 `createLayoutTask(graph, options)`：按迭代边界分片，每片约 8ms（`requestIdleCallback` 可用时优先，否则 `setTimeout(0)`），片间可取消并回报进度。`step()` 与一次性 `layoutGraph` 必须数学等价：相同输入、相同 seed、相同迭代顺序与采样决策，最终坐标逐位一致（Node 测试断言）。
- 不为分片执行重写解析器：解析器保持一次同步调用，仅增加上限与取消检查点（三元组/循环边界），不引入异步解析状态机。
- 布局完成前保持上一版坐标或占位，不渲染半成品坐标。

### 3.5 DSH 兼容性核对

| 约束 | 依据 | 设计结论 |
| --- | --- | --- |
| 单文件 Client 模块、无相对 import | `docs/integration.md:90-116`、`docs/development.md:39-45`、`build/build.mjs:22-41` | worker 源在构建期内嵌，不新增请求 |
| `window.__ModuleLoader__.load` 工厂只 require react | `build/build.mjs:59-73`、`tests/bundle.test.mjs` | worker 不改变工厂签名；worker 内不得使用 React |
| 注册生命周期 `ctx.effect` | `docs/integration.md:20-25`、基线 dsh-integration spec | 两个入口注册逻辑不变；worker 由组件/任务持有并在卸载时销毁 |
| 主题/i18n | 基线 localization-and-theme spec | 新增控件沿用令牌与 `tr()` 机制 |
| 不新增宿主 API/服务 | AGENTS.md §三、config | 无新 `ctx.*` 依赖；不请求额外权限 |
| CSP | 静态未见主文档 CSP；`worker-src` 未出现 | 仍有待验证假设；验证门失败即降级，不把 CSP 假设写进实现前提 |

## 4. 节点与关系过滤机制

### 4.1 数据流管线（单向、纯函数）

```text
fullGraph (buildGraph 输出，不可变)
  → filterGraph(fullGraph, criteria)          // 节点类型 + 关系谓词 + 方向（锚点相关）
  → explore / focus（若开启）                  // 多跳或单跳子图
  → applyEdgeBudget(view, budget)             // SVG 绘制预算
  → render
```

- 过滤只影响投影，**不修改** `fullGraph`、不改写 RDF 数据、不重新解析。
- 布局仍基于 `fullGraph`（保持稳定位置，避免过滤/展开导致整图跳动）；视图对"当前可见节点"做适配视图时使用投影坐标。若后续需要"仅对可见子图布局"，作为可选二次布局，不在本次默认路径。

### 4.2 过滤条件语义

- 节点类型：`class` / `property` / `individual` / `blank` / `external`，多选；未选择任何类型视为"全部"。
- 关系类型：从边上谓词收集，提供常用语义谓词（`rdf:type`、`rdfs:subClassOf`、`owl:equivalentClass` 等，按数据集实际出现列出）与自定义谓词，多选；同时显示每个谓词当前边数。
- 方向：`out` / `in` / `both`，**相对于锚点**（当前选中节点或探索根）。无锚点时方向过滤不生效，控件显示"选择节点后可过滤方向"；这是为了避免无参照的"入边"语义歧义。
- 组合规则：先按类型保留节点，再按谓词与方向保留边，最后删除不再连边的节点；**锚点节点始终保留**（保证选中上下文不消失）。关系过滤会使孤立节点消失，这是预期行为并在文案中说明。
- 过滤状态变化后：保持选中节点；若选中节点不在投影内，视图自动切换到"展示选中节点的最小上下文"或提示用户清除过滤（实现取后者：显示"当前选择被过滤隐藏"并提供清除/定位操作，不静默改过滤条件）。
- "清除过滤"恢复完整视图并重置方向；过滤条件在源文档切换时重置。

### 4.3 计数

- 顶部显示"节点 X / 总数"、"边 Y / 总数"；三元组显示解析总数并标注"源"。不做"过滤后三元组"的伪计算（平行边合并与字面量归属使该数字不可定义）。
- 过滤/预算/展开导致的隐藏量均在状态条中给出数字，不只显示剩余量。

## 5. 多跳邻域探索

### 5.1 契约

- 复用 `neighborhood` 的 BFS 语义，新增 `exploreNeighborhood(graph, {startId, depth: 1..5, direction, predicates, budget, cursor})`：
  - **在过滤后的图上探索（L2）**：探索从 `filterGraph` 结果出发，已被节点过滤隐藏的中间节点**不得作为继续展开的跳板**（默认规则）；锚点节点由过滤层保证保留。
  - 方向决定**每一跳**的边集合（出边/入边/双向），不是只作用于第一跳；
  - 谓词过滤与方向在每一跳组合（与 §4 使用同一 criteria 语义）；
  - 邻居顺序确定性：按谓词 IRI、再按对端节点 id 排序；同一层内按该顺序取预算切片；
  - 预算：每跳新增节点上限、全局边上限（初始值见 §8，由基准校准）；预算截断时返回 `truncated: true`、已展开集合、`nextBudget` 与稳定 `cursor`；
  - **续展确定性**：`cursor` 记录已消费的 BFS 层内偏移；继续展开从同一游标继续，不得重新排序或重复返回已展开节点/边；相同输入 + 相同 cursor 重复执行结果一致。
- 高连接度节点：默认按预算展开，状态条显示"已展开 X 个邻居，共 Y；继续展开"；"继续展开"按同一确定性顺序释放下一批，直到硬上限（5 跳或全局预算）后不再提供。
- **交互修正（评审后）**：选择跳数或方向即视为开始探索，不需要先单独按"展开邻域"；这避免"选了跳数但画面不变"的误解，也让多跳控件的行为与规格场景（选择 2 跳即显示 2 跳邻域）一致。未选中节点时控件仍禁用。
- 去重规则：节点按集合去重；边按 `(source,target,predicate)` 去重；续展与重算都不得产生重复项。
- **过滤变化后的探索状态**：节点/谓词/方向过滤或锚点变化时，探索结果与统计必须同步重算；若新过滤条件下锚点仍可见则保留当前跳数与方向，否则清空探索并提示；不得沿用旧的 `cursor`。
- 视图层用 `exploreNeighborhood` 结果与 `filterGraph` 组合，不改变模型。

### 5.2 与既有交互协调

- 进入多跳需要选中节点；未选中时控件禁用并给出原因。
- 搜索选中一个当前探索范围外的节点时，探索根切换为该节点（视图重算），并在状态条提示"探索根已切换"；不清空用户设置。
- 探索模式中，当前已展开的节点与边保持正常透明度，选中探索根不触发一跳范围之外的淡化；探索根仍以选中圆环、标签强调。悬停节点时临时突出其直接关系，其余探索结果仅适度淡化（节点 0.6、边 0.5），鼠标移开后恢复正常透明度。全图模式保留现有一跳高亮与强淡化规则。
- 详情面板打开、hover 高亮、拖拽、缩放保持；"回到完整视图"同时清除探索根与深度（保留节点/谓词过滤，过滤与探索是两个独立维度，状态条分别展示）。
- 适配视图在多跳下使用当前投影坐标；"重新布局"仍基于全图并保持确定性。

## 6. 节点详情增强

- 数据来源：`connectionGroups(graph, nodeId)` 在渲染期按需计算（`useMemo`），不预建全图索引；分组为先类型、再按边数降序、最后谓词 IRI 字典序。
- 面板结构（自上而下，可折叠）：
  1. 标题：标签 + 类型 chip；完整 IRI + 复制；
  2. 类型：全部 `rdf:type`（可点击定位，保持现行为）；
  3. 字面量属性：属性名（优先可读标签）、值、语言/数据类型；超过每节点上限时显示"已显示 60 / 共 123"；
  4. 关系：按谓词分组的出边/入边，每组显示计数与端点列表（端点可点击 → 选中并居中）；每组默认折叠到 10 条，提供"显示更多"；
  5. 连接信息：出边/入边/度数；当节点/边被预算裁剪时显示提示。
- 边列表点击行为只做"图内定位"，不做源文件跳转；`node.source` 恒为 `null`、`graph.source` 记录地址与显示名，为未来定位保留字段。
- 不过度堆叠：字面量与关系默认折叠；详情面板整体可滚动，窄屏为抽屉。
- **覆盖式布局（评审后修正）**：详情面板绝对定位于画布右侧（宽屏浮层、窄屏带遮罩抽屉），不再作为 flex 兄弟挤压 SVG 画布。选中/关闭详情不会改变画布尺寸、不会触发重新 fit 或布局，避免 V1.0.0 中"点击节点页面闪动"的问题；代价是面板会遮住画布右侧约 300px，用户可平移查看。

## 7. UI 状态协调与布局

### 7.1 状态模型

视图状态分为四组，互不覆盖：

- **输入态**：`idle/loading/parsing/modeling/layout/empty/too-large/error`（由任务状态机提供）；
- **投影态**：过滤条件 + 探索根/深度/方向；
- **交互态**：选中、hover、搜索词、面板开合、标签开关、缩放/平移/overrides；
- **提示态**：诊断折叠、截断汇总、展开/预算提示。

规则：输入态变化重置投影态与选中；投影态变化保留缩放/平移（除非适配视图被触发）；交互态变化不得触发重新解析或重新布局。

### 7.2 工具栏与窄屏

- 主行：显示名、状态徽标、节点/边计数、搜索框、标签开关、缩放组、适配、重新布局、详情开关。
- "过滤"与"探索"进入次级面板（popover），不常驻画布顶部；窄屏（<640px，沿用现有断点）时次级面板变为底部抽屉，主行允许横向滚动而不是无限换行，保证图谱可视高度。
- 放大/缩小/缩放百分比/适配视图/重新布局/标签开关/键盘 `0`、`f`、`+`/`-`、`Esc` 语义全部保留；服务端无布局快捷键的现状不变。

### 7.3 搜索

- 输入实时匹配（沿用 `matchNodes` 排序），显示结果列表（默认前 20 条，可滚动，显示 kind 与 IRI 摘要），支持 ↑/↓ 选择、Enter 确认、Esc 关闭；点击结果选中并居中。
- 无匹配时显示"没有匹配结果"；搜索范围始终是全图，不因过滤而缩小；若目标节点被过滤/预算隐藏，按 §4.2 的"被隐藏选择"流程处理。

### 7.4 可访问性与键盘

- SVG 节点：`role="button"`、`tabIndex`（roving tabindex）、`aria-label`（标签 + 类型），Enter/Space 选中，Esc 取消；画布保留 `role="application"` 与现有快捷键。
- **DSH 宿主的 Tab 边界（运行时发现）**：DSH 会接管 `Tab` 做全局焦点导航，插件不能保证 `Tab` 进入画布。因此画布获得焦点后提供独立的节点导航：方向键/Home/End 在已绘制节点间移动 roving 焦点，Enter/Space 选中，Esc 取消；`Tab` 在宿主允许时仍可用，但不作为唯一路径。点击画布或节点后把焦点显式交还画布。详情抽屉在捕获阶段接管 `Tab` 并强制循环，关闭后焦点归还画布，避免下一跳落到 DSH。
- 搜索使用 listbox/option 语义；计数与状态变化使用 `aria-live="polite"`；抽屉 `role="dialog"` + `aria-modal` + 焦点陷阱与关闭后焦点归还；所有图标按钮有 `aria-label` 与 tooltip。
- 保留 `prefers-reduced-motion` 下禁用过渡。

## 8. 性能预算与降级策略

### 8.1 基准先行

新增 `scripts/bench.mjs`（`npm run bench`，opt-in，不进 CI 门槛）：

- 夹具五类：小型（examples 级）、中型（数百节点/数千三元组）、接近当前上限（12 万三元组/1500 节点）、高密度（1500 节点/数万去重边）、异常输入（空、坏语法、超深嵌套、超大文本）。
- 指标分层：parse、buildGraph、layout（分 320/1000 迭代与 420 节点采样边界）、图规模/元素计数、内存增量；输出 p50/p95 与环境信息（Node 版本、机器）。
- **Worker 端到端指标**：worker 初始化/源码编译、首发消息与结果回传、结构化克隆/transfer 成本、主线程等待与最长任务、取消/重建成本；同时对照 worker 与主线程路径的结果语义一致性（节点/边/坐标/诊断一致）。
- **前后对比**：同一夹具、同一环境分别跑改造前（V1.0.0 基线提交）与改造后；不把 worker 计算时间当作唯一指标，也不把"更快"当作正确性证明。
- 真实首屏交互（DevTools Performance）作为运行时验收项，不写成自动断言；**本 Change 不预设毫秒目标**，预算数字由基准结果确定后再写入实施记录。

### 8.2 初始预算（可调，不作为永久契约）

| 预算 | 初始值 | 依据/状态 |
| --- | --- | --- |
| 源大小 | 12 MiB，按 **UTF-8 字节** 测量 | 修正现有 UTF-16 code units 比较；`bytes` 内容用 `byteLength`，字符串用 `TextEncoder` |
| 解析三元组 | 120,000 | 保持现值；所有格式统一短路 |
| 图节点 | 1,500 | 保持现值 |
| 每节点字面量 | 60 条；单条字面量值 16,384 字符 | 新增值长度上限，待基准验证 |
| 诊断 | 200 条原始消息；每 code 3 个样本 | 新增 |
| 嵌套深度 | 256 层（Turtle/JSON-LD/RDF-XML 统一） | 新增，防栈溢出 |
| SVG 边预算 | 6,000 条绘制边；元素预算约 26,000 | 新增，待基准验证 |
| 多跳预算 | 每跳 300 新增节点 / 800 边；硬上限 5 跳 | 新增，待基准验证 |
| 降级模式（Worker 不可用） | 三元组 60,000 / 节点 800 / 绘制边 3,000 | 收紧预算，UI 明确提示降级 |
| 布局 | 320 次迭代、上限 2000、固定种子 | 保持；Worker/分片不改变数学 |

数值集中为常量并允许调用方覆盖；规格只描述"存在可配置预算且必须提示"，不把数字写成契约。每级预算都必须产出 `{ total, kept, truncated, reason }` 记录（见 §1.5），统计与提示从这些记录派生。

### 8.3 降级矩阵

| 条件 | 行为 |
| --- | --- |
| Worker 不可用/验证失败 | 主线程路径：更严格的解析/节点/绘制预算 + 分片布局；明确提示"性能降级模式"，不得宣称解析已非阻塞 |
| 边数超绘制预算 | 按确定性优先级保留（选中/搜索命中/高度数边优先），显示"已绘制 X / Y 条边"；搜索/详情/统计仍基于 L1 完整模型 |
| 节点/三元组超上限 | 保持现有"高度数优先"策略；截断汇总 + 详情提示 |
| 源超 12 MiB（UTF-8 字节） | `too-large` 状态并说明真实上限；不尝试解析；better-sidebar 入口按宿主 5 MiB 上限提示 |
| 诊断洪泛 | 聚合 + 上限；继续解析计数 |
| 超大/超深输入 | 上限终止分支并记录 `nesting-limit`/`literal-limit`，返回部分结果 |

## 9. 模块拆分与构建

`graph-view.js` 单组件过大，按可独立验证的边界拆分，保持固定拼接顺序与 no-import：

```text
src/rdf-parse.js → src/graph-model.js → src/ontology-job.js
→ src/graph-view-style.js → src/graph-view-controls.js
→ src/graph-view-details.js → src/graph-view.js → src/main.js
```

- `ontology-job.js`：任务状态机、Worker 客户端、分片布局调度（不依赖 React；可 Node 测试协议与取消逻辑）。
- `graph-view-style.js`：CSS 字符串、常量、kind 元数据。
- `graph-view-controls.js`：工具栏、搜索、过滤/探索面板（纯展示 + 回调）。
- `graph-view-details.js`：详情面板与分组列表。
- `graph-view.js`：编排状态、SVG 渲染、指针/缩放/拖拽。
- `src/worker-entry.js`：**不进入主闭包**，仅由 `build/build.mjs` 读取并生成 worker 源字符串；构建产物确定性由 `--check` 覆盖。
- `build/build.mjs` 的 `MODULES` 与 worker 源生成同步更新；`client.js` 仍由构建生成，禁止手改。
- i18n 检查脚本改为扫描全部 UI 源文件（`src/*.js` 中出现的 `tr('...')`），不再硬编码单文件。

拆分约束：`const` 初始化按拼接顺序执行，新模块必须排在引用者之前；跨模块只用同一闭包标识符，不新增 import；拆分不得改变既有公共函数签名。

## 10. 兼容性与回归保护

- 保持导出的 `parseOntology` / `parseTurtle` / `parseNTriples` / `parseRdfXml` / `parseJsonLd` / `detectFormat` / `resolveIri` / `expandPrefixedName` 及图模型 7 个导出函数的签名与默认值；新增字段为增量，旧调用者不受影响。
- 保持 DSH 注册（`documentPreviews` + 槽位、可选 `betterSidebar`）、`loading:'bytes-complete'`、扩展名列表、`dsh.client` 契约不变；better-sidebar 仍为可选。
- 保持零运行时依赖、无网络请求、单文件产物、主题令牌、确定性布局。
- 既有测试中"结果形状"断言需随契约为增量字段做最小更新；不得删除既有覆盖。新增行为全部有 Node 测试；视觉/交互改动必须真实页面验收。
- 行为变化需在变更说明中标注：
  1. 相对 IRI 的节点身份改为基于真实资源地址（同一基名的不同文件不再冲突）；
  2. 12 MiB 上限改为按 UTF-8 字节测量，含多字节字符的文件实际可接受大小会变化；
  3. 截断/诊断提示从"英文原始文本"变为"本地化分类 + 计数"，原始消息保留在展开区。

## 11. 替代方案与取舍

| 方案 | 取舍 | 结论 |
| --- | --- | --- |
| 纯主线程分片（不做 Worker） | 改动小、无 CSP/体积风险；但解析是同步单体，120k 三元组约 110ms、布局 200–300ms 仍会阻塞，长任务无法消除 | 作为降级路线，不作首选 |
| 同源 chunk URL Worker（`/plugins/...client.worker.js?rev=`） | 无需内嵌源码、体积小；但页面拿不到 Host 的 rev 线格式，且 `__ModuleLoader__` chunk 契约要求自行注册，不是 worker 脚本 | 不采用 |
| data: URL Worker | 构造最简单；Chromium 对 data: worker 的限制与 CSP 行为不确定，DSH 无先例 | 仅作探针记录，不作设计前提 |
| module worker + 相对 import | 代码组织自然；但单文件契约与 blob origin 下相对 import 不可解析 | 不采用 |
| 引入 d3/cytoscape 做过滤/布局 | 功能现成；违反零运行时依赖与现有确定性布局契约 | 不采用 |
| 新建 `graph-exploration` capability | 语义清晰；但与既有 graph-model/graph-view 边界重叠，违反"不新建宽泛 catch-all" | 不采用，使用既有 capability delta |
| 在 buildGraph 阶段直接过滤 | 少一层投影；但会破坏"模型完整 + 视图可逆"的契约，过滤/清空需重新解析 | 不采用，投影层过滤 |

## 12. 待验证假设与冲突上报

### 12.1 待验证假设（不得写成已实现）

1. `dsh-app://app` 页面下 classic Blob Worker 可构造、通信、终止与重建（静态证据：DSH 三处先例、主文档未见 CSP；真机未测）。**先例不是证据**，必须用探针实测本插件路径。
2. module Blob Worker 可用（PDF 先例，未测）；不作为路线前提。
3. 主文档响应头确实无 CSP；企业策略/未来版本可能变化。
4. link 安装下 `npm run build` 后 HMR 会在约 0.5–1s 内热换 client.js（Host 侧已核验，页面 transport 未验证）；若未热换需 Ctrl+R。
5. better-sidebar 以 `content: string` 送达文本、>5 MiB 走 `largeFile`（契约已核验，真实渲染未测）。
6. **`resourceAddress` 的真实格式未知**：可能不是标准文件 URI，可能是宿主自定义地址；映射策略必须防御性实现，无法可靠映射时只给诊断。运行时需记录实际样本。
7. Worker 内解析/布局结果与主线程逐位一致（计划用 Node + 运行时对照验证）。
8. 主题字体令牌 `--ds-font-family-code` / `--dsw-font-family` 是否宿主真实存在（颜色令牌已由基线确认）。
9. Worker 的真实收益需同时计入初始化、源码传输/编译、消息克隆与主线程等待（见 §8.1 基准要求），不能只比较 worker 内计算时间。

### 12.2 冲突与风险上报

- **运行时 UI 无法在本会话核验**：client inspect 三个 provider 均 10s 超时，`http://127.0.0.1:54587/` 无 token 返回 401，`browser_tabs` 为空。因此槽位 occupants、Theme tokens、真实渲染均标注"未验证"，由 Apply 阶段按运行时验收清单执行，不把注册成功当 UI 通过。
- **文档与代码冲突**：`README.md:168` 宣称会提示"输入已截断"，与代码事实不符（`docs/development.md:101` 已记录为缺陷）。本 Change 修复代码并同步 README，不通过删除文档掩盖。
- **规格现状缺口**：`openspec/specs/rdf-parsing/spec.md` 末尾没有其他 spec 都有的"已知偏差"一节，但 `docs/development.md:97-115` 记录了相关偏差；本 Change 的 delta 不依赖该节，修复后由基线维护流程同步。
- **行为更正**：Base IRI 与 12 MiB 度量变化会改变部分文件的节点身份/可打开性，已在 proposal 与 §10 标注为有意更正；无持久化数据，无迁移成本。
- **体积/性能代价**：Worker 路线使 client.js 约增大 50–60%，需实测确认在可接受范围；若超出，可退化为"仅内嵌 graph-model + 分片主线程布局"，并记录取舍。

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Worker 真机不可用 | 性能目标无法完全达成 | 验证门前置；降级路线保证功能完整，只损失主线程流畅度 |
| 拆分导致构建/测试失配 | CI 失败、产物不一致 | 同步 `MODULES`、`build --check`、既有 bundle 测试；小步提交 |
| 过滤/探索状态组合复杂 | 交互混乱、计数不一致 | 单向管线 + 纯函数 + 计数统一从投影 stats 派生；为组合写 Node 测试 |
| 详情边列表在大图上的计算成本 | 打开详情卡顿 | 按需 `useMemo`、每组限量折叠、仅在选中节点变化时重算 |
| 布局改到任务后与拖拽/适配交互回归 | 视口跳动、位置丢失 | 保留 overrides 与 fit 逻辑；运行时验收包含拖拽/重排/适配 |
| 预算数字拍脑袋 | 大图仍卡或过度裁剪 | 先基准后定值；数值集中在常量并记录测量依据 |
