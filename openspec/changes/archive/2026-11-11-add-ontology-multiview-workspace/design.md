# Design

## Context

动机见 proposal.md。真实仓库为 D:/workspace/dsh-ontology/dsh-ontology-viewer；本轮开始时只有未跟踪 .dsh/、examples/test.ttl 和当前规划目录。enhance-ontology-graph-core 已于 2026-11-10 完成并同步六份正式规格，当前设计以其实际代码为基线。其 verification.md 最后记录用户最终验收确认；历史未验证条目不等同本轮测试结果。

当前契约与改动点：

| 证据 | 当前事实 | 本次扩展 |
|---|---|---|
| src/rdf-parse.js:279–370 | triples 为 s/p/o/oKind/dt/lang/literalTruncated；有结构化诊断和截断；无语句来源 | 增量 graph、location；来源由文件容器归属 |
| src/rdf-parse.js:155–198；main.js:688–776 | 原生把路由地址当 Base，sidebar 用 path | 三种标识分离、可靠路径转换 |
| rdf-parse.js:846–855、1545–1582 | TriG/NQ 忽略图名并诊断 | 保存图项，异常图上下文不得冒充 default |
| graph-model.js:213 起 | 有预算的 node-link 图；文字属性归属主语，列表管道不画；不是 RDF 全量存储 | 从保留的语句表构图并附来源索引 |
| ontology-job.js:34–49、837 起；worker-entry.js:91–165 | 单文件 compute/relayout、terminate/rebuild、gen；仅缓存最后图 | 文件解析缓存与工作集/视图投影任务 |
| graph-view-style/controls/details/view；main.js:414–611 | UI 已拆分，单面板状态，过滤→探索→绘制 | 控制器提升共享状态，保留网络图交互 |
| build/build.mjs:37–56、96–123 | 固定主模块/Worker清单，同源内嵌 Worker，不允许 import | 新纯函数加入两份清单，UI仅入主清单 |

用户已明确批准修复 planning-conflict.md 中的双入口身份冲突；不修改历史产物。主规格末尾保留部分 V1.0.0 历史偏差，其对应新要求和现行代码已变化；本次不按旧偏差重新设计。没有另一个进行中 Change 需要合并。

## Goals / Non-Goals

**Goals:** 单次解析支持多种只读语义投影；实体身份、来源、图名与显示引用分离；所有规模增长有上限且能解释降级。工作区管理属于当前页面内存数据，不成为会话日志或模型上下文。

**Non-Goals:** 完整 RDF dataset 查询引擎、OWL 推理、规范化空白节点同构、源文件编辑、自动联网 imports、外部存储、全文位置索引。保持现有格式子集，不借本次重写解析器。Canvas 仅用于 PNG 栅格化，不替换 SVG 交互渲染。

## Decisions

### 1. 三种标识与 RDF 身份

SourceRecord 使用下列概念，任何字符串都不能兼任所有角色：

```text
sourceId: 工作区内稳定且不由显示名生成的来源 ID
origin: host | browser
navigationAddress: 原始 DSH 路由或 null（保留授权 Session）
absolutePath: 宿主确认的执行环境绝对文件路径或 null
rdfBase: 可靠初始基准 URI 或空串
baseSource: document | resource | none（解析结果保持兼容）
displayName, format, revision, status, byteSize, diagnostics, truncation
```

原生先从 `useResource` 已有元数据或 `remote.workspaceFiles.stat/readBytes` 获取 absolutePath；原始完整路由只用于宿主读取、依赖订阅和导航。不能通过删去 `session/<id>` 前缀推测磁盘路径。解析 DSH 路由为授权 Session 和请求 path 只能依据正式地址语法，path 仍需 Host 确认。better-sidebar 使用实际提供且通过绝对路径验证的 path；相对 path 必须经相应 Session 的 stat 确认。文件读取授权始终属于该来源的 Session，不因共享缓存改借当前 Session。

