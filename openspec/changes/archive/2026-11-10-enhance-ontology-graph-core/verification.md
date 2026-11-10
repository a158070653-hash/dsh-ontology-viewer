# Verification Record — enhance-ontology-graph-core

> 本文件记录 Apply 阶段的验证证据与未执行项，供人工最终验收使用。它不是 OpenSpec 的规划制品，不改变 proposal/design/specs/tasks 的契约内容。
> 记录时间：2026-11-09（Asia/Shanghai）；环境：Windows、Node v24.18.0、16 CPU。

## 1. 自动化验证命令与结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm test` | 130 tests / 130 pass / 0 fail | 解析、图模型、计算任务、视图状态辅助函数、示例端到端、打包接线（含内嵌 Worker 源真实执行） |
| `npm run check` | 通过（exit 0） | `node --check client.js` + 构建一致性 + 全部测试 |
| `npm run build` | 生成 `client.js`（606,836 字符；文件 610,106 字节） | 含内嵌 Worker 源 |
| `npm run build:check` | 通过 | 产物与源码字节一致 |
| `npm run i18n` | 通过（exit 0） | 129 个视图 key，ZH/EN 各 134 条，无缺失、无单边条目 |
| `npm run stats` | 通过 | 5 个示例 + 6 万三元组压力用例；`courses.jsonld` 34 → 36 triples（`@graph` 修复） |
| `npm run bench` | 通过 | 五类夹具分阶段基准（见 §2） |
| `openspec validate enhance-ontology-graph-core --strict` | valid | 规划制品结构有效 |

说明：测试数量随代码演进，不是契约；以 `npm test` 全绿为准。

## 2. 性能对比（改造前 vs 改造后）

同一脚本、同一机器、同一夹具；顺序执行可能受当时其它进程影响，p50 仅作量级参考。基线取 `git worktree` 的 HEAD `1e40dbb`。

| 夹具（规模） | 阶段 | V1.0.0 p50 | 改造后 p50 |
| --- | --- | --- | --- |
| medium（601 节点 / 2460 边 / 3060 三元组） | parse | 4.13 ms | 4.99 ms |
| | build | 1.74 ms | 2.17 ms |
| | layout(320) | 84.2 ms | 84.7 ms |
| | layout(1000) | 261.7 ms | 265.9 ms |
| near-limit（1500 节点 / 120000 三元组） | parse | 155.9 ms | 166.4 ms |
| | build | 45.3 ms | 45.4 ms |
| | layout(320) | 209.0 ms | 220.5 ms |
| | layout(1000) | 653.7 ms | 667.4 ms |
| dense（1500 节点 / 50000 边） | parse | 65.1 ms | 72.5 ms |
| | build | 31.6 ms | 37.1 ms |
| | layout(320) | 287.1 ms | 294.1 ms |
| | layout(1000) | 859.4 ms | 874.4 ms |
| small（5 个示例） | parse/build/layout | 0.1–2 ms | 0.1–2 ms |

解读：

- 重夹具的解析/建图成本增加 5–17%，主要来自诊断聚合、深度/字面量上限与 Base IRI 防御性映射；属于可靠性换取代价，未出现数量级退化。
- 布局数学未变（`layoutGraph` 与 V1.0.0 输出逐位一致，`createLayoutTask` 跑到完成亦逐位一致）；差异来自环境噪声。
- 行为修正可见：`courses.jsonld` 34→36 triples；deep-nesting 输入从"无上限解析 2000 triples"变为"255 triples + nesting-limit 错误"；超大 literal 从静默接受变为截断 + `literal-limit` 诊断。

### Worker 传输开销代理指标（Node，非浏览器实测）

| 夹具 | graph JSON 字节 | `structuredClone` p50 |
| --- | --- | --- |
| medium | 290 KB | 1.5 ms |
| near-limit | 698 KB | 3.1 ms |
| dense | 8.35 MB | 41.3 ms |

真实 Worker 初始化/编译、消息往返、主线程等待与最长任务 **未在真实 DSH 页面测量**（见 §4）。

## 3. 构建与体积

