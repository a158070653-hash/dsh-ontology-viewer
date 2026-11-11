# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)；版本号对应 `package.json` 的 `version`。

## Unreleased

暂无。

## 1.1.0 - 2026-11-11

### Added

- 多文件本体工作区：来源面板（添加/移除/重载、单文件与联合工作集、格式/状态/三元组/错误与警告/截断）、跨文件实体合并与来源追溯。
- 三种视图：关系网络（保留既有交互）、类层级树（显式 `rdfs:subClassOf`/`rdfs:subPropertyOf`、多重继承、根/孤立/循环）与分层关系图（谓词投影、SCC 循环组、上下/左右布局）。
- 当前视图 SVG/PNG 导出：视口/完整布局两种范围、文本安全转义、像素预算与失败回退；浏览器内完成，无服务端。
- 身份适配：分离 DSH 路由地址、真实绝对路径与 RDF Base；TriG/N-Quads 保留命名图身份；语句新增 `graph` 与 `location=null` 字段。
- 来源面板内的同 Session 共享（只共享解析快照，不发送源文本），最后一个面板关闭即清空；跨视图共享搜索与过滤/探索状态。
- 类层级键盘导航（方向键/Home/End/Enter/Space）、属性模式、循环组合并显示与成员面板；分层图循环组可显示成员并直接选中。
- “复制 SVG”回退；剪贴板不可用时提供只读 SVG 文本框，聚焦自动全选。状态文本在语言切换后立即重译。
- SVG/PNG 导出边界计入标签宽度，避免较长标签被裁剪；错误/警告色随宿主主题令牌变化。
- 解析、组合与布局优先使用 Blob Web Worker；不可用时退化至分片主线程布局，并按降级预算提示。

### 兼容性与验证

- 真实页面验收基线：DSH Desktop **0.2.2-rc.1（Windows x64）**；该次运行使用 Node.js 24.21.0。包的 Node.js 要求仍为 `>=22`，24.21.0 仅是验收环境版本。
- 可选 `dsh-better-sidebar` 集成在 **0.30.1** 上验收；它不是必需依赖。其它 DSH 版本、Web 部署、操作系统/架构未由本次证据覆盖。
- 验收 profile 未提供 `remote.workspaceFiles` 能力，因此没有启用该逐目录入口；多文件添加通过浏览器 File API 完成。
- 逐项验收记录及 SVG/PNG 样例见 [OpenSpec archive](openspec/changes/archive/2026-11-11-add-ontology-multiview-workspace/verification.md) 与其 `evidence/` 目录。

### 本次一并发布的既有增强

以下内容在 1.0.0 tag 之后实现，此次随 1.1.0 一并发布。

**综合图谱能力增强（OpenSpec `enhance-ontology-graph-core`）**

**解析与状态**

- 相对 IRI 的 Base 改由真实资源地址（原生预览 `resourceAddress` / better-sidebar 路径）推导，文档内 `@base`/`xml:base`/JSON-LD `@base` 仍优先；不再用显示文件名伪造身份，缺少可用地址时给 `base-unavailable` 诊断。
- 解析结果新增 `baseSource`、结构化截断（`stats.truncated`/`stats.truncation`）与按 code 聚合的 `diagnostics`；所有格式在达到三元组上限后停止解析。
- 语义损失改为分类诊断：TriG/N-Quads 命名图、JSON-LD 不支持关键词/远程上下文/反向关系、RDF/XML 具体化/parseType/多对象等。
- 修复两处 JSON-LD 语义错误：顶层 `@graph` 兄弟键不再丢失（`examples/courses.jsonld` 恢复 2 条三元组）、term 级 `@container:"@list"` 正确展开为 RDF 列表。
- 新增字面量长度、嵌套深度、诊断数量上限；警告洪泛、栈溢出与超长字面量不再拖垮页面。
- 两个入口统一读取中 / 空 / 过大 / 失败语义；better-sidebar 入口按宿主 5 MiB 阈值提示，原生预览按插件 12 MiB（UTF-8 字节）提示。

**性能与图谱**