两入口共用纯函数路径→file URI：先区分原始路径与 URI，再处理路径段；Windows 盘符统一大写、反斜杠转斜杠，UNC 保留 authority/share，POSIX 保留大小写；以路径段 UTF-8 percent encoding 编码空格、#、?、%、Unicode，原始路径中的 `%20` 是字面字符串，必须输出 `%2520`。对合法 file URI 解析/序列化一次，不先对完整 URI decodeURIComponent 后再编码。不得全局把路径转小写，不做未知文件系统的大小写、符号链接或 inode 等价推断；依赖 Host 返回的规范路径。非文件资源的合法绝对层次 URI 仍可作可靠基准；绝对非层次 IRI 可作为实体，但不能假定可解析相对引用。

DSH 会话文件路由作为默认资源 Base 被明确排除；此规则不改写 RDF 文本中合法的完整 IRI，也不把所有 custom scheme 禁用。明确声明的绝对 Base 按格式生效；相对 @base/xml:base/@context.@base 必须对可靠的当前父 Base 解析。RDF/XML 嵌套 base 随作用域出栈恢复；Turtle顺序声明与JSON-LD上下文作用域按各自语义处理。没有可靠上层 Base 时记录诊断，不把文档末尾 base 值追溯套到之前的语句。

实体 key：绝对 RDF IRI 使用解析后完整字符串；规范化限于语法展开、相对解析和资源路径转换，不擅自合并大小写不同路径、尾斜杠、百分号别名或 owl:sameAs。空白节点为 `(sourceId, blankLabel)`；相同来源各命名图共享文档级 blank 范围。无法解析的相对项为 `(sourceId, rawRelative)` 的 tagged 内部 key，`semanticIdentity=false`，原文可展示，但不可宣称跨文件等价。tagged key 与用户 IRI 使用不同域、长度编码或结构化元组，不能用易碰撞的字符串拼接。

Host来源在同一工作区内以宿主执行环境作用域及规范 absolutePath 去重；同路径重新添加提示已加载并提供重载，不累加来源。sourceId 是独立稳定键，Session只限定授权作用域，不参与RDF IRI构造。不同执行环境下同字符串路径不自动证明物理文件相同；跨环境共享工作区不在本次范围。

浏览器 File 不提供可信绝对路径；name、webkitRelativePath、lastModified 只作展示/变化提示。每次添加分配来源 ID；同名同大小不自动去重。重载必须选择要替换的来源并由用户重选文件，保留 sourceId、增加 revision；无新文件时重读旧 File 只能称“重新解析快照”。有有效文档绝对 Base 的浏览器文件照常跨文件关联。

替代方案：保留路由 Base 会错误分裂实体；猜测路由中的磁盘路径绕过 Host 事实；两者均不采用。此身份修正经用户批准，是当前 Change 的兼容性变更。

### 2. 单文件与多文件共用数据契约

沿用 parser 的 triples 数组，不引入 RDF Store。追加字段：

```text
ParsedStatement = {s,p,o,oKind,dt?,lang?,literalTruncated?,
                   graph:{kind:'default'|'iri'|'blank'|'unknown',value?}, location:null}
ParsedSource = {sourceId,revision, parsed:{format,prefixes,base,baseSource,
                triples,stats,diagnostics,warnings,errors}}
Occurrence = {sourceId, revision, ordinal, graph, location:null}
StatementRecord = {statementId, terms, graph, occurrences[], count}
Graph = 既有 nodes/edges/stats/truncation/source + sources表 + statement索引引用
```

sourceId 放在解析容器与 occurrence 中，避免每个 parser 分支重复传文件名；build/merge 适配器将单文件包装为一元素集合。保留旧 buildGraph(parsed,options) 调用形式，缺少新增字段的旧输入当作旧单文档数据，图上下文标为 unknown 而非声称完整来源。解析器新产生的普通 triple 明确 default。

