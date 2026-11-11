# Verification Record - add-ontology-multiview-workspace

Last reviewed: 2026-11-10 16:45 Asia/Shanghai. This record distinguishes automated checks, live-page observations, and residual acceptance. Historical sections below are retained as dated observations; newer audit findings override claims that did not satisfy complete task criteria.

## Stable Automated Checks

Latest `npm run check`: **243 passed, 0 failed** (build 955,124 bytes; `build:check` current). `npm run i18n`: no missing or asymmetric keys. `npm run stats`: all sample fixtures and stress pipeline completed. `npm run build:check`: generated client current. `git diff --check`: clean. `openspec validate --all --strict`: 7/7.

No commit, push, version bump, archive, profile modification, or DSH core modification was performed.

## Recent Regressions and Fixes

- Live page showed PNG unavailable while `window.URL` was a function. `rasterizePng` now accepts URL constructor functions as well as object facades. Tests cover function and facade forms and resource release. Rebuilt client currently needs the existing client refresh/reload path before live verification.
- Independent code review identified compose cancellation failure on the degraded main-thread path: an old stepped layout could emit graph/layout after a newer generation. Added `id !== generation` guards in cancellation, fulfillment, and rejection paths; regression test asserts the superseded generation cannot emit layout.
- Runner source IDs are now allocated by the controller's monotonic workspace sequence rather than worker Map size, preventing drop-then-add reuse/overwrite. Browser file reload increments the revision. Worker fallback cache hydration includes parsed metadata and byteSize; a parsed-snapshot import test confirms no reparsing.
- Shared parsing now uses immutable bounded parsed snapshots rather than retaining source text. Original source origin is preserved. Missing Session identity no longer aliases every panel to a shared `default` session; sharing is unavailable without reliable Session identity. Shared import deduplicates by `sharedId`, applies budgets, does not mark a rejected import as accepted, and unregisters on session change/unmount. The registry is cleared on plugin context disposal.
- Browser File reads now run sequentially, enforce the source-byte budget before reading, use fatal UTF-8 decoding, and invalidate late reads when the source document changes or the panel unloads. Compose waits until reads settle. Root drag/drop now feeds the same queue.
- Network export scene now uses the graph view's actual rendered L4 nodes/edges, positions (including drag overrides) and label state, rather than exporting the full graph model. Layout-not-ready or mismatched graph snapshots are rejected.
- Node provenance now records roles per source instead of implying every source has the union of all roles. Legacy edges without graph provenance count as unknown, not default.
- Test count is 243, not a permanent threshold.

## Live DSH Evidence Already Obtained

- Core page rendered `pizza.ttl`: 25 nodes / 35 edges / 73 triples. Adding `people.nt` yielded 35 nodes / 50 edges / 95 triples.
- Unchecking `people.nt` yielded 25/25 visible nodes; checking it again restored 35/35.
- Class tree search `Topping` persisted across a Network -> Class tree switch. A no-match query displayed an explicit message. A prior observation showed 3 matching/context rows.
- Layered graph selection changed dimmed-node count from 0 to 3 in a five-node layout. Direction control accepted `right`; actual orientation change was observed in a prior page.
- Source provenance for Topping with the test-added file showed two source names and eight statements. Earlier source label `src1` defect was fixed to display file labels.
- File API capability probe: File, File.arrayBuffer, navigator.clipboard, Worker, Blob, Image, createImageBitmap, Canvas.toBlob were present in that page.
- Worker wrapper counted one Worker construction when opening `zoo.owl`; the preview reached ready.
- `performance.memory` single sample was ~9.55 MB used JS heap / ~4.10 GB limit; this is not a peak or leak test.
- SVG files were saved and structurally inspected: tree (1,144 bytes) and layered (1,805 bytes), with expected labels and no script tag.
- Shared button changed to pressed state and showed the page-local/last-panel-clears hint. A second panel sharing round-trip and last-user cleanup were not live-verified.
- A prior runtime failure showed `cannot get property "remote.workspaceFiles" without inject`; it proved that the then-current access path was rejected, not that no possible injected capability exists. A was guarded and B remains enabled. Current Host injection capability is unresolved; do not claim official Remote success or permanent absence.

## Current Task Status Audit (2026-11-10)

The original checklist remains **24/41 complete** (2.4 re-completed after the registry/lifecycle work; its full two-panel live interaction is still part of 7.4). Several prior `[x]` markings were not supported by the full task criteria and were reverted:

- 2.4: tests cover registry isolation/refcount/clear, but live page has only shown the share toggle/hint; two-panel same-session import, release behavior, and all lifecycle cases are not verified.
- 5.2: code now presents per-relationship SPO, count, sources, graph terms and IDs, with pagination; the full multi-source/hidden-L4/unknown/truncation UI matrix has not been fully verified, so task remains open pending audit/tests.
- 6.1: query is shared across network/tree and view-local cache restores query; filter/explore were not yet raised as complete shared state, nor is the full state matrix covered. Remains open.
- 6.2: source-panel UI is now covered by a dependency-free fake React-hooks renderer for status badges/actions/selection. It does not mount actual React/DOM; remaining component states, accessibility, and integration coverage require audit before considering complete.
- 6.3: export snapshots now use the displayed L4 graph but a remaining export range/layout conformance audit is needed; task is open.
- 7.5: final consistency review must be repeated after the latest changes; task is open.

## Remaining Runtime / Manual Verification

- 1.1/1.2/1.3: Host workspaceFiles injected capability, authorization/cancellation/truncation/absolutePath; File multiselect/cancel/drag/drop, clipboard/download, source navigation/changes, and Worker CSP/terminate/revoke/rebuild. Some browser constructors were probed, but the full capability matrix is not satisfied.
- 3.4/4.4/5.3/5.4: keyboard/property mode/narrow and theme-language accessibility, SCC member detail and empty projection, actual source-copy operation, relation pagination/focus restoration.
- 6.6/6.7: PNG after the native URL fix, all three exports, blocked-download fallback, theme/range/layout checks, narrow/dark/light/English/Chinese full UI review.
- 7.2/7.4: peak memory/continuous growth and both host entry points plus boundary/invalid/update/reload cases.

Current runtime URL/session was not live-tested against the newest bundle after the latest review fixes. Preserve that limitation. Do not mark a task complete merely because the application window restarted or a previous page version showed the feature.

## 27. 真实页面验收（重启后 ~17:20，bundle 955,124）

在真实 DSH 页面（PID 161048，GUI 127.0.0.1:49938）打开 `examples/pizza.ttl`，逐项实测：

- 工具栏与三视图入口正常：关系网络/类层级/分层语义关系图、来源（1）、导出、标签、过滤、邻域探索、重新布局、缩小/放大/适配视图；状态 `节点 25 / 25，边 35 / 35`，`data-ontology-state=ready`。
- 类树键盘（3.4 部分）：点选 Pizza 后 `aria-selected` 生效；`ArrowDown` 选择移到 Topping 且焦点在 `role=treeitem`；`End` 跳到 Pizza Base。行数 3（Pizza/Topping/Pizza Base）。
- 详情来源（5.2/5.4 部分）：Topping 详情含“已接纳来源”“角色: object, subject”“图身份: 默认图 ×3”“语句位置未记录（null）”与“已接纳来源不代表输入完整”提示；关系分组出边/入边可展开，展开后显示主体/谓词/客体、来源与命名图。
- 复制来源标识（5.3 部分）：点击“复制来源标识 pizza.ttl”，页内探针记录 `clipboard.writeText('src1')` 被调用；因 DevTools 文档无焦点，`readText` 被浏览器拒绝（预期），UI 显示“复制失败”，未伪报成功。
- 来源面板（6.2 部分）：`来源 1 个文件 · 73 条三元组`，行内徽章 `pizza.ttl / DSH 文件 / 就绪 / TURTLE / 73 条三元组 / 移除`，含“添加文件/联合/移除”与本地文件说明。
- 会话共享（2.4 UI 部分）：点击“共享”后 `aria-pressed=false→true`，标签变为“已共享”，出现“共享仅在本页面内，最后一个面板关闭即清空。”；未出现“无法确认会话身份”提示，说明当前面板拿到了可靠 Session。
- 跨视图共享搜索（6.1 部分）：关系网络搜索框输入 `Topping` 后切到类层级，类树搜索框值为 `Topping`，过滤后 3 行。
- 发现真实缺陷（已修复，待重启验证）：关系网络导出始终提示“暂无导出内容：请等待布局完成。”。根因是 `displaySceneRef` 保存了 `normalizeGraph` 产出的新对象，而工作区用对象身份与 `graph` 比较，永远不相等，导致 `stale-layout`。修复：保存原始 `graph` prop，并新增纯函数 `displayedSceneReady(displayed, graph)` 与回归测试；同时详情中的语句标识改为 `statementIdDisplay`，不再直接输出 `\u0000` 分隔符。
- 修复后 `npm run build` 产出 956,150 字节，`npm run check` **245 通过 / 0 失败**，i18n/build:check/diff/OpenSpec 均通过；PNG 实际栅格化与导出回归仍需重启后验证。
- 同批补齐 6.1 的“探索根非类”缺口：新增纯函数 `exploreRootNotClass(graph, anchorId, exploring)`，类树在探索根不是类时显示“探索根不是类，类树不展示探索范围。”徽章；`npm run build` 现为 **957,114 字节**，`npm run check` **246 通过 / 0 失败**。该徽章与导出修复均需下一次重启后在真实页面确认。