- `client.js`：606,836 字符（610,106 字节），V1.0.0 为 196,273 字节；内嵌 Worker 源约 1.8×10^5 字符。
- 架构评审已明确"实际体积以构建结果为准并接受 Worker 优先方案"；实测约为评审估算（~310KB）的 2 倍，已更新 design.md §3.2 记录。
- 单文件加载契约未变：无额外资源请求，Worker 源以字符串内嵌。

## 4. 真实 DSH 运行时验收

### 4.0 已完成的运行时检查（Cordis Inspect，只读）

本轮 Cordis client inspect 可用（此前超时问题已恢复），完成了以下只读核验：

- `Slots.listSubTree { root: "sidebar.right.tab.document" }`：live 槽位存在，occupants 中包含 `dsh-ontology-viewer/graph` 且 `active: true`——说明打包后的 Client 模块已在当前页面加载并完成 keyed 槽位注册。
- `Theme.listTokens`：当前宿主主题令牌清单已取得（14 个 `--dsw-alias-*`）。插件使用 `--dsw-alias-bg-layer-1/2`、`border-l1/l2`、`brand-primary`、`label-primary/secondary` 均在清单内；`interactive-bg-hover/active`、`label-tertiary` 不在该清单中，插件均为其提供了字面量兜底，深色主题下的实际观感仍需人工确认（见 §5）。
- `Service.listService`（client）与 `Builtin.listBuiltins`：确认宿主提供的 Client 服务与内置符号，未发现插件所需额外宿主服务；插件只依赖 `slots`/`locale`/`documentPreviews`/`betterSidebar` 契约。
- Host `Service.listService {service:"clientModules"}` 与 `Config.listConfigs {name:"dsh-ontology-viewer"}`：bundle 行存在（`include:dsh-ontology-viewer`），Host 侧未报装载失败。

### 4.0b 本机 Chromium 自动化验收（补充，2026-11-09 晚）

为验证用户在真实侧栏反馈的两个问题，安装了临时自动化组件（不入仓库、不进 package.json）：`playwright-core` + 系统 Microsoft Edge（headless），在 `%TEMP%\dov-harness` 搭建独立 harness——用 fake DSH ctx 加载**构建后的 `client.js`**，挂载真实的 `OntologyDocumentBody`，用 `examples/pizza.ttl` 的 bytes 驱动完整的 panel → job → Worker → model → view 链路。

结果（全部通过）：

| 检查 | 结果 |
| --- | --- |
| 初始渲染 | 25 节点 / 35 边 / 73 三元组；未出现"性能降级模式"→ **Blob Worker 路径真实运行成功** |
| 详情面板不挤压画布 | 选中节点前后画布宽度 1280 → 1280（delta 0），面板以覆盖层出现 |
| 多跳探索 | 1 跳 5 节点/4 边 → 2 跳 17/17 → 3 跳 22/33，徽标显示"22 个节点 · 3 跳" |
| 过滤 | 仅"类"：25 → 10 节点；清除后恢复 25 |
| 搜索 | 结果列表 18 条；↑/↓ + Enter 选中 1 个节点并打开详情；无结果时显示"没有匹配结果" |
| 详情端点定位 | 点击关系端点后详情标题从 "Pizza Base" 切到 "Class" |
| 缩放/适配/重新布局 | 120% → 150% → 120%；重新布局后节点坐标变化 |
| 拖拽节点 | transform 变化 |
| 主题令牌 | 注入暗色 `--dsw-alias-*` 后 `.dov-root` 背景从 rgb(255,255,255) → rgb(20,22,28) |
| 窄屏 | 600px 触发 `dov-root--narrow`；打开详情画布宽度 delta 0 |
| 页面错误 | 无 pageerror；仅 1 个 favicon 404 |

本轮据此修复三个实现缺陷：

1. **点击节点页面闪动**：详情面板原本是 flex 兄弟节点（宽屏挤占画布 300px），选中时画布尺寸变化 → SVG 重排/重新 fit。改为绝对定位覆盖层（窄屏抽屉不变），画布尺寸不再变化。
2. **选择跳数邻域不变化**：跳数/方向按钮只改 state，必须另按"展开邻域"才生效。改为选择跳数/方向即自动开始探索（`withExploreDepth` / `withExploreDirection`，含单测）。
3. **搜索 Enter 不选中节点**：`searchSelection` 对结果对象列表返回的是对象而不是 `id`，`selectAndCenter` 校验失败。改为统一归一化为节点 id（含单测）。另修复"重新布局"首次使用的 seed 从 0 递增到 1、与初始 seed 相同导致无变化的问题（`relayoutSeedRef` 初始改为 1）。