语句 key 包含 s/p/o 的 term kind、完整值、literal datatype/language、graph kind/value。语言标签大小写按 RDF 语义统一；不做字面量值空间推理（`01`^^integer 与 `1`^^integer 不合并）。不同图的相同 SPO 是不同 statement；显示关系仍可按 SPO 聚合，保留所有 statementIds/图/来源。重复出现计入 count，occurrences 保留全部已接纳出现记录；来源列表按 sourceId 去重。空白图名也按文档来源隔离；unknown 图加来源/出现范围避免错误等价。截断字面量只能作为部分显示数据：不得仅凭截断前缀合并两个值，使用 occurrence-scoped identity 并提示不完整。

节点 provenance 包含 subject/object/predicate/graph 等出现角色，并区分“该文件描述了实体”与“仅引用实体”；不会把所有来源都叫定义。谓词实体即使未画为节点也可从语句详情查来源。标签选择沿用谓词优先级，同级以来源加入顺序、语句顺序稳定决胜；详情保留有来源的备选标签。各来源 prefixes 独立，前缀冲突不改语义；显示优先 label/local，歧义时显示完整 IRI。

保留五层：L0 有上限的原始解析语句/合并索引，L1 有预算的模型，L2 来源与现有过滤投影，L3 现有探索，L4 绘制。文件工作集（单文件或联合选定集）从 L0 选择来源贡献后重建 L1；来源过滤从 L1 的边/属性贡献投影后进入现有 filter/explore/draw。搜索/完整详情基于当前工作集 L1，标注来源过滤下隐藏的项，不从 L4 反推。来源筛选后无贡献的锚点仅可显示“已隐藏”上下文，不带回其它文件关系、不作探索跳板。L0保留不等于输入完整，解析截断状态贯穿所有层。

移除按 sourceId 删除其 occurrences，零支持语句/实体清理，有其它来源支持的继续存在；重载采用“读取→解析候选→预算准入→原子替换”的单来源事务。坏输入可发布有明确 partial 状态的解析结果；读取失败或任务失败保留上次成功版本并显式 stale/error，用户可移除，不伪装最新。文件变化废弃旧游标，依据新 L1 清理失效选择/探索根，计数、索引、标签同一次 revision 提交。

替代方案：直接合并已裁剪图会丢掉字面量/列表与来源，不能选用；每视图独立解析会浪费 CPU 并产生身份漂移，也不采用。

### 3. 命名图增量保留

TriG 在现有 tokenizer/statement 分支维护 graph context；`GRAPH <iri> {}`、IRI/blank 图标签、默认 `{}` 块分别赋 graph，退出块恢复；非法嵌套/坏标签产生分类诊断，不静默默认。N-Quads 在已读取第四项处保留 IRI 或 blank term；N-Triples为default。Builder.add 增量接收 graph，不改变现有其它字段和上限短路。

JSON-LD 当前常用子集的无名 @graph 继续展开；带 @id 的命名 @graph 若该结构尚未可靠支持，保留语句时标 graph=unknown 并给 `named-graph-unavailable`，详情明确“图身份未保留”。本次不要求补全 JSON-LD dataset 语义。TriG/NQ正常支持路径不再发 ignored，无法识别时 unknown + 诊断。RDF/XML普通语句为default。所有格式 location 保持null；错误消息的行号不等于成功语句位置。

当前 CLI 校验要求 MODIFIED 保留原 Scenario 标题匹配键，因此 RDF delta 中含“被忽略 / 不进入结果 / 产生诊断”的历史标题仍保留；其 WHEN/THEN 已明确改为保留可解析图身份，实现以新正文为准，绝不同时执行旧丢弃行为。

工作量为 builder、TriG上下文、NQ第四项、merge/model/worker传递、测试与UI展示的定向修改，不是解析器重写。不实现 SPARQL、图推理或外部 imports。owl:imports 只显示原语句/元信息，始终不下载。

### 4. 宿主接入证据、A/B 路线与能力门

