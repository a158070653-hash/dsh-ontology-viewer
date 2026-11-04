# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)；版本号对应 `package.json` 的 `version`。

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