## 28. 重启后导出回归（bundle 957,114，GUI 127.0.0.1:62690）

在同一真实页面（PID 93060）对 `examples/pizza.ttl` 复验上一轮修复：

- **PNG 实际栅格化成功**：页内探针记录 `HTMLCanvasElement.prototype.toBlob` 回调收到 `{w:575,h:1154,type:"image/png",bytes:46374,ok:true}`；`URL.createObjectURL` 依次创建 `image/svg+xml` 与 `image/png` 两个 Blob URL，并在之后各收到一次 `revokeObjectURL`；下载锚点记录 `{name:"pizza.ttl.png"}`；状态消息为“已发起下载。浏览器不会报告文件是否保存成功。”。这同时证明原生 `window.URL` 为函数时不再被判为 unavailable。
- **SVG 导出成功**：同一探针记录第二个锚点 `{name:"pizza.ttl.svg"}`，状态消息同为“已发起下载…”。
- **落盘未验证**：`C:\Users\宋璟\Downloads` 中未出现 `pizza.ttl.png/svg`，Electron 下载路径或保存行为无法从页面确认；按规格只记录“已发起下载”，不写“已保存”。
- **语句标识显示**：单元测试覆盖 `statementIdDisplay`，但本轮未能在真实页面展开到关系级 provenance（类 PizzaBase 的入边分组展开后未出现 `statementIds` 行），故该 UI 变更仍标为未验证。
- **探索根非类徽章**：单元测试 `exploreRootNotClass` 通过；真实页面选中个体 Margherita 并选择“1 跳”后切到类层级，未出现“探索根不是类”徽章，原因未定位（可能探索状态未真正置为 on）。该行为保持未验证，6.1 不据此勾选。
- 本轮未改源码，`client.js` 仍为 957,114 字节；`npm run check` 246 通过，i18n/build:check/diff/OpenSpec 通过。

## 29. 自动化补强（第 2 轮，未重启）

本轮不改源码，仅补测试（`client.js` 仍为 957,114 字节），`npm run check` 现 **252 通过 / 0 失败**。

- **6.1 状态矩阵（共享状态复核）**：新增 `tests/workspace-reconcile.test.mjs`（4 项），覆盖共享搜索保留、失效选择/锚点清理、探索游标丢弃与 `on` 关闭、谓词与来源 ID 按现存集合裁剪、未知方向回落 `both`，以及无图/无来源时不凭空造状态。
- **5.2/5.3 组件级渲染**：新增 `tests/details-render.test.mjs`（2 项），用零依赖 hooks 测试桩真实渲染 `DetailsPanel`：展开关系 provenance 后，语句标识显示为 `statement · src1 · 2` 且不含任何 `\u0000` 控制字符，来源 ID 与名称列出；节点详情同时出现图身份与“语句位置未记录（null）”。这补上了上一轮“仅单元测试、无渲染证据”的缺口，但仍不是真实 DSH 页面证据。
- 未改动的运行时缺口照旧：探索根非类徽章未在真实页面复现；“下载落盘”不可由页面确认。

## 30. 自动化补强（第 3 轮，未重启）

本轮仍不改源码（`client.js` 957,114 字节），只补组件级与导出一致性测试；`npm run check` 现 **262 通过 / 0 失败**。

- **6.2 工作区 UI 组件状态**：新增 `tests/workspace-ui.test.mjs`（6 项）：
  - 工具栏渲染 `tablist`/三个 `tab`，仅当前视图 `aria-selected=true`，点击回调正确；来源按钮的 `aria-expanded` 与文件数标签、导出按钮的 `aria-expanded`、选中实体标签；
  - 导出菜单的“范围/倍率”选择值与可访问名称，SVG/PNG/复制 SVG 三个操作回调，忙碌时全部禁用且无消息；
  - 工作区文件选择器的加载中、错误（`role=status`）、空目录、目录截断、文件夹进入、文件复选（可访问名称/选中态）、“读取所选”仅在有选择时可用。
- **6.3 导出场景一致性**：新增 `tests/export-conformance.test.mjs`（4 项），用真实视图函数组合验证：
  - 类树导出只包含展开后的可见行，折叠的孙节点不进入场景，父子连线只对应可见关系；
  - 搜索过滤后导出场景与过滤后的行集合一致；
  - 分层导出节点集合与投影后的布局完全一致，被来源/类型过滤掉的个体不出现，导出不新增边，几何保持有限；
  - 环收缩为 group 节点时，导出成员计数正确且内部环边不作为可见关系导出。
- 已有 `tests/workspace-reconcile.test.mjs`（4 项）与 `tests/details-render.test.mjs`（2 项）继续覆盖 6.1 共享状态与 5.2/5.3 详情渲染。
- 6.2 仍未勾选：设计要求的“更多菜单”收纳布局选项在本实现中体现为独立的来源/导出按钮；是否满足全部 UI 条目需人工走查确认。6.3 的真实三视图导出与落盘核对仍属 6.6/6.7。

## 31. 真实页面：树/分层导出与视图交互（第 4 轮，bundle 957,114）

页面：PID 63924，GUI 127.0.0.1:50881，`examples/pizza.ttl`。

- **类树 SVG 导出成功**：页内探针记录下载锚点 `pizza.ttl.svg`，Blob URL 类型 `image/svg+xml;charset=utf-8`；导出前自动切换到“类层级”并返回 `TREE_EXPORT OK`。
- **分层 SVG 导出成功**：切换“分层语义关系图”后再次导出，锚点同为 `pizza.ttl.svg`，返回 `LAYERED_EXPORT OK`；两次均生成 `image/svg+xml` Blob URL。
- **关键行为修正记录**：本 Electron 构建对 `a.download` 的 Blob 下载会弹出**原生“另存为”对话框**（窗口类 `#32770`，标题为 blob: URL）。取消对话框不会落盘，因此“已发起下载”可验证、“已保存”不可由页面证明；此前“未出现保存对话框”的表述不准确，已在此更正。
- **无外部请求**：导出期间 `performance.getEntriesByType('resource')` 中非 `dsh-app:` 的条目为 `[]`。
- **类树属性模式（3.4 部分）**：模式选择器（可访问名“模式”）由 `class` 切到 `property` 后，树中列出 6 个属性实体（calories/fat/has_base/has_topping/price/protein，均显示“孤立”）。
- **类树展开（3.4 部分）**：类模式下 3 行 → 点击“展开 Pizza”后 4 行，证明惰性展开生效；按“收起 …”文案未匹配到按钮（本地化用词待核），折叠未取得直接证据。
- **分层视图（4.4 部分）**：视图文本包含“方向 从上到下 从左到右”“关系类型 rdfs:subClassOf …”“5 个节点 · 2 层 · 0 个循环组”以及节点标签（Cheese Topping / Named Pizza / Pizza 等）；方向选择器当前值 `down`，切到 `right` 后选择器接受该值。循环组展开与“无关系空态”仍未验证。
- **内存单点**：导出前 `usedJSHeapSize≈92.8 MB`，多次导出与切视图后单点 `≈110.7 MB`；仅为采样，不能据此判断泄漏，7.2 保持未完成。

## 32. 真实页面：循环组、空态与分页（第 5 轮），并修复两处缺陷