本轮只读 Inspect（2026-11-10）及安装包文档证据如下。包根由 Config.listConfigs(entry) 返回，不从 profile 猜测；文档路径相对各包根。

| 能力 | 精确证据 | 使用/限制 |
|---|---|---|
| 原生当前文件 | Slots.listSubTree(sidebar.right.tab.document) owner 有 resourceAddress/content/addResource/setResources；standard有sessionId/useResource | 原生注册仍 bytes-complete，打开一文件即创建单文件临时工作区 |
| 目录/读取/元数据 | Host Service workspaceFiles；@deepseek-ai/dsh-api-workspace-files 0.2.2-rc.1 README:28–58 | Client `remote.workspaceFiles.list(sessionId,path,signal)`、`stat(sessionId,path,signal)`、`readBytes(sessionId,path,{},signal)` |
| 变化订阅 | 同包 README:56–83，changes(sessionId,path,signal)，ready/change帧 | watch unsupported/断线时手动重载，不轮询；取消关闭订阅 |
| 文件地址语法 | 同包 README:75–83 | Session路由与Host absolutePath分开，绝不借用当前Session授权 |
| 导航 | @deepseek-ai/dsh-client-ui-sidebar-documentpreview README:128 | `ctx.sidebarRight.openResource(address,{params:{line}})`有文档；本次无行号，不传伪位置；调用仍须真机验证 |
| better-sidebar | 当前安装源码 src/client/service.ts:303–359，api.d.ts:212–218 | ctx/scope.sessionId/path/content/size；可选inject不变；不依赖其内部store |
| 目录选择 | Client Service uiWorkspace.pickDirectory/listDirectory | 不是多文件选择器，不作为自动扫描入口 |
| 多文件选择/拖放 | Web标准 input.multiple、input.files、File.arrayBuffer、DataTransfer.files | 插件组件内提供；无上传、不读目录、不接受拖入URL发请求；环境实际行为待测 |
| 下载 | Web标准 Blob/URL.createObjectURL、a.download、Canvas.toBlob | 没有已确认的DSH任意导出服务；前置浏览器验收，禁止声称下载完成可检测 |
| 模块/Worker | build/build.mjs清单及官方 cordis-plugin-development UI reference | 单 Client、只require react，Blob classic Worker，构建同源；新页面仍需CSP/通信验证 |

方案 A 是可选适配器：在已知来源 Session 下从 `list(sessionId,'.',signal)` 开始逐目录展开，用户复选具体文件才读取；显示 truncated，不假称目录完整，限制在途请求。服务存在/访问许可先检查，再执行真实 read/stat 测试；不按 Host 方法签名传 WorkspaceFileScope（wire 参数是 Session ID）。取得 bytes 的 offset=0/eof=true 才发布；stat后读取再核对版本，发现变化最多重试一次，仍变则提示“读取期间变化”，不承诺原子快照。

原生 metadata 自动刷新时更新对应来源；工作区额外来源由受控 changes 订阅标记 stale，用户重载（避免编辑风暴自动反复解析）。同来源重复事件按version合并；依赖 addResource/setResources只用于原生owner支持范围，不把“订阅”误认为“已读取”。原生内容重开/变化通过props进入，内容版本缺失时比较实际字节/文本避免每次渲染重算。

A 的真实 Client Remote、授权拒绝、取消、完整读取和路径返回必须先验证。服务缺失/环境不可调用时禁用A并说明，采用已批准B；权限拒绝不改用隐藏接口或替用户重读文件，B需要用户重新主动选取。B取消无副作用；File读取不可中止的Promise以revision淘汰结果并释放引用。两种入口都不联网。没有确认持久化服务，因此用插件私有内存。

共享状态按插件实例→真实 sessionId→workspaceId隔离，连接重置清除授权相关缓存；没有sessionId的入口只能面板独立，显式提示不可跨预览共享。正常单文件打开不自动把其它预览并入；用户“加入本体工作区”后同一session的面板可选择该workspaceId。文件集合共享，视图偏好按面板保存以免两个面板互相跳转；加入已有工作区是显式操作。关闭最后面板即销毁该workspace缓存/Worker/订阅，告知“关闭后清空”，不长期持有隐藏文件。卸载通过ctx.effect总清理。

