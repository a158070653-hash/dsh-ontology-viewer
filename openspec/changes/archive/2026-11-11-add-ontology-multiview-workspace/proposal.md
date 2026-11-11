# Proposal

## Why

当前查看器已具备可靠预算、后台计算和过滤探索，但只能围绕单份文件的关系网络工作，无法在类层级、跨文件共享实体与关系来源之间连续探索。本 Change 将其扩展为本地本体探索工作区，并先校准双入口的资源身份，避免同一文件因宿主路由不同而生成不同 RDF 实体。

## What Changes

- 增加多文件清单、添加/移除/重载、单文件与联合视图、来源筛选；保留打开单个 RDF 文件立即查看的流程。
- 首选 A：通过正式 workspaceFiles 接口逐目录列举，由用户主动复选加载；后备 B：浏览器 File API 多选/文件拖放。A 的 Client 调用、授权、取消与读取须先实测，失败采用 B；不自动扫描项目。
- 分离 navigationAddress、absolutePath、rdfBase，DSH 会话路由不作为 Base；宿主确认的路径统一规范化；无可靠 Base 的相对资源限定于来源内部。
- **BREAKING（身份纠错）**：没有显式 Base 的原生 DSH 文件，其相对 IRI 将由旧的 dsh-resource 路由身份改为可靠绝对路径对应的 file URI；旧的临时选择/缓存失效，不迁移错误身份。
- 扩展现有三元组契约，隔离空白节点，按完整 IRI 合并实体，重复语句保留全部来源；增量保留 TriG/N-Quads 命名图，不引入 RDF Store。
- 三种视图共用数据：现有关系网络、支持多重继承与循环的类层级树、可按谓词和方向布局的分层语义图。
- 增加节点/关系来源详情、文件信息定位与可用时的宿主打开操作；位置缺失明确为空。
- 增加当前视图 SVG/PNG 导出，明确视口/已计算显示布局范围、文本安全和像素预算。
- 增量整合紧凑工具栏、可折叠来源面板、窄栏抽屉、中英文、主题与可访问性；保持过滤、搜索、选择、探索协调。

## Capabilities

### New Capabilities

- `ontology-workspace`: 文件集合生命周期、身份合并、来源索引与总资源预算。
- `ontology-multiview`: 三视图投影、层级关系与循环处理、状态保存恢复。
- `graph-export`: 显示场景的 SVG/PNG 导出、范围与安全限制。

### Modified Capabilities

- `rdf-parsing`: DSH 路由与 Base 分离、统一输出扩展、命名图保留。
- `dsh-integration`: 两入口身份适配、正式多文件读取及后备入口、生命周期。
- `graph-model`: 来源索引、重复语句/关系关联及来源过滤。
- `graph-view`: 多来源详情、工作区切换与工具栏行为。

## Impact

基于已完成并合入正式规格的 enhance-ontology-graph-core，复用 rdf-parse、graph-model、ontology-job、worker-entry 及已拆分的 view-style/controls/details/main。构建仍生成单个 Client 模块与内嵌 Worker，新增纯函数模块需加入固定清单；零新增运行时依赖、React + SVG、本地计算不变。

宿主依据：2026-11-10 Cordis Inspect 确认 workspaceFiles 的 stat/readBytes/list/changes 与原生预览 owner props；安装包 @deepseek-ai/dsh-api-workspace-files 0.2.2-rc.1 README 确认 Client wire 签名及绝对路径返回。完整证据及验证边界见 design.md；这些是接口证据，不是新增集成已验收。

范围外：后端服务、数据库、SPARQL/OWL 推理、本体编辑、联网 imports/context 加载、全盘或全工作区扫描、服务器持久化、插件重装、版本升级、发布，以及无关的整体 UI 重设计。仅创建本 Change 的规划，不改历史产物。