页面 PID 63924（bundle 957,114）。通过页面内构造 `cycle.ttl`（A<->B<->C 环 + `ex:Hub ex:link ex:N1..N15`）与 `only.ttl`（无 subClassOf）加入来源。

- **关系分页（5.4 / 6.3）**：选中 `Hub` 后详情出边分组初始 11 个 `li`（10 条关系 + “显示更多”），点击“显示更多”后为 15 个，全部 15 条关系进入 DOM。
- **分层空态（4.4）**：仅启用 `only.ttl`（无 `rdfs:subClassOf`）时，分层视图显示“所选关系类型下没有可显示的关系。”与“0 个节点 · 0 层 · 0 个循环组”。
- **循环组：发现两个真实缺陷**
  1. 分层视图的循环组节点可访问名称与可见标签含 tagged 身份的 NUL 分隔符（实测 aria-label 为 `"\u0000group\u0000http://example.org/cyc#A（循环组（3 个成员））"`），会把控制字符送进 DOM/读屏。
  2. 点击循环组只选择锚点，**没有成员详情**；`aside` 不存在，`3 个成员` 也不在任何文本中，与 4.4 “循环组展开详情”要求不符。
- **修复**（bundle 重建为 **960,790 字节**）：
  - 新增 `readableNodeLabel`：剥离控制字符、丢弃 `group/statement/entity` 标记段、IRI 取末段；分层节点的 aria-label、可见文本、导出标签统一使用。
  - `LayeredView` 增加循环组成员面板（`role=dialog`，成员列表按钮，选择成员后关闭并选中该成员），新增 i18n `view.cycleMembers`（中/英）。
  - `exportLabelNode` 将控制字符统一替换为空格，任何视图导出标签都不再携带 NUL。
  - 新增 3 项测试（`readableNodeLabel`、LayeredView 成员面板交互、导出标签清洗），`npm run check` **265 通过 / 0 失败**；i18n/diff/OpenSpec 通过。
- 观察：取消全部谓词选择时会回落到默认 `rdfs:subClassOf`（现有实现行为），因此空态需通过“工作集里没有匹配关系”触发；已在上面用 `only.ttl` 实测。
- **待重启验证**：循环组成员面板与清洗后的标签需在新包页面复验；`client.js` 现为 960,790 字节。

## 33. 文档同步与来源面板组件测试（第 6 轮，未重启）

本轮仍使用已加载的 957,114 包（进程未重启），只做不依赖新构建的工作：

- **README 同步**：使用表新增「共享」入口，分层视图一行补充“点击循环组会列出成员并可直接选中成员”；导出边界补充“导出文本会剥离控制字符与内部分隔标记，界面与可访问名称同样不会出现这些字符”；验证状态段落改写为三层——Node 测试覆盖、真实 DSH 页面已取得证据、仍未验证/未启用（workspaceFiles、better-sidebar 完整走查、浅色主题/中英文/窄栏、落盘、内存峰值、最新构建的循环组面板与标签清洗）。
- **CHANGELOG 同步**：Unreleased/Added 增补同 Session 共享、跨视图共享搜索与过滤/探索状态、类树键盘与属性模式、循环组合并显示与成员面板、导出“复制 SVG”回退、控制字符清洗。
- **新增来源面板组件测试**（`tests/workspace-ui.test.mjs`）：渲染 `ProvenancePanel`，断言来源名称/角色/关系计数出现、DOM 先只渲染 40 条关系、点击“显示更多”后 45 条全部进入 DOM，且文本不含控制字符。`npm run check` 现 **266 通过 / 0 失败**；`client.js` 仍 960,790 字节，build:check/i18n/diff/OpenSpec 通过。
- **待重启验证**（同上轮）：循环组成员面板、`readableNodeLabel` 清洗后的 aria/可见标签、导出标签无控制字符。当前运行进程仍是旧包。

## 34. 官方 Inspect 只读核验与主题令牌缺陷修复（第 7 轮）

使用 `cordis_inspect_list` / `cordis_inspect_query`（只读，无需重启）核对真实运行环境：

- **Client 服务目录**（`client/Service.listService`）：`layout, locale, sessions, slots, theme, timer, uiWorkspace, workspaces`。**没有 `betterSidebar`**，也没有 `remote` / `remote.workspaceFiles`。`uiWorkspace` 提供 `pickDirectory()`/`listDirectory(path)`，但没有读取文件字节的接口。结论：当前 Host 下 better-sidebar 双入口无法验收（7.4 只剩原生预览入口），方案 A 的逐目录读取仍不可用；B 路径（本地文件选择）是唯一可运行入口。
- **槽位**（`client/Slots.listSubTree(root: "sidebar.right.tab.document")`）：`occupants` 中出现 `registrant: dsh-ontology-viewer, key: dsh-ontology-viewer/graph, active: true`，与内置 text/markdown/html/image/pdf/office/excel/code 预览并列。这是原生预览入口在真实页面注册并激活的运行时证据。
- **主题令牌**（`client/Theme.listTokens` + 页面 `getComputedStyle`）：
  - 令牌定义在 `body` 上（`documentElement` 上全为空），插件面板可继承得到 `label-tertiary`、`interactive-bg-hover`、`interactive-bg-active`、`bg-layer-2/3`、`bg-overlay`、`state-*-primary`、`brand-primary`、`border-l1` 等；
  - **不存在 `--dsw-alias-label-error` / `--dsw-alias-label-warning`**（只存在 `--dsw-alias-state-error-primary` / `--dsw-alias-state-warn-primary`）。原实现的错误/警告色因此永远落到字面量兜底，不随明暗主题变化。
  - 修复：`src/graph-view-multiview.js` 的 `THEME.danger/warning` 改用 `state-error-primary` / `state-warn-primary`；新增源码级回归测试，禁止再出现不存在的令牌名。
- 结果：`client.js` 重建为 **960,803 字节**，`npm run check` **267 通过 / 0 失败**；i18n、build:check、diff、OpenSpec strict 通过。
- 上述主题修复与此前的循环组成员面板都需重启后在真实页面做最终目视确认。

## 35. 打包不变量测试与 Host 配置核验（第 8 轮，未重启）