### 5. 缓存、Worker 与资源预算

由单个 workspace controller 调度，最多一个计算Worker；复用runner取消和generation，用 `{workspaceRevision,sourceRevision,viewRevision,requestId}`拒绝过期结果。新增 parse-source、compose、project-layout 协议操作；旧单文件compute由适配器委托，relayout仍不解析。主线程保存唯一可恢复的有界 ParsedSource快照，Worker只保留当前运算/布局所需缓存，禁止为三视图各克隆L0。解析Worker返回有界结果后释放文本副本，主线程合并/布局任务把必要快照发给Worker；terminate后可由已有ParsedSource重建，不重新解析未变文件。传输峰值包括两侧快照和旧/新事务版本，必须计入基准。默认串行读取/解析，文件之间让出事件循环；主线程降级解析/建图仍同步且预算更低，不声称全程可中断。

维持现行解析/模型/绘制三层与独立探索预算，并加工作区准入上限。初始候选护栏（须基准确认，可下调，不作为永久规格）：最多16文件，总接纳源字节24 MiB，单文件仍12 MiB；sidebar自动传入仍遵守其5 MiB；全工作区保留occurrences总量120000，降级60000；工作集模型1500节点/6000边，降级800/3000；每节点60字面量和既有字面量长度/深度限制。视图元素预算复用既有值，树额外设置展示引用上限，不随多重继承路径增长无界展开。

准入按明确加入顺序分配剩余解析额度，耗尽即拒绝新增来源或以结构化partial结果接纳，不静默驱逐已有来源；剩余不足时显示实际额度。删除释放额度，但之前被截断的文件不自动声称完整，用户重载才重新分配。来源记录保留总字节元数据，成功解析后释放宿主源文本与bytes副本；浏览器File仅保留重读句柄（其底层内存由浏览器管理）。原始文本长度/语句数不是堆内存实测；监测可用的浏览器内存指标与传输字节，不能把候选上限称为硬堆上限。

合并期 O(T) 期望哈希时间、O(T+N+E+P)空间，P为来源出现记录（受T上限）；确定性排序 O(T log T)；每文件更新可以重建合并索引 O(T)，不用复杂增量引用计数事务引擎。保存最多每视图一个布局缓存，以revision+workset+filter+focus+orientation+size为key；切换命中只读坐标，未命中只投影/布局，绝不解析。

### 6. 类层级树与分层图

类候选由显式 owl:Class/rdfs:Class、subClassOf端点及必要rdf:type分类确定；rdf:type不是subClassOf，实例在可选“实例”分组呈现，不伪造继承。类树基于父→子的显示方向（原RDF仍子→父），只输出真实subClassOf来源。根是无已保留父的类；孤立类单列；被模型预算剪断父关系时标“保留范围内根”。subPropertyOf使用同一层级构建器的属性模式，显式关系存在即可切换，不做推理。

先以非递归SCC检测环 O(N+E)，所有无根环进入“循环关系”根分组；展开沿当前路径检测重复，返回环引用标志，不继续递归。多重继承允许 `{refId,entityId,parentRefId,relationId}` 多个展示引用，详情/搜索选择始终entityId；只按展开路径惰性生成展示引用，应用深度与引用总数上限，提供继续展开/限制提示，避免指数级路径物化。快速搜索在L1候选中匹配，定位仅展开预算内的一条确定路径，其余引用标数量；隐藏于过滤时显式提示，不偷偷清除过滤。

