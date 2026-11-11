# Planning conflict — add-ontology-multiview-workspace

记录日期：2026-11-10。仅只读探查；未 Apply。此文件是冲突证据，不是已完成的 proposal/design/specs/tasks。

## 已确认状态

真实 Git 根为 `D:/workspace/dsh-ontology/dsh-ontology-viewer`。初始 Git 状态仅未跟踪 `.dsh/` 和 `examples/test.ttl`，未改动它们。`openspec context --json` 与 `openspec list --json` 确认本仓库 OpenSpec 根且无进行中的 Change。

前序变更已位于 `../archive/2026-11-10-enhance-ontology-graph-core/`；其 tasks 为 37/37，verification.md 170–176 行记录用户最终确认、六项 capability 同步及归档。不能将其中历史未执行项外推为本轮已经实测。本轮已读六份正式规格、项目开发和接入文档，并核对最新 parser/model/job/worker/main/build。

## 人工决策已解除规划阻断

2026-11-10 用户明确选择方案1：在当前综合 Change 内规划身份校准，不创建独立修复 Change、不回退前序实现、不修改历史产物。navigationAddress 仅访问/授权/导航，absolutePath 为宿主确认路径，rdfBase 统一转换；A优先、B后备已批准。下文“停止/未完成/校验失败”为当时探查历史，不代表当前状态。

恢复后已完成 proposal.md、design.md、7份spec delta及tasks.md（41项，全部待实施）。`openspec status` 返回四类artifact done、isPlanningComplete=true；当前Change strict通过，`openspec validate --all --strict` 为7 passed/0 failed。该结果仅证明规划有效，不代表实现或运行时验收完成。

## 原阻断：宿主路由地址与 RDF Base 混用

证据：

- `src/main.js:697–712` 原生预览直接把 `props.resourceAddress` 作为 source.address；`525–528` 继续传给计算任务。
- `src/main.js:755–770` better-sidebar 把文件 path 作为 source.address。
- `src/rdf-parse.js:155–179` 将绝对磁盘路径转换为 file URI，而将有 authority 的 custom scheme 原样作为 Base。
- 正式 `openspec/specs/rdf-parsing/spec.md:133–136` 要求同文件两个入口的 Base 和相对 IRI 一致；`dsh-integration/spec.md:42–45` 同样要求节点 IRI 一致。
- 当前安装的 `@deepseek-ai/dsh-api-workspace-files` README 75–83 行确认原生资源是 `dsh-resource://file/session/<sessionId>/<path>` 地址，携带授权 Session；stat/readBytes 返回真实 absolutePath。该包由 Config Inspect 定位，当前 package.json 版本 0.2.2-rc.1。

本轮实际执行当前解析器（未修改源码）：

```js
const text = '<Thing> <http://example.org/p> <Other> .'
parseOntology(text, {format:'turtle', resourceAddress:'dsh-resource://file/session/s/D:/data/sample.ttl'})
// s = dsh-resource://file/session/s/D:/data/Thing
parseOntology(text, {format:'turtle', resourceAddress:'D:/data/sample.ttl'})
// s = file:///D:/data/Thing
```

这是可重复的代码级复现，未声称已在真实 UI 打开该文件。文档声明了绝对 Base 的文件可能不受影响，但无声明且使用相对 IRI 的文件会被拆成不同实体；跨入口合并、来源去重和重载身份都依赖这个基础决策。

## 选项及推荐

1. **推荐：在本综合 Change 内明确规划修复。** 将 navigationAddress、Host absolutePath、RDF baseCandidate 三者分离。原生预览通过公开 metadata/Remote stat 获取 Host absolutePath，better-sidebar 使用其真实绝对 path；两者用同一映射规则形成 Base，文档内 Base 仍优先。路由地址只保留作授权、订阅和导航依据。无法取得可靠路径时明确诊断并隔离未解析的相对资源，不猜测文件身份。该方案需要明确修订既有“custom scheme 原样”要求对 DSH 路由的适用边界及兼容行为，不能静默改义。
2. 先在独立修复 Change 中校准双入口身份，再规划本 Change。能隔离回归，但会增加前序依赖。
3. 保留当前行为，仅对已解析为相同绝对 IRI 的资源合并。无法满足双入口一致性，存在同文件双重实体，不推荐。

按项目 AGENTS.md §六及本次请求第七阶段，停止受影响规划定稿，等待人工选择；未修改正式规格或历史变更。

## 已取得的宿主能力证据