- 解析/建模/布局优先在 Blob Web Worker 中执行，输入变化或卸载时终止并重建；Worker 不可用时降级为主线程分片布局，收紧预算并提示“性能降级模式”。
- 分层预算：解析三元组、图模型节点/字面量、SVG 绘制边分别配置并记录 `{total, kept, truncated, reason}`；超出时按确定性规则裁剪并在界面显示保留/上限与原因。
- `client.js` 内嵌 Worker 源，仍为单文件、零运行时依赖；体积由约 196KB 增至约 610KB。
- 新增 `npm run bench`：五类夹具（小/中/接近上限/高密度/异常）分阶段基准，支持改造前后对比。

**探索与交互**

- 新增按节点类型 / 关系类型 / 相对锚点的方向过滤；显示可见/总数，可清除恢复；过滤只影响显示，不改 RDF 数据。
- 新增 1–5 跳邻域探索（出/入/双向、可与谓词过滤组合），预算截断后可确定性地继续展开，可一键回到完整视图。
- 节点详情新增按谓词分组的出/入边列表（折叠、显示更多、端点定位），并标注未绘制关系与字面量/节点/边截断。
- 搜索改为结果列表（方向键选择、点击定位），范围始终是完整已保留模型。
- 工具栏改为紧凑主行 + 次级过滤/探索面板；窄屏使用抽屉；新增基础键盘可达性与 aria 语义；保留既有缩放/拖拽/重新布局/适配/高亮/标签开关/`0`/`f`/`+`/`-`/`Esc` 行为。
- 新增文案均提供中英词典，`npm run i18n` 覆盖全部 UI 模块。

**已知边界**

- 不实现完整 JSON-LD 1.1 / OWL 2、推理、编辑、SPARQL 或真实语句行列定位；1.1.0 新增了跨文件合并与可解析的命名图身份保留，不等同于完整 dataset 查询语义。
- Worker、过滤/探索/详情/搜索/主题/窄栏的真实页面证据及未重复场景，见两个 OpenSpec 归档的验收记录；不将部分路径验收推广到所有入口组合。

### 其他

- 收录进 [awesome-dsh-plugin](https://awesome-dsh-plugin.com)（分类 Docs & Rendering）：市场页 <https://awesome-dsh-plugin.com/p/a158070653-hash/dsh-ontology-viewer/>，条目 PR [#12890](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/12890) 已合并（2026-11-07）。
- README 顶部加市场徽章。

## 1.0.0

首个公开版本。

**扩展点**

- DSH 自带右侧栏文档预览：注册 `ctx.documentPreviews`（id `dsh-ontology-viewer/graph`，`loading: 'bytes-complete'`）与 `sidebar.right.tab.document` 正文，本体文件默认渲染为图谱，可下拉切回宿主纯文本。
- 可选集成 `dsh-better-sidebar`：`registerFileViewer` + `registerFileIcon`，文件树点开即图谱页签并显示图谱图标。

**解析**

- Turtle / N-Triples / N-Quads / N3 / TriG（Turtle 兼容子集）。
- RDF/XML（含 `owl:` 词汇、`rdf:parseType`、`rdf:li`、`xml:base` / `xml:lang`）。
- JSON-LD 常用展开子集（`@context`、`@graph`、`@value`、`@container`）。
- 内容嗅探 + 容错：坏文件保留已解析部分，错误/警告带行号。

**视图**

- 确定性力导向布局（mulberry32 + Fruchterman–Reingold，固定种子）。
- SVG 渲染、平移/缩放/拖拽、悬停高亮、搜索跳转、焦点模式、节点详情（IRI / 类型 / 字面量 / 度数）、重新布局与适配视图。
- 字面量不入图、平行边合并计数、列表管道不画边；上限 1500 节点 / 12 万三元组 / 12 MB 源文件。
- 仅使用宿主 `--dsw-alias-*` 主题令牌，明暗主题自适应；中/英文案走 DSH locale。

**工程**

- 零运行时依赖；`client.js` 由 `src/` 经 `build/build.mjs` 生成并提交。
- 46 个 Node 单元测试（解析器 / 图模型 / 示例端到端 / 打包接线）+ GitHub Actions CI。
- 5 个示例本体文件，`scripts/` 提供 i18n 覆盖检查与端到端统计。