分层图使用用户所选谓词（默认subClassOf，可含subPropertyOf、rdf:type和任意已保留资源边谓词），保留原方向；继承显示可采用父在上/左的方向变换但图例说明箭头语义，SCC分析使用真实边。SCC收缩后DAG拓扑分层，层内按稳定id初排，固定次数重心扫降低交叉；上→下/左→右坐标转置。SCC外观为组节点，内部成员可在详情展开并定位；内部真实边仍在L1，不声称原图是DAG。自环、跨层长边与多谓词平行边明确显示，关系标签按预算确定性抽样，剩余在详情。焦点使用现有1–5跳探索输出作为布局输入，可扩展祖先/后代方向，隐藏节点不作跳板。总体 O(N+E) SCC/拓扑加有限排序，不采用无界最优层次布局。

网络图保留力导向、缩放/平移/拖拽/搜索/过滤/多跳/详情全部现行行为。树/分层图共享实体及语句来源；其布局、展示引用和SCC组仅是投影，不向底层写入合成实体或关系。替代方案为引入外部布局库或把图强行断边变树；前者违反默认零依赖，后者误导语义，均不选。

### 7. UI 状态与来源追溯

主行：紧凑视图选择（网络/类树/分层）、搜索、状态；来源按钮与导出按钮分别收纳来源面板与导出选项（方案 A，2026-11-11 决策：不实现统一“更多”菜单，布局选项保留在各视图工具条）；已有缩放/适配可放画布浮动控件，操作仍可达。来源面板可折叠：文件名+真实来源/本地ID、格式、状态、三元组数、错误/警告数、截断；提供添加/移除/重载、单文件/联合工作集和来源筛选。小于640px使用次级抽屉，来源与详情避免同时遮满画布，焦点关闭后回到触发器。不堆叠顶端多行按钮。

| 状态 | 切视图 | 改来源过滤 | 单/联合工作集变化或文件更新 |
|---|---|---|---|
| 搜索文本/选择entityId | 共享，目标不在该视图则提示 | 保留，标隐藏 | 有效ID保留；不存在清空并提示 |
| 类型/谓词/方向过滤 | 共享；与视图谓词取交集 | 更新来源条件 | 保留仍有效条件，失效值显示不可用，不悄然扩大结果 |
| 探索根/深度/方向 | 共享；根非类时树说明不适用 | 废弃cursor重算 | 根仍在L1则重算，否则清空 |
| 缩放/平移 | 各视图单独保存恢复 | 保留相机，显式适配 | 布局失效时首次fit，禁止因打开详情重排 |
| 树展开引用 | 保留按路径key的展开集合 | 隐藏分支不删实体 | 清理失效path，按新revision惰性重建 |
| 布局坐标/拖拽 | 各视图独立缓存 | key变化重投影 | revision失效，丢弃旧结果 |

三视图选择统一 entityId；SCC group和tree ref不能覆盖实体身份。全新独立单文件工作区维持既有“源文档切换重置过滤”，同一工作区切单/联合不重置全部状态。搜索始终当前工作集L1，不受L4或来源显示过滤缩小。

节点详情增加出现角色与完整来源列表；关系详情可从画布关系或既有关系列表进入，显示s/p/o、全部来源、各自命名图与默认/unknown状态，出现次数、位置未提供。来源列表分页只限制DOM，不截断已接纳来源集合；若L0部分数据必须声明“已保留数据的来源”。点击来源默认展开文件信息，不变更过滤；另提供复制标识。可选“在DSH打开”仅对Host来源、有效navigationAddress和已验证接口显示；不生成浏览器File的路径或行号，也不将本体IRI推断为代码仓库源码位置。

### 8. SVG/PNG 导出

选用显式 scene snapshot，而非直接序列化混有UI的宿主DOM。三视图渲染与导出共用 `{viewType,revision,visibleNodes,visibleEdges,labels,positions,groups,clip,theme}`；树使用当前展开引用，分层图使用当前SCC折叠状态。只包含L4已显示集合，不重新解析或临时增加隐藏边。