- **Host 配置核验**（`host/Config.listConfigs(name: "dsh-ontology-viewer")`）：live profile 中存在条目 `id: include:dsh-ontology-viewer, patchId: dsh-ontology-viewer, status: "absent"`——插件 bundle 行确实在 profile 中，且本插件不声明 Config（与 `index.js` 空实现一致，无必填配置）。
- **新增打包不变量测试**（`tests/packaging.test.mjs`，4 项）：
  1. `package.json` 无 `dependencies`/`peerDependencies`/`optionalDependencies`（零运行时依赖）；
  2. `src/*.js` 中不出现 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon`（离线承诺）；
  3. 每个 `src/*.js` 都出现在 `build/build.mjs` 的单文件拼接清单中（防止新增模块漏接线）；
  4. `client.js` 无残留 `import`/`export` 语句且包含模块加载入口（闭合单文件）。
- 结果：`npm run check` **271 通过 / 0 失败**；`client.js` 仍 960,803 字节；build:check、i18n、diff、OpenSpec strict 通过。
- 待重启验证项不变：循环组成员面板、标签/aria 控制字符清洗、错误/警告色主题令牌。

## 36. 能力门组件测试与基准复跑（第 9 轮，未重启）

- **2.3 方案 A 能力门**：新增组件测试——`workspaceFilesAvailable` 为 false 时来源面板**不渲染**“Workspace files”入口；为 true 时才出现，确保“无业务接口实测时 A 不宣称启用”在 UI 层成立。
- **2.4 无会话身份时的共享**：新增组件测试——`sharingAvailable: false` 时“共享”按钮仍渲染但 `disabled=true`，并出现“Session identity unavailable…”说明；不会把无身份的共享当作可用。
- **7.1 基准复跑**（`npm run bench`，同机 Node 24）：多文件 compose `parsedTriples=1200 / statements=1200`，`composeMs p50=3.14 / p95=5.73`，`treeMs≈0.20`，`layeredMs≈0.07`；五类夹具（小/中/接近上限/高密度/异常）全部完成，异常夹具给出诊断而非崩溃。仅记录本机数字，不作为 CI 门槛。
- `npm run check` 现 **273 通过 / 0 失败**；`client.js` 仍 960,803 字节（本轮未改源码）；build:check/i18n/diff/OpenSpec strict 通过。
- 待重启验证项不变：循环组成员面板、标签/aria 控制字符清洗、错误/警告色主题令牌。

## 37. 导出主题令牌缺陷修复（第 10 轮，未重启）

延续第 34 轮的令牌证据：该 Host 把 `--dsw-*` 令牌定义在 `body`，`documentElement` 上取不到。

- **缺陷**：`graph-view-workspace.js` 的 `readThemeToken` 只读 `documentElement`，真实页面中全部为空，导出主题因此**永远使用字面量兜底**，不随明暗主题变化（违反设计 §8“主题从宿主计算颜色取值”）。此前导出的 SVG/PNG 在暗色主题下仍可能带浅色背景，属于真实缺陷。
- **修复**：新增 `readHostThemeToken(name, fallback, documentLike?, getStyle?)`（`src/graph-export.js`），依次探测 `document.body` → `documentElement`，异常时回落字面量；工作区 `readThemeToken` 改为调用它，`themeForExport` 在每次导出时重新读令牌（不再冻结挂载时的值）。
- **测试**：新增 1 项（5 个断言）覆盖 body 优先、documentElement 回退、缺失回落、无 document、getStyle 抛异常；`npm run check` **274 通过 / 0 失败**。
- `client.js` 重建为 **961,372 字节**；build:check、i18n、diff、OpenSpec strict 通过。
- **待重启验证**：导出的 SVG/PNG 背景与文字颜色是否随当前主题变化（暗色应得到暗色背景），以及循环组成员面板、标签/aria 清洗、错误/警告色令牌。

## 38. 1.1 / 1.2 / 2.3 证据闭环（第 11 轮，未重启）

- **版本**：`resources/runtime/primary-runtime/runtime.json` → `desktopVersion: 0.2.2-rc.1`，`platform: win32`，`arch: x64`，`node: 24.21.0`。
- **1.1（结论：禁用 A、采用 B）**：Client 服务目录无 `remote`/`remote.workspaceFiles`（仅 layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces）；`uiWorkspace` 只有 `pickDirectory`/`listDirectory`，无读取字节接口；此前真实页面访问 `remote.workspaceFiles` 得到 `cannot get property "remote.workspaceFiles" without inject`。适配器保留但 UI 在能力不可用时**不渲染**入口，A 从未宣称启用。未修改 Host/profile。
- **1.2（真实页面能力矩阵，pizza.ttl 页面内构造 File）**：
  - 多选：一次加入 `probe-a.ttl` + `probe-b.ttl`，来源 CHECKBOX 数 3 → 5；
  - 取消：空 `FileList` 触发 change，数量保持 5；
  - 拖放：`DragEvent('drop')` 携带 `probe-drop.ttl` 后数量 5 → 6，文件名出现在来源面板；
  - 读取：来源面板加入即解析成功，证明 `File.arrayBuffer`（队列实现）可用；字节上限与 fatal UTF-8 解码由单测覆盖；
  - 下载/PNG：`toBlob` 实际产出 46,374 字节 `image/png`，锚点 `pizza.ttl.png`，Blob URL 创建后回收，原生“另存为”对话框出现（取消不落盘）；
  - 复制：`clipboard.writeText` 被调用（探针捕获），DevTools 无焦点时 `readText` 被浏览器拒绝，UI 显示“复制失败”；
  - 预览回退：PNG 失败路径回退 SVG 下载（单测 + 早期真机提示）；
  - 来源导航：`uiWorkspace` 无打开文件接口，`remote` 不存在 → 记录为“复制标识”回退，`navigationAddress` 仅文本展示。
- **1.3（保持未完成）**：包装 `window.Worker` 后切换 `zoo.owl`，探针记录 `created: 1`（Blob Worker 在真实页面创建成功、通信并渲染）；`terminate/revoke` 计数为 0，因为 DSH 侧边栏标签页保留面板、切换不卸载（未触发 dispose）。`runner.dispose()` 的 terminate 与 release 的 revoke 由 `tests/job.test.mjs` 覆盖，但真机 terminate/revoke 未观测，故不勾选。
- **2.3**：方案 A 入口在 `workspaceFilesAvailable=false` 时不渲染、`true` 时才出现（组件测试）；B 路径的多选/取消/拖放（真机）+ 同名文件不覆盖、重载替换、字节上限、解码错误（单测）齐备；A 未被宣称启用。
- 结果：任务清单更新为 **27/41**（1.1、1.2、2.3 完成）；`client.js` 未变 961,372 字节；`npm run check` 274 通过。

## 39. 1.3 / 5.2 / 5.3 / 6.1 / 6.3 复核闭环（第 12 轮，未重启）

- **1.3 Worker 探针闭环**：在页面包装 `Worker` 构造器、`terminate` 与 `URL.revokeObjectURL` 后：
  - 打开 `zoo.owl`：`created: 1`（Blob Worker 在真实 dsh-app 页面创建成功，CSP 允许 blob worker），面板达到 ready（通信与渲染成立）；
  - 关闭该标签页（中键）：`terminated: 1`、`revoked: 1`——面板卸载触发 `runner.dispose()` → worker terminate + Blob URL revoke；
  - 重开另一文件会再次创建 Worker（重建路径），与单测的终止/重建语义一致。
  → 1.3 勾选。
- **6.1 “打开详情不触发重新布局”真机验证**：关系网络视图下记录前 8 个节点圆的屏幕矩形（如 `2261,780`），聚焦并 Enter 选中 `Topping` 打开详情后再取样，**矩形完全一致**（`SAME true`），详情面板已打开（`DETAILS true`）。结合 `tests/view-state-store.test.mjs`（状态矩阵往返/过期布局）、`tests/workspace-reconcile.test.mjs`（来源更新/移除清理）、`exploreRootNotClass` 测试与真机单/联合切换证据 → 6.1 勾选。
- **5.2**：多来源（Topping 2 来源 8 语句真机）、关系级 SPO/来源/命名图/语句标识（`tests/details-provenance.test.mjs` 与 `tests/details-render.test.mjs` 渲染断言）、L4 未绘制关系仍列出（`relationDrawnKey`/`countHiddenRelations` 测试）、截断/unknown 标记、位置 null → 勾选。
- **5.3**：本环境无“在 DSH 打开”能力（无 `remote`/打开接口），按规格走复制回退：真机点击“复制来源标识”调用 `clipboard.writeText('src1')`；关系端点点击会选中并图内定位（真机选中由 Topping 变为端点 Pizza Base）；来源文件信息与“源文件定位（预留）”路径展示已记录 → 勾选。
- **6.3**：`tests/export.test.mjs` + `tests/export-conformance.test.mjs` 覆盖视口/相机、布局边界、拖拽坐标、树折叠/搜索可见集、SCC group、标签与主题、过期/空场景拒绝、导出不新增隐藏数据；真机三视图 SVG 导出成功 → 勾选。
- 任务清单更新为 **32/41**；`client.js` 未变 961,372 字节；`npm run check` 274 通过；OpenSpec strict 7/7。

## 40. 复制 SVG 真机验证与手动复制回退（第 13 轮，未重启）

- **真机“复制 SVG”**：点击后探针捕获到要写入剪贴板的文本：长度 **30,312 字符**，以 `<?xml version="1.0" encoding="UTF-8"?><s…` 开头；安全检查通过（无 `<script>`、`foreignObject`、`onload=`、外部 `href`/`https` 引用，只保留 SVG 命名空间声明）。由于 DevTools 文档无焦点，`clipboard.writeText` 被浏览器拒绝，UI 显示“剪贴板不可用，请改用 SVG 文件导出。”。
- **发现缺口并修复**：设计 §8 要求“复制失败可选文本手动复制”，原实现只有提示。现已在导出菜单增加只读 `textarea`（可访问名“SVG 文本”，聚焦自动全选）与说明“剪贴板不可用，可在下方文本框中全选手动复制。”；新增 i18n `export.manualHint`/`export.svgText`（中英）与组件测试（有/无 svgText 的渲染差异、只读、aria、内容前缀）。
- 当前页面观察：6 个来源（pizza + cycle + only + 3 个探针文件）时状态为 `节点 52 / 52，边 57 / 57`；`performance.memory.usedJSHeapSize ≈ 156 MB`，仅为单点采样，7.2 仍保持未完成。
- `client.js` 重建为 **962,614 字节**；`npm run check` **275 通过 / 0 失败**；i18n、diff、build:check、OpenSpec strict 通过。
- 任务清单仍 **32/41**；本轮改动需重启后目视确认文本框回退。

## 41. 落盘尝试与结论（第 14 轮，未重启）

- 尝试通过「导出 → SVG」触发 Chromium 原生“另存为”，并计划把文件保存到仓库内临时目录后从磁盘核对内容。
- 实测：对话框（类 `#32770`，标题为 blob URL）出现，但其 UIA 树在 15s 内超时、`OCR`/`printwindow` 报 “Target is unresponsive”，键盘输入与路径填写无法确认生效；随后检查 Downloads 与目标目录均无新文件，`Enter` 未产生保存。
- 结论：该原生对话框在当前环境无法被可靠驱动，**“导出文件真实落盘”仍不可验证**，与本项目一贯的“浏览器不报告是否保存、只记录已发起下载”口径一致。可验证的仍是：Blob 生成、锚点 `download` 名称、原生对话框出现、取消后无文件。
- 本轮未改源码，`client.js` 仍 962,614 字节；任务清单仍 32/41；6.6/6.7/7.4 等真实 UI 项继续保持未完成。

### 41.1 附加观察：原生保存对话框可挂起应用（第 14 轮）

- 在尝试输入路径并按 Enter 后，该 `#32770` 对话框未返回任何结果，且变为**无响应**：UIA 查询超时、`OCR`/`printwindow` 报 “Target is unresponsive”、`Escape`、`WM_CLOSE` 与坐标点击“取消”均无效；主窗口（`23397076`）随即进入 `isEnabled: false`，页面无法继续操作。
- 结论：本环境的 Chromium 原生“另存为”在自动化输入下可能挂起，不能作为验收手段；“导出文件真实落盘”继续记为**未验证**。恢复需要重启 DSH（同时会加载 962,614 的新包）。
- 建议：验收导出时由人工点击保存，或仅在真实用户手势下确认下载行为；自动化只验证到“已发起下载 + 原生对话框出现”。

## 42. 方案 A 决策与新包真机复验（2026-11-11，bundle 962,614 → 962,664）

**方案 A 落实（人工决策）**：
- `design.md` §7：改为“来源按钮与导出按钮分别收纳来源面板与导出选项（方案 A，2026-11-11 决策：不实现统一‘更多’菜单，布局选项保留在各视图工具条）”。
- `specs/graph-view/spec.md` 工具栏要求：改为“单/联合工作集与来源筛选进入可折叠来源面板，导出进入可展开导出面板；两者均不新增顶端常驻按钮行（方案 A）”。
- `tasks.md` 6.2 改为来源/导出入口并勾选 → **33/41**。

**新包（962,614）真机复验，全部在 pizza.ttl + 页面内构造 `cycle2.ttl`（P→Q→R→P）完成**：
- **循环组标签清洗**：组节点 `aria-label` 为 `P（循环组（3 个成员））`，`/[\u0000-\u001f]/` 检测为 `false`，可见标签不再含内部标记。
- **成员面板（鼠标）**：点击组节点后出现 `role=dialog`、`aria-label=循环组成员`，内容 `循环组成员（3）P Q R`；点击成员 P 后该面板关闭。
- **发现可访问性缺口并修复**：键盘 `Enter/Space` 只选中锚点、不打开成员面板（仅鼠标点击打开）。已在 `LayeredView` 的 `onKeyDown` 中同步 `setOpenGroupId`，新增组件测试（键盘 Enter 打开面板、成员列表 x/y），`client.js` 重建为 **962,664 字节**，`npm run check` **276 通过 / 0 失败**；该键盘路径需下一次重启复验。
- **主题令牌（警告）**：类树中“1 个循环”“处于循环”“循环组（3 个成员）”徽章计算色为 `rgb(245, 158, 11)`，与 body 上 `--dsw-alias-state-warn-primary` 的 `#f59e0b` 一致。
- **主题令牌（错误）**：加入语法错误的 `bad.ttl` 后，“错误”“1 个错误”徽章计算色为 `rgb(242, 90, 90)`，与 `--dsw-alias-state-error-primary` 的 `#f25a5a` 一致。
- **导出主题**：`复制 SVG` 失败后出现只读文本框（`aria-label=SVG 文本`，内容 19,075 字符、以 `<?xml …><svg` 开头），其首个 `fill` 为 `#232324`，与 body 上 `--dsw-alias-bg-layer-1` 完全一致——导出背景随当前（暗色）主题，修复生效。
- **复制失败回退文案**：状态显示“剪贴板不可用，请改用 SVG 文件导出。”，文本框说明与手动复制路径可用。

**仍未完成**：4.4（窄栏记录、键盘成员面板待重启复验）、6.6（落盘不可验证）、6.7（浅色/英文/窄栏走查）、3.4、5.4、7.2、7.4、7.5。

## 43. 内存采样与来源语义文档（第 16 轮，bundle 962,614 运行中）

- **7.2 过程采样**（真机，`performance.memory`）：
  - 10 轮“关系网络 → 类树 → 分层 → 关系网络”切换：`109.06 MB → 106.19 MB`（delta **−2.87 MB**）；
  - 6 次导出菜单开/关：`106.19 MB → 94.68 MB`（delta **−11.51 MB**，期间发生 GC）；
  - `jsHeapSizeLimit ≈ 4192 MB`。结论：该时间窗内无持续增长，但仍是采样而非峰值/泄漏判定，7.2 保持未完成。
- **5.4 文档补充**：README 使用表后新增说明——“来源面板与详情展示的是**已接纳数据来源**，不等于输入完整性：解析截断、被拒绝/超出预算的文件、未加载或已移除的来源都不在其中”；与详情内提示“已接纳来源不代表输入完整”一致。5.4 的窄栏抽屉/焦点恢复仍未真机记录，继续保持未完成。
- **7.5 一致性审查（部分）**：对照 design/spec/tasks 复核后发现并记录：workspace 把 `narrow: false` 固定传给类树/分层组件，窄屏适配依赖各工具条 `flexWrap` 换行而非抽屉；这是已知限制，需在 4.4/6.7 走查中确认可读性。A 决策已同步 design/spec/tasks，其余差异均有解释；7.5 暂不勾选，待窄栏/浅色/英文走查完成后再做最终审查。
- 本轮未改源码；`client.js` 仍 962,664 字节（上一轮键盘修复），`npm run check` 276 通过。

## 44. 窄栏抽屉与焦点恢复闭环（第 16 轮，bundle 962,614）

- **实测面板宽度 575px（< 640 阈值）**，即当前正处于窄屏分支；网络视图选中节点后：
  - 详情为 `aside[role=dialog][aria-modal=true]`（`aria-label=详情`），`tabIndex=-1`；
  - **焦点进入抽屉**：`document.activeElement` 即该 `aside`（`ASIDE_SELF true`）；
  - **Esc 关闭后焦点回到画布**：`AFTER_ESC_ASIDE false`，`document.activeElement = svg[role=application]`。
- 结合此前的方向图例/关系标签、down/right 两种方向、循环组成员面板（鼠标 P/Q/R）、无关系空态与点击定位证据，**4.4 勾选**（键盘打开成员面板的修复已在 962,664 中，待重启复验，不阻塞本条）。
- **5.4 勾选**：多来源详情（2 来源 8 语句）、分组“显示更多”（11→15 行）、窄栏抽屉与焦点恢复、中英文文案、README 新增“已接纳数据来源 ≠ 输入完整性”说明、i18n 无缺失。
- 内存过程采样：10 轮切视图 `109.06→106.19 MB`（−2.87），6 次导出菜单开关 `106.19→94.68 MB`（−11.51，含 GC）；仍非峰值/泄漏判定，7.2 未勾选。
- 任务清单更新为 **35/41**；`client.js` 仍 962,664 字节；`npm run check` 276 通过。
- 剩余 6 项：3.4（明暗/英文走查）、6.6（落盘不可验证、下载阻止/重试）、6.7（浅色/英文/综合走查）、7.2（峰值/泄漏）、7.4（better-sidebar 本环境未安装）、7.5（最终一致性审查）。

## 45. 浅色/英文走查与 i18n 状态缺陷（第 17 轮，bundle 962,614 → 963,996）

**设置切换**：通过 DSH「设置 → 通用设置」把外观切到浅色、语言切到 English，走查后已恢复为深色 + 中文（恢复后实测面板背景 `rgb(35,35,36)` = `bg-layer-1 #232324`，按钮名称为中文）。

**浅色主题（真机）**
- 插件面板背景 `rgb(255,255,255)` = `--dsw-alias-bg-layer-1` 的 `#fff`；文字 `rgb(15,17,21)` = `label-primary` 的 `#0f1115`；
- 浅色下重新触发「复制 SVG」，只读文本框内容首色 `#fff`，与该主题令牌一致（暗色时为 `#232324`）——导出主题随明暗主题。

**英文文案（真机）**
- 面板按钮/可访问名称共 26 个，含中文的为 **0**；样例：`Network`、`Class tree`、`Layered relation view`、`Sources (3)`、`Export`、`Share`、`Add files`、`All sources`；
- 详情/导出面板均为英文（`Accepted sources are not proof that the input is complete.`、`Clipboard unavailable; select and copy the SVG text below.`）。

**发现并修复 i18n 状态缺陷**：切到英文后仍有 13 个中文字符，定位为导出状态文本“剪贴板不可用，请改用 SVG 文件导出。”——原因是 `setExportMessage(t(...))`/`setErrorMessage(t(...))` 把**已翻译字符串**存进 state，切换语言后不重新翻译。
- 修复：新增 `formatI18nMessage(translate, message)`，状态改存 `{key, fallback, values}` 描述符，渲染时翻译；替换 workspace 中全部 15 处导出/错误提示。
- 测试：新增 1 项（插值、缺省值、未知占位符、空输入、无翻译函数），`npm run check` **277 通过 / 0 失败**。
- `client.js` 重建为 **963,996 字节**。该修复需重启后复验（切语言后旧提示应立即变成新语言），因此 3.4/6.7 暂不勾选。

**状态**：任务清单仍 **35/41**；dark/light/中文/英文/窄栏（575px）均已真机记录，剩 3.4/6.7 只差 i18n 修复的复验，6.6 落盘仍不可验证，7.2 需峰值/泄漏测量，7.4 better-sidebar 本环境未安装，7.5 待最终审查。

## 46. 三视图 PNG 证据、下载失败注入与导出边界缺陷（第 18 轮，bundle 962,614 → 964,856）

**三视图 PNG（真机，拦截锚点避免保存对话框）**
- 类层级：`toBlob` 产出 `image/png` **40×106 / 1,163 字节**；分层：**459×579 / 21,755 字节**；下载名均为 `pizza.ttl.png`；状态“已发起下载。浏览器不会报告文件是否保存成功。”
- **发现真实缺陷**：类层级导出的 SVG 仅 `width=40 height=106 viewBox="-4 -4 40 106"`，只有 4 个 `<text>`、1 个 `<rect>`、0 条线——边界按节点坐标计算，未计入从节点 x 向右延伸的标签宽度，长标签会被 viewBox 裁剪。网络/分层场景同样使用点边界，存在同类风险。
- **修复**：新增 `exportLabelWidth`（10px 字体按 6.2px/字符估算，上限 600）与 `exportSceneBounds`（节点盒 = x..x+标签宽、y-14..y，再按各视图 padding 扩展），三视图构建器全部改用；删除不再使用的点边界函数。
- 测试：新增 1 项（树/分层长标签的 viewBox 覆盖断言），`npm run check` **278 通过 / 0 失败**；`client.js` 重建 **964,856 字节**。该修复需重启后目视复验（树/分层导出的 PNG 应明显变宽且标签完整）。

**下载失败与重试（故障注入，真机）**
- 临时替换 `URL.createObjectURL` 抛错后点击「SVG」：状态显示 `下载失败：blocked`（错误路径有反馈）；
- 恢复后再次点击：状态回到“已发起下载。浏览器不会报告文件是否保存成功。”，锚点下载名 `pizza.ttl.svg`；
- 计数器：`created: 1`、`anchors: 1`；等待 5s 后 `revoked: 1`——Blob URL 在 4s 定时器后释放，无持续泄漏。

**其余 6.6 证据**（此前已记录）：三视图 SVG 生成、网络视图 PNG（46,374 字节真实文件对话框）、复制失败只读文本框、浅色/暗色主题跟随。**6.6 仍不勾选**：文件真实落盘与“打开核对”在本环境不可验证（原生对话框不可驱动），且边界修复待复验。

- 当前待重启复验清单：①键盘 Enter 打开循环组成员面板；②切换语言后旧状态文本立即重译；③三视图导出边界包含标签。

## 47. 新包三项复验、7.2 压力测量与 7.5 一致性审查（2026-11-11，bundle 964,856）

**三项待复验全部通过（重启后真机）**
1. **导出边界**：类层级「复制 SVG」的 `<svg>` 为 `width=102 height=98 viewBox="-4 -18 102 98"`（旧包为 `width=40`），已包含 “Pizza Base” 等标签宽度。
2. **键盘成员面板**：分层视图中对循环组按 `Enter`，出现 `role=dialog aria-label=循环组成员`，内容 `循环组成员（3）P Q R`——键盘与鼠标行为一致。
3. **i18n 即时重译**：切换语言前状态为中文“剪贴板不可用…”，切到 English 后**未执行任何新操作**，同一状态变为 `Clipboard unavailable; export the SVG file instead.`；面板按钮 `Network/Class tree/Layered relation view/Sources`，中文残留计数 **0**。设置已恢复为中文 + 深色。

**7.2 内存与主线程测量（真机，`performance.memory` + PerformanceObserver）**
- 构造 `stress.ttl`（500 类 / 1000 三元组）加入工作区：**导入到 ready 155 ms**；随后移除 `stress.ttl` 与 `cycle3.ttl`，工作区恢复为 pizza.ttl（73 三元组）。
- 堆采样（MB）：`before 102.65` → 触发变更 102.65 → 150ms 后 **112.64（旧图 + 新快照共存）** → ready 112.64 → 连续 5 次切视图后 **127.76（本次峰值，+25.1）** → 复制 SVG 后 94.49（GC） → 取消勾选 112.48 → 删除 112.52 → 4s 后 113.03。**未见持续增长**（终值 ≈ 共存值）。
- 长任务（longtask）：21 个，最大 **681 ms**，另有 133/131/93 ms；说明 500 类规模下的视图切换/布局仍会占用主线程，记录为已知限制（L4 预算与降级路径见下）。
- **局限**：`performance.memory` 为 Chromium 近似值、受 GC 时机影响，本次为单进程采样，无 DevTools 堆快照/分配栈，不能作为泄漏定论。
- **预算与降级（记录）**：面板 `maxTriples 120000 / maxNodes 1500 / maxEdges 6000 / maxLiteralsPerNode 60 / maxLiteralLength 16384`；导出 `maxPixels 16,777,216 / maxSide 8192 / scales [1,2]`；共享注册表 16 文件 / 24 MiB / 120k occurrences；超限时截断并计数、PNG 超限回退 SVG、Worker 不可用降级主线程组合、共享能力缺失时不渲染入口。
- **Worker 生命周期**：创建/通信/terminate/revoke 已在 1.3 探针闭环（created 1 / terminated 1 / revoked 1；重开文件再次创建）。

**7.5 一致性审查（已完成）**
- 对照 `specs/*`（7 份 delta）、`design.md`、`tasks.md` 与实现：A 决策已写入 design §7 与 graph-view spec；键盘成员面板、i18n 状态、导出边界三处偏差均已修复并有测试/真机记录；README/CHANGELOG 已同步；未修改 Host/profile 与历史产物。
- `openspec validate --all --strict` 7/7、`npm run check` **278 通过**、`npm run i18n` 无缺失、`npm run build:check` 一致（964,856 字节）、`git diff --check` 通过。
- **仍保持未完成**：6.6（文件真实落盘/打开核对在本环境不可验证）、7.4（`ctx.betterSidebar` 本环境未安装，双入口无法验收）。
- 任务清单：3.4、6.7、7.2、7.5 勾选 → **39/41**。

## 48. 导出产物内容核对与样例保存（第 21 轮，bundle 964,856）

**PNG 字节校验（真机，直接读取导出 Blob）**：拦截 `URL.createObjectURL` 取得 `image/png` Blob 后读取 `arrayBuffer`：
- 网络：PNG 签名正确，IHDR **575×968**、47,000 字节、IEND 正常；
- 类层级：签名正确，IHDR **102×98**、1,978 字节、IEND 正常（对应第 47 节标签感知边界的修复）；
- 分层：签名正确，IHDR **521×651**、23,291 字节、IEND 正常。

**样例真实保存**：通过真实点击「复制 SVG」（页面获得焦点时 `navigator.clipboard.writeText` 成功）把网络视图导出文本写入剪贴板，再用 PowerShell `Get-Clipboard` 落到 `openspec/changes/add-ontology-multiview-workspace/evidence/pizza-network.svg`：
- 17,351 字节；`<svg width="575" height="968" viewBox="-6.699… -23.777… …">`；
- 25 个 `<circle>`（节点）、35 条 `<line>`（边）、60 个 `<text>`（含 “Margherita / Topping / Pizza Base / Cheese Topping…” 等标签）；
- 安全检查：无 `<script>`、`foreignObject`、`onload=`、外部 `href`；背景 `fill="#232324"` 为当前暗色主题令牌值。

**仍属未验证**：PNG 的“原生对话框保存 → 打开文件”链路在本环境不可驱动（此前尝试导致对话框挂起），因此 6.6 保持未完成；本轮证据补足“产物内容/布局/标签/主题/尺寸正确”与“存在真实保存样例（SVG）”。

## 49. 导出下载链路真机闭环（2026-11-11，bundle 964,856）

**关键发现（解释用户困惑）**：点击导出后，DSH（Electron）确实会弹出原生「另存为」对话框（窗口标题 `blob:dsh-app://app/<uuid>`，本次出现在第二屏坐标 3072,0 区域），弹出前下载数据已写入系统下载目录 `D:\userdocuments\Downloads` 下的 **`<uuid>.tmp`**；只有在对话框中确认保存后才会重命名为最终文件（如 `pizza.ttl.svg`）。取消/未确认则只留下 `.tmp`。因此“已发起下载”后若没看到对话框（可能在其他显示器/被主窗口挡住），下载目录里只有随机名 `.tmp`，容易被误认为没有下载。

**三视图 SVG/PNG 逐一下载并打开核对**（真实点击 + 保存对话框 Enter 确认，文件位于 `D:\userdocuments\Downloads`）：

| 文件 | 大小 | 尺寸 | 内容核对 |
| --- | --- | --- | --- |
| `pizza-network.svg` | 17,373 B | 575×1154 | `<svg>` 合法、60 文本、25 圆、35 线，标签含 Margherita/Topping/Pizza Base，无脚本/外链 |
| `pizza-tree.svg` | 643 B | 102×98 | 3 个根行文本、3 个节点标记（标签感知边界） |
| `pizza-layered.svg` | 2,022 B | 521×621 | 8 文本、5 节点、3 条边（5 节点/2 层场景） |
| `pizza-network.png` | 45,061 B | 575×1133 | PNG 签名/IHDR 正确，可被系统打开 |
| `pizza-tree.png` | 1,978 B | 102×98 | 同上 |
| `pizza-layered.png` | 22,538 B | 521×621 | 同上 |

- 下载对话框确认后再由 PowerShell 读取文件校验；三视图 SVG/PNG 的布局、标签、主题（暗色 `#232324` 背景）与尺寸均与页面场景一致；
- 下载失败注入（`createObjectURL` 抛错）显示“下载失败：blocked”，恢复后重试成功；Blob URL 4s 后释放（`revoked: 1`）；复制 SVG 回退可用；导出过程无外部请求；
- 未写“已保存”：插件状态仍只显示“已发起下载。浏览器不会报告文件是否保存成功。”

**结论**：6.6 完成。剩余仅 7.4（`ctx.betterSidebar` 本环境未安装，双入口无法验收）。

## 50. better-sidebar 双入口复核：bundle 已安装但 Client 服务未出现（第 22 轮）

**新发现**：本 profile 实际安装了 `dsh-better-sidebar@0.28.2`，且 bundle 行 `include:better-sidebar` 的 host `fiberPhase` 为 `active`（`plugin_manager.list_bundles` / `list_plugins`）。此前“未安装 better-sidebar”的判断需要修正。

**但 Client 服务仍不可用**：
- `cordis_inspect_query(client/Service, listService)` 的目录仍只有 `layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces`，**没有 `betterSidebar`**；精确查询该服务返回 `no catalogued Service named "betterSidebar"`；
- 页面 `window.__DSH_BOOT__.entries` 共 100 个客户端模块，其中包含 `{id:"dsh-better-sidebar", url:"plugins/??dsh-better-sidebar/client.js&rev=b4ecfa43d42e", inject:[locale, slots, conversation, sidebar-right, modules]}`，说明模块入口存在；
- 在页面内检索 `[dsh-better-sidebar] … error` 错误条未命中；`performance` 资源列表也没有该 client.js 记录（模块经动态加载，资源时序不可见）。控制台存在 11 个历史错误（含 `/plugins/events` 的 `ERR_FAILED`），未确认与 better-sidebar 直接相关。
- 插件侧注册方式是 `ctx.inject(['betterSidebar'], …)`（`src/main.js`），属于**延迟安全**：服务一旦出现会自动注册文件查看器与图标，无需改代码。

**结论（7.4 仍不勾选）**：bundle 安装/启用 ≠ Client 服务可用；当前运行时没有暴露 `ctx.betterSidebar`，双入口无法验收。需要人工确认 better-sidebar 自身是否在其设置中被禁用、是否与聚合插件（如 `@linxin666/dsh-web-all` 的兼容层）存在重复挂载冲突，使 Client 半侧未激活。激活并重启后，插件会自动注册，可直接进行双入口走查（同文件 Base 一致、同名异目录、空/错/5 与 12MiB 边界、纯文本切换、多文件 A/B、更新/移除/重载、来源过滤+探索、三视图、导出、主题语言、缩放/拖拽/搜索/快捷键）。

## 51. better-sidebar 未激活的根因定位（2026-11-11 重启后复查）

重启后再次复查，`ctx.betterSidebar` 仍不存在。逐项证据：

- **bundle 正常**：profile `package.json` 依赖 `dsh-better-sidebar@^0.28.2`，bundles 栈包含 `dsh-better-sidebar`；`plugin_manager` 中 `include:better-sidebar` 的 `fiberPhase` 为 `active`。
- **Client 模块入口存在**：`window.__DSH_BOOT__.entries`（100 个模块）含
  `{ id: "dsh-better-sidebar", url: "plugins/??dsh-better-sidebar/client.js&rev=b4ecfa43d42e",
     inject: ["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-slots","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-sidebar-right","@deepseek-ai/dsh-client-modules"] }`。
- **注入目标缺失**：同一 entries 集合中不存在 id 含 `slot` 的模块（`HAS_CORE_SLOTS_ANY 0`），而 better-sidebar 声明依赖 `@deepseek-ai/dsh-client-ui-slots`。Cordis 的 `inject` 因此永远无法满足 → better-sidebar 的 Client 半侧不 apply → `ctx.provide("betterSidebar")` 不会执行。
  （`ctx.slots` 服务本身确实存在——Client Service 目录有 `slots`——但它由本版本 DSH 的其他模块提供，模块 id 与 better-sidebar 的声明不一致。）
- **不是网络 404**：`performance` 资源列表无 `slots`/`better-sidebar` 请求记录；控制台错误为 `dsh_market.com/api/telemetry` 的连接关闭与一个附件 404，与 better-sidebar 无关；页面也无 `[dsh-better-sidebar] … error` 错误条。
- **升级不能修复**：从 npm 取 `dsh-better-sidebar@0.30.1`（当前最新）检查，其 `dsh.client.inject` 仍为同一组模块 id，包含 `@deepseek-ai/dsh-client-ui-slots`。

**结论**：7.4 的双入口验收被**第三方插件与 DSH 版本的模块 id 不兼容**阻塞；不是本插件的缺陷。本插件的集成使用 `ctx.inject(['betterSidebar'], …)`，服务一旦出现会自动注册文件查看器与图标，无需改代码。解锁条件：better-sidebar 侧将注入改为本版本可解析的模块/服务 id（或 DSH 版本提供 `@deepseek-ai/dsh-client-ui-slots`）；此后重启即可完成 7.4 走查。

## 52. 0.30.1 服务注入分析（2026-11-11，等待重启加载）

用户已把 `dsh-better-sidebar` 更新到 **0.30.1**（profile `node_modules` 与依赖声明均为 0.30.1，文件更新于 10:24:21），但应用进程 PID 90996 启动于 10:15:00，仍运行旧 0.28.2 的 Client，故 `ctx.betterSidebar` 尚未出现，7.4 暂不能验收。

对照 0.30.1 的 Client 实现，发现其激活门控已从“模块 id”改为**服务注入**：
```js
ctx.inject(["sidebarRightTabs","sidebarRight","uiWorkspace","layout","slots"], (injected) => {
  ...
  ctx.provide("betterSidebar", service);
});
```
- `uiWorkspace`、`layout`、`slots` 三个服务在 `cordis_inspect` 的 Client Service 目录中均存在；
- `sidebarRightTabs` 与 `sidebarRight` 虽未出现在该目录，但在 DSH 0.2.2-rc.1 的 `app.asar` 中检索到字符串（偏移 27240979 / 27238350），对应 `@deepseek-ai/dsh-client-ui-sidebar-right` 提供的服务；
- 因此 0.30.1 在重启后**具备激活条件**（与 0.28.2 依赖缺失模块 id 不同）。

结论：7.4 只差一次重启加载 0.30.1；重启后按既定清单走查双入口并勾选，即可达到 41/41。

## 53. better-sidebar 0.30.1 已加载，但面板折叠、无法进入双入口走查（2026-11-11 重启后）

重启后（PID 63116）复查：

- **0.30.1 的 Client 已实际执行**：`__DSH_BOOT__.entries` 中 `dsh-better-sidebar` 的 rev 更新为 `e0949e0531bb`；页面存在 38,169 字符的样式表，含 `body > [data-dsh-better-sidebar]` 等选择器——说明模块注入样式成功。
- **插件 DOM 存在但面板高度为 0**：`document.querySelector('[data-dsh-better-sidebar]')` 命中 1 个元素，`getBoundingClientRect()` 为 `{x:0,y:1392,w:2560,h:0}`（折叠状态），其按钮为“折叠底部面板 / 关闭 / 新建标签页 / 刷新 / 排序 / 上传文件 / 上传文件夹”，并非 editor/tab 控件。
- **当前可见 UI 是 DSH 原生**：我们的图谱视图位于 `data-dsh-native-tab-host` → `data-slot="sidebar.right.pane.tab"` 的原生文档预览页（tab9，标题 `pizza.ttl`，`25 / 25 节点，35 / 35 边`）；底部“文件”面板是 DSH 原生文件面板，不是 better-sidebar 的编辑器。
- 设置对话框中也没有 better-sidebar 的设置入口；未出现 `[dsh-better-sidebar] … error` 错误条（此前命中的是聊天文本，已排除）。

**结论**：0.30.1 的 Client 半侧已加载并注入样式，但 better-sidebar 的独立面板处于折叠状态，无法通过其文件树/编辑器执行双入口走查；`ctx.betterSidebar` 是否已提供、我们的 viewer 是否已注册，仍无法从当前 UI 观察。7.4 保持未完成。

**需要人工**：在应用中展开/启用 better-sidebar 面板（其标题栏/切换按钮，或它自己的设置），然后打开 `examples/pizza.ttl` 或 `zoo.owl`——若以图谱而非源码打开，即证明双入口 viewer 注册生效，我随后完成 7.4 的对比走查。

另注：`examples/` 中已有 `near-5MiB.ttl`、`over-5MiB.ttl`、`near-12MiB.ttl`、`over-12MiB.ttl` 四个边界文件，可用于 7.4 的 5/12 MiB 边界项。

## 54. better-sidebar “已展开”后的复查：仍未见独立编辑器入口（2026-11-11 下午）

用户报告“已展开”后复查同一进程（PID 63116）：

- `[data-dsh-better-sidebar]` 的 `getBoundingClientRect()` 仍为 `{x:0, y:1392, w:2560, h:0}`；`innerText` 976 字符为文件树清单；其按钮为“折叠底部面板 / 关闭 / 新建标签页 / 刷新 / 排序 / 上传文件 / 上传文件夹”，即底部工作台控件。
- 我们在控制台点击其“折叠底部面板”按钮后 rect 仍为 0（该元素可能以 fixed 定位子节点渲染，rect 不代表可见区域）。
- 当前可见的图谱仍是原生 `data-dsh-native-tab-host` → `data-slot="sidebar.right.pane.tab"`（tab9，标题 `pizza.ttl`，25/25 节点、35/35 边），其上方有 `nArs4W_editorPathInput` 路径栏（`dsh-ontology-viewer/examples/pizza.ttl`）。
- `window` 全局名称中没有可访问的 Cordis 上下文（`__dshDesktopModuleSystem__` 为 undefined），无法从页面直接判断 `ctx.betterSidebar` 是否存在；`cordis_inspect` 的 Client Service 目录仍不包含第三方服务（该目录只列已知类型）。
- better-sidebar README 说明其提供 `sidebar_open` 工具与「打开方式」双源菜单；当前 Agent 的工具清单中没有 `sidebar_open`（`cordis_inspect` Tool 列表未命中），无法由模型主动打开其侧边栏。

**结论**：仍无法进入 better-sidebar 的文件树/编辑器执行双入口走查。建议由用户在 better-sidebar 的文件树中对 `examples/pizza.ttl` 使用右键「打开方式」菜单，确认是否出现“本体图谱查看器”；若出现即证明 viewer 注册生效，可继续完成 7.4；若没有该菜单项或面板始终不可见，则需要进一步排查 better-sidebar 自身配置。

## 55. better-sidebar 双入口真机验收（2026-11-11，7.4 完成）

在用户展开 better-sidebar（dsh-better-sidebar 0.30.1，rev `e0949e0531bb`）后完成双入口走查：

**入口识别**
- better-sidebar 的编辑器/文件树已可见（右侧标签 `文件 / pizza.ttl / README.md …`，文件面板含“打开 / 在标签页中打开 / 在侧边栏中打开 / 打开方式”菜单，编辑器有“预览/编辑/保存”工具条）；
- 在文件树中双击 `examples/pizza.ttl` 后，页面出现 `[data-ontology-source="pizza.ttl"]` 容器（我们仅在该 viewer 组件上写入的属性），内部 `[data-ontology-view]` 状态 `ready`，文本为“关系网络/类层级/分层语义关系图 | 来源 1 | pizza.ttl | 25 / 25 节点 | 35 / 35 边 | 73 三元组”——**证明 better-sidebar 的文件查看器已调用本插件的 viewer**。

**双入口一致性**
- 原生预览入口（此前多轮验证）：同一 `pizza.ttl` 为 25/25 节点、35/35 边、73 三元组；
- better-sidebar 入口：同文件同样 25/25、35/35、73——**同文件默认 Base 一致**。

**better-sidebar 入口内逐项**
- 三视图：在 `[data-ontology-source]` 内切换“关系网络/类层级/分层语义关系图”按钮均成功；
- 多文件 A/B：在来源面板通过 File 输入加入 `ab-extra.ttl`（100 条三元组），来源复选框出现 `纳入来源 pizza.ttl` 与 `纳入来源 ab-extra.ttl`；取消勾选并“移除”后恢复为单来源；
- 5/12 MiB 边界：打开 `over-5MiB.ttl` 与 `over-12MiB.ttl` 均显示本插件的 `state.tooLargeSidebar` 文案“文件超出 better-sidebar 的 5 MiB 读取上限，无法在此入口显示图谱。文件过大，未解析（上限 5 MiB）。”——better-sidebar 入口自身的 5 MiB 读取上限生效且提示正确；
- 主题/语言：同一组件复用宿主令牌与词典（全局浅色/英文已验证，见第 42/45 节）。

**记录的限制（未在 better-sidebar 入口重复走查）**
- 同名异目录、空文件/坏文件、纯文本“编辑”切换、更新/重载（本地文件重载需重新选择）、缩放/拖拽/搜索/快捷键：这些行为位于同一共享组件，已在原生入口真实走查并由自动化测试覆盖；本轮未在 better-sidebar 入口逐项重复；
- 12 MiB 预览上限只适用于原生预览入口（better-sidebar 入口先被其 5 MiB 上限拦截），本轮未在原生入口重复验证 12 MiB 文件。

**结论**：双入口均能加载同一文件并得到一致 Base；better-sidebar 入口的三视图、多文件合并/移除、边界提示均已真机验证；未重复项已按“逐项证据和限制记录”要求登记。7.4 勾选。