**仍然无法执行**（DSH 宿主专属）：`dsh-app://` origin 下的 CSP/Worker 真机行为、真实文件树/预览挂载、better-sidebar 入口、DSH 内主题与语言切换。以下项目**保持未完成，不得写成通过**：

1. Worker 探针：client.js 版本确认为最新构建（Network rev / 刷新）；主文档 CSP（`worker-src`/`default-src` 回退）；classic Blob Worker 构造与 postMessage 往返；worker 内真实解析/布局与主线程结果一致；`terminate()` + `revokeObjectURL` 后无残留且可重建。
2. 原生预览入口：打开示例文件 → 默认显示图谱；头部下拉切回纯文本；空文件 → 空状态；超大文件 → too-large；错误输入 → error + 诊断。
3. better-sidebar 入口：文件树打开示例 → 图谱页签与图标；0 字节文件 → 空状态；>5 MiB 文件 → 过大提示（宿主读取阈值）。
4. 过滤：节点类型 / 关系类型 / 方向（选中节点前后对比）、可见/总数计数、清除恢复。
5. 多跳探索：1/2/5 跳、出/入/双向、预算截断后"继续展开"、回到完整视图。
6. 详情：IRI/标签/类型/字面量、按谓词分组的出入边、折叠/显示更多、端点定位、截断提示、未绘制关系标记。
7. 搜索：结果列表、↑/↓/Enter/Esc、点击选择、无结果状态、被过滤隐藏节点的提示。
8. 主题与语言：亮/暗主题、中/英切换后新控件文案。
9. 窄侧栏：<640px 时工具栏、抽屉详情、搜索下拉、图谱可视高度。
10. 既有交互回归：滚轮锚点缩放 0.15–4、拖拽节点、平移、重新布局、适配视图、标签开关、悬停高亮、复制 IRI、`0`/`f`/`+`/`-`/`Esc`。
11. 降级模式：模拟 Worker 不可用时出现"性能降级模式"提示，预算收紧且功能完整。

人工执行建议：`npm run build` 后刷新 DSH 页面（link 安装会由 Host 轮询热换），按上述步骤逐项记录截图；Worker 失败时保留 Console 原文与环境版本。

## 5. 已知剩余问题

- **运行时空缺**：§4 全部项目未执行；尤其 Worker 路线尚未获得真机证据，当前只能确认构建、协议单元测试与 Node 侧模拟。
- **Worker 路由无可观察的 `modeling` 状态**：worker 协议只返回 parse→layout→ready；`modeling` 只在主线程降级路径可见。UI 文案已兼容，但规格中的状态展示在 Worker 路径上较粗。
- **边预算分层**：宿主调用同时传入模型级 `maxEdges=6000` 与视图绘制预算 6000，因此高密度图通常先在建模层裁剪（提示"图谱裁剪：保留 6000 / 共 N 条边"），绘制层不再触发二次裁剪；两层 API 均已实现并有单测，若后续需要"模型保留全部边、只在绘制层裁剪"，只需调高模型级上限并重新基准。
- **详情面板改为覆盖层**：宽屏下不再挤压画布（修复闪动），但会遮住右侧约 300px 图谱区域；这是有意的取舍，用户可平移画布。若后续希望"固定预留 300px 画布"，需要重新评估闪动与空间浪费的取舍。
- **布局尺寸**：main.js 以面板高度减约 44px 作为布局高度估算，实际 SVG 画布因工具栏换行可能略有差异；视图会重新 fit，视觉可用但布局长宽比不是精确值，需真机确认。
- **方向过滤语义**：过滤面板方向为相对锚点的 1 跳直接边；探索模式按跳应用方向。无锚点时方向过滤禁用。
- **Surface limit 提示**：仅在已有状态提示时合并展示，避免每个文件常驻 12 MiB 横幅；超大文件仍由 too-large 状态屏明确提示。
- **`f` 快捷键**、locale 服务缺失、`.xml` 未纳入扩展名等 V1.0.0 既有边界保持不变（见 docs/development.md §6）。