导出对话框明确两种范围：默认“当前视口”（含当前pan/zoom裁剪），可选“当前显示集合的完整布局”（同一L4集合边界，不含折叠/过滤/预算隐藏内容）。禁止叫“全部本体”。快照在计算完成且revision一致时才生成；保留拖拽后位置、当前关系标签与实际主题。导出页眉/metadata可附视图与截断说明但不嵌入完整文件路径以免意外泄露。

SVG只创建白名单 svg/g/path/rect/circle/line/polyline/text/tspan/clipPath/defs 等静态元素；RDF文本通过textContent或统一XML转义，过滤XML非法控制字符；元素id由内部序号生成。禁止script、foreignObject、image、a、事件属性、外部href/xlink、CSS url/@import、DTD与实体定义。主题从允许的宿主计算颜色取值并写入具体安全颜色，字体只用本地系统栈，不加载外部字体。XMLLiteral同样按纯文本。几何和颜色校验有限数字/合法颜色，不能将RDF字符串放进样式或路径命令。

PNG先用同一安全SVG在Image静态上下文栅格化到canvas，再toBlob；默认1x，可选2x，先计算宽×高×倍率平方，候选上限16M像素/8192单边，超限自动建议降倍率或视口范围，不先分配大canvas。显式包含背景以适配主题；toBlob返回null、Image失败、canvas安全异常或内存不足给清晰错误，保留SVG导出入口。

下载在用户点击时通过组件内a.download与Blob URL发起；不写服务器、不新开任意外部地址。浏览器无法证明文件已落盘，文案为“已发起下载”。显式异常给错误；对静默阻止提供持续可见的重试链接以及组件内静态图预览/复制SVG文本（复制失败可选文本手动复制）；PNG可提示使用SVG回退。旧URL、Image、canvas、监听器在取消/卸载/下一次导出时释放，链接有效期内不能提前revoke。下载和复制能力门须在真实DSH环境验证，不把Node测试或其它插件成功当作通过。

## Risks / Trade-offs

- [新身份会改变原生相对IRI] → 明确兼容性纠错，清除旧临时缓存；无持久迁移；文档绝对Base语义不变。
- [Host接口有文档但权限、scope和浏览器行为未实测] → 前置真机门，失败采用已批准B或复制来源标识；不修改宿主补能力。
- [Host读取非事务，watch可能不可用] → 有限版本复核、stale提示、手动重载，不承诺实时完整快照。
- [语句与来源索引增加内存、Worker结构化克隆有峰值] → 总occurrence额度、串行处理、最多一个Worker、缓存可恢复但不按视图复制；记录峰值而非仅计算耗时。
- [多重继承路径爆炸/大SCC] → 惰性引用与元素上限，循环组详情分页，保持实体计数与展示引用计数分开。
- [过滤来源改变某节点类型描述可见性] → L1分类作为当前工作集事实，L2只投影贡献并提示分类可能来自被隐藏来源；切单文件工作集则从其L0重建分类。
- [部分解析与图预算影响完整性] → 明确“已保留范围”，命名图unknown不得画成default，所有来源完整性声明受解析预算约束。

## Migration Plan

实施先通过宿主/浏览器能力门和身份契约测试，再扩展解析/合并/任务协议，随后加入两种新视图与来源详情，最后集成导出。每一步保留单文件适配器和旧网络图路径。新模块加入确定性主/Worker构建清单，继续只require React；文案加入ZH/EN并让i18n扫描覆盖新模块；颜色走主题令牌。

若新投影失败，保留当前成功场景并提示，可切回网络图；Worker失败走既有更严预算降级。合并事务失败不覆盖上一成功revision。没有持久数据迁移或服务器升级；任何部署/发布均不属于本规划执行。

## Open Questions

无待决的范围或身份路线。可在实施前置测量内确定：候选文件数/总字节/树引用与PNG像素上限的最终值、真实环境支持A或B的能力矩阵、跨视图布局p50/p95与峰值内存。它们必须在既定有界和可诊断语义内调整；若测量要求新增依赖、修改宿主或削减核心多文件能力，按冲突规则上报。