- Client Slots Inspect：`sidebar.right.tab.document` active，包含 `dsh-ontology-viewer/graph`。owner props 有 resourceAddress/content/addResource/setResources；standard props 有 sessionId/useResource/useSessionAccess。
- Host Service Inspect `workspaceFiles`：已挂载 read/readBytes/stat/list/changes；官方 README §Use this package 确认 Client wire 签名为 `remote.workspaceFiles.readBytes(sessionId,path,{},signal)`、`stat(sessionId,path,signal)`、`list(sessionId,path,signal)`、`changes(sessionId,path,signal)`，不能把 Host 的 WorkspaceFileScope 直接用作 Client 参数。
- list 仅列当前目录直接子项，受 maxEntries 与 workspace 范围限制；返回 truncated；不是自动扫描 API。readBytes 返回 data/absolutePath/version/bytes/offset/eof；读取非事务性，不能承诺版本与内容原子快照。
- 方案 A 有正式 API 基础：插件内提供逐目录复选 UI，只读取用户选中文件；尚未执行 Client Remote 调用和权限/取消实测，前置任务须验证，否则使用方案 B。
- 方案 B：用户通过浏览器 input[type=file][multiple] / File API 主动提供本地文件；没有 Host 绝对路径时使用本地来源 ID，不能从 name 或 webkitRelativePath 伪造真实磁盘地址；外部文件修改需用户重新选择。尚未完成本环境文件选择/拖放实测。
- 官方 documentpreview README 35–60 行说明依赖 ResourceGroup、自动/手动刷新；128 行说明 `ctx.sidebarRight.openResource(address,{params:{line}})`。只证明文档契约；本轮未执行跳转，解析器没有逐语句位置，不设计伪行号跳转。
- better-sidebar `src/client/service.ts:303–359` 提供 ctx/scope/path/content/size/mtimeMs；scope.sessionId 来自 `lib/types/client/api.d.ts:212–218`。共享状态可采用插件自己拥有、按会话隔离的短期 registry，未确认专门的持久化工作区存储 API，不依赖它。
- Client Service directory 的 uiWorkspace.listDirectory/pickDirectory 是目录功能，不是现成多文件选择器。
- 本轮未调用业务读接口、文件选择、下载或 Worker 探针；不得将 Inspect、README 或其它插件先例写成真实运行时验收通过。

## 其它设计依据与边界

现有统一 triples 是 `{s,p,o,oKind,lang?,dt?}`，没有逐语句来源或 graph 字段；buildGraph 为有预算的 node-link 投影，不能从投影逆推出全部语句。worker 当前只缓存最后 graph，未保留可复用的多文件解析缓存。新增工作区须保留有总预算的逐来源解析结果并扩展现有模型，不可只拼接各文件截断后的图。

TriG/N-Quads 当前明确丢弃图身份并给 named-graph-ignored；保留图身份需要显式 MODIFIED 三项相关解析要求，而不是声称现有数据完整。类树多重引用与 SCC/环处理、分层布局、来源详情、SVG/PNG 导出及会话状态协调均尚未定稿。

现有主闭包和 Worker 由 build/build.mjs 固定顺序生成；不支持运行时相对 import，不新增服务端或运行时依赖。复用现有 terminate/rebuild 与 generation；主线程降级只分片布局，解析/建图仍同步。保留解析、建模、绘制预算及独立探索预算，不随文件数倍增。

## 独立只读调查补充

子代理完成 src/build/tests 调查，未修改文件、未运行测试或构建。其证据定位与主线程已读代码相符：

- `rdf-parse.js:279–308` 的 builder.add 输出 s/p/o/oKind、dt/lang 及 literalTruncated；`312–327` 的自动空白节点标签仅有单解析实例作用域，不提供跨文件隔离。
- `rdf-parse.js:846–855` 的 TriG named-graph-ignored 与 `1545–1582` 的 N-Quads 图名读取后丢弃，是增量保留命名图的具体改动点。对应现有回归测试在 `tests/parse.test.mjs:179–195`、`624–642`，将来须显式更新预期，不能继续以旧测试通过证明保留图名。
- `graph-model.js:706–897` 提供过滤及 displayOnly 绘制预算；`924` 起为带上限探索。工作区应复用这些投影，不另建一套语义图。
- `ontology-job.js:34–49` 当前普通预算为 120000 triples / 1500 nodes / 6000 edges，降级为 60000 / 800 / 3000；这些是现行参数而非永久验收常量。
- `worker-entry.js:91–165` 仅保留最后 graph 供 relayout；没有已存在的逐来源解析缓存。取消、缓存恢复和跨视图任务竞态需要新增测试。

自动续轮未收到人工身份方案选择，未据此改变停止定稿的决定。

## 产物与校验状态

仅 CLI scaffold `.openspec.yaml` 与本证据文件已创建。proposal/design/specs/tasks 尚未创建，任务数量未确定。

`openspec status --change add-ontology-multiview-workspace --json`：proposal ready（表示可创建，并非已完成），其它 artifacts blocked，isPlanningComplete=false。

`openspec validate add-ontology-multiview-workspace --strict`：exit 1，缺少 delta specs，符合当前尚未形成提案的状态；不设置 skip_specs 掩盖缺失。不满足进入 Apply 条件。