## 5.1 多跳高亮回归修复（2026-11-09）

用户提供 library.rdf / Book 的 1–4 跳截图，确认探索集合增长，但一跳以外节点和边被选中态强淡化。修复后，探索选中根不再触发强淡化；悬停时只适度淡化（节点 0.6、边 0.5），移开后恢复正常；全图模式一跳高亮保留。

验证：`npm run check` 132/132 通过、`npm run i18n` 通过、OpenSpec strict 通过。在临时 Playwright + Edge harness 加载最新生成的 client.js、真实 library.rdf，选中 Book：1 跳 4节点/3边、2跳 9/8、3跳 12/14、4跳 12/14；每次鼠标离开节点后 dim/context 元素数为 0，节点 opacity=1、边 opacity=0.9。悬停后只有 context 类（最低 opacity=0.5）、没有强淡化类；移开恢复；退出探索后全图一跳强淡化仍生效。页面异常为 0。该证据是独立浏览器验证，不替代真实 DSH 双入口最终验收。

## 5.2 用户侧验收反馈与自动化修正（2026-11-09）

用户反馈：2.0 无法自行执行；5.3 验证成功；5.4 Tab 被 DSH 接管，后续无法继续；5.5 普通示例与空文件已测试；5.6 键盘快捷键仍转移 DSH 焦点；6.3 除上述问题外均通过。该反馈属于真实侧栏观察，按项目证据规则记录，不扩写为未观察到的通过项。

本轮采取动作：

- **大文件测试文件**：新增 `examples/near-5MiB.ttl`（5,242,880 bytes）、`examples/over-5MiB.ttl`（5,242,881 bytes）、`examples/near-12MiB.ttl`（12,582,912 bytes）、`examples/over-12MiB.ttl`（12,582,913 bytes）。这些边界占位夹具均包含一条合法 Turtle 语句与超长 ASCII 字面量；用于读取门槛测试，不表示完整解析通过。操作步骤：在 DSH 工作区文件树依次打开上述文件；better-sidebar 对 over-5MiB 应提示宿主读取上限，对 near-5MiB 应能交给插件处理；原生预览对 near-12MiB 应进入解析（随后字面量长度诊断），对 over-12MiB 应显示插件大小上限。恰好等于阈值的行为也要记录；若入口不支持打开文件或读取状态不明，截 Console/状态提示并保留 5.5/6.3 未完成。文件可以继续作为验收夹具留在 examples/，也可以在人工验收后删除。
- **键盘焦点**：新增 graph-owned focus 检测与快捷键分派 helper；画布鼠标按下后先取消默认行为再聚焦 SVG；SVG 捕获阶段处理图谱快捷键并停止传播，搜索框自行处理方向键/Enter/Esc；节点选择后将焦点归还画布。单测覆盖 DSH-owned target 不触发图谱快捷键，以及 `f/0/+/-/Escape` 分派。用户反馈 Tab 仍由 DSH 全局导航接管、5.4 后续无法继续，且图谱快捷键仍会把焦点带回 DSH。代码已收敛快捷键作用域到图谱焦点并在点击画布/节点后显式聚焦，但**未在真实 DSH 侧栏复测，不能判定修复有效**；5.4/5.6 保持未完成。若复测仍被 DSH 捕获，先报告 Host 全局快捷键冲突，不扩大拦截范围抢占宿主操作。
- **临时 DSH 测试夹具**：原有 `examples/test.ttl` 是用户工作区既存空文件，本轮未覆盖或修改。

- **TDZ 回归修复（2026-11-09 用户侧栏反馈）**：用户在 better-sidebar 打开 `near-5MiB.ttl` 时报 `Cannot access 'clearSearch' before initialization`。根因是上一轮把原生 keydown 监听 effect 放在 `clearSearch` 声明之前，渲染时依赖数组提前引用未初始化的 `const`。已将 keydown effect 移到所有回调声明之后，并把 wheel 监听恢复为独立 effect；TDZ 绑定不再被提前读取。重建 `client.js` 并跑 `npm run check` 135/135、i18n、OpenSpec strict 均通过。
- **大文件预期确认**：better-sidebar 的实现是 `size > 5242880` 才拒绝。因此 `near-5MiB.ttl`（恰好 5,242,880 bytes）应被交给插件；`over-5MiB.ttl`、`near-12MiB.ttl`、`over-12MiB.ttl` 从 better-sidebar 入口都会被宿主拒绝并显示 5 MiB 提示，这是宿主行为，不是插件 12 MiB 上限。要验证插件 12 MiB 限制，必须从 DSH **内置文档预览**（Files 页签的右侧栏预览，而非 better-sidebar 文件树）打开 `near-12MiB.ttl` / `over-12MiB.ttl`。

自动验证：`npm run check` 135/135、`npm run i18n` 通过、OpenSpec `--strict` 通过；四个尺寸文件实际字节数与命名阈值一致。真实侧栏复测仍需人工执行。

## 5.3 用户侧栏复测确认（2026-11-09 晚）

用户在真实 DSH 侧栏确认：

- **大文件边界测试通过**：`near-5MiB.ttl` 可进入插件渲染且不再报 `clearSearch` 初始化错误；`over-5MiB.ttl` 与 12 MiB 文件在 better-sidebar 入口显示宿主 5 MiB 读取限制，符合宿主实现；插件 12 MiB 上限通过 DSH 内置文档预览验证。
- **键盘复测通过**：图谱快捷键在点击画布/节点取得焦点后按预期作用于图谱，不再被 DSH 抢走。

据此勾选 `5.5`（状态与提示，含大文件边界）与 `5.6`（既有交互回归，含键盘快捷键）。`5.4` 保持未完成：其验收范围还包含 Tab 能否进入画布、搜索结果 listbox 语义、详情抽屉焦点陷阱/归还、aria-live 与读屏体验，这些未在复测结论中单独确认，不能用快捷键通过代替。`2.0` 与 `6.3` 同样保持未完成（Worker 真机探针、双入口综合验收仍未提供证据）。

## 5.4 键盘可达性第二轮（2026-11-09）

用户实测 5.4：搜索键盘路径、ARIA 名称、减少动画通过；但点击画布后 Tab 仍被 DSH 全局导航接管，节点无法获得焦点，Enter/方向键无效；窄屏抽屉能循环但会回到 DSH。

据此调整实现（不依赖宿主 Tab）：

- 画布获得焦点后，方向键 / Home / End 在已绘制节点间移动 roving 焦点并程序化聚焦节点；Enter / Space 选中当前 roving 节点并打开详情；Esc 取消。这样即使 DSH 接管 Tab，键盘仍可完成节点选择。
- 点击画布/节点后在 pointerup 与 click 的下一帧显式把焦点交还 SVG，减少宿主点击后抢焦点。
- 窄屏详情抽屉在 window 捕获阶段接管 Tab/Shift+Tab，手动循环焦点；关闭抽屉后焦点归还画布。
- 新增 `moveRovingId` 纯函数与抽屉焦点目标单测；最新版 `npm run check` 137/137、i18n、OpenSpec strict 通过。

**仍未验证，5.4 不勾选**：当前无法进行真实 DSH 侧栏交互。本轮 DSH 窗口截图显示主会话及任务创建对话框，而不是 ontology 图谱；关闭或切换该用户状态不属于授权范围。方向键导航和抽屉焦点循环代码已有自动化验证，但 DSH 运行时是否仍先于 window 捕获监听截走按键，只能在目标图谱页确认。

## 6. 最终完成确认与归档

用户在归档流程中明确确认剩余验收项已完成，并要求先勾选再同步主规格、归档、提交和推送。据此 `tasks.md` 为 37/37 完成；2.0、5.4、6.3 的完成依据是用户最终验收确认，不是本代理新增取得的 Worker/CSP 或抽屉焦点自动化证据。上文的未验证说明保留为历史执行记录，不外推为工具已实测通过。

归档前最新自动检查：137 项测试通过、构建产物一致、i18n 无缺失、六份主规格 strict 校验通过。最后一次键盘修正将图谱按键处理移到 window 捕获阶段，但仅处理图谱内焦点；详情抽屉的 Tab 循环同样仅在窄屏抽屉打开时生效。

六个 capability 的 delta 已同步到主规格；归档日期为 2026-11-10。没有升级版本、创建 Release 或修改 DSH profile。
