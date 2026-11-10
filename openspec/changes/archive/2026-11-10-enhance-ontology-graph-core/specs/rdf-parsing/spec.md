## ADDED Requirements

### Requirement: Base IRI 来源与相对 IRI 身份

解析器 SHALL 区分显示名与真实资源地址：Base IRI 仅可从真实资源地址（原生预览的资源地址、better-sidebar 的绝对文件路径）或文档内声明（Turtle `@base`、RDF/XML `xml:base`、JSON-LD `@context.@base`）推导，MUST NOT 由显示文件名伪造 `file:///` 身份，也 MUST NOT 假设资源地址一定是标准文件 URI（映射规则见「资源地址映射策略」）；文档内声明 MUST 优先于资源地址映射，宿主两个入口 MUST 提供真实资源地址。地址中的 fragment 在作为 Base 前被剥离；当相对 IRI 需要 Base 而文档内声明与可用的资源地址映射都不存在时，Base 为空、相对 IRI 保持原文，并产生 `base-unavailable` 诊断。

#### Scenario: 不同目录的同名文件身份不冲突

- **WHEN** 两个位于不同目录、显示文件名相同且包含相对 IRI 的文件被解析
- **THEN** 两者的相对 IRI 解析为不同的绝对 IRI，资源身份互不冲突

#### Scenario: 显示名不参与身份构造

- **WHEN** 只提供显示文件名而没有真实资源地址
- **THEN** Base 为空，相对 IRI 保持原文并产生 `base-unavailable` 诊断，结果中不出现由文件名构造的 `file:///` 地址

#### Scenario: 文档内声明优先于资源地址

- **WHEN** 文件带有真实资源地址，同时内容中声明了 `@base`、`xml:base` 或 JSON-LD `@base`
- **THEN** 文档内声明的 Base 优先生效，其后的相对 IRI 以该声明解析

#### Scenario: 两个入口得到一致身份

- **WHEN** 同一文件分别通过原生预览与 better-sidebar 打开
- **THEN** 两个入口得到相同的 Base IRI 与相对 IRI 解析结果

### Requirement: 资源地址映射策略

解析器 SHALL 按确定规则把资源地址映射为 Base IRI，且 MUST NOT 假设资源地址一定是标准文件 URI：`http:` / `https:` / `file:` 等绝对 URI 原样使用（剥离 fragment）；其它自定义 scheme 仅在可解析为绝对分层 URI（含 scheme 与 authority 或绝对 path）时原样使用，否则不猜测、不拼接 `file:///`，按无可用地址处理并产生 `base-unavailable` 诊断；POSIX 绝对路径、Windows 盘符路径与 UNC 路径规范化为 `file:///` URL；缺失、相对路径、空串与显示名均不用于身份构造。

#### Scenario: 标准绝对 URI 原样作为 Base

- **WHEN** 资源地址是 `http:`、`https:` 或 `file:` 绝对 URI，且带有 fragment
- **THEN** 该地址原样作为 Base，fragment 被剥离，相对 IRI 以其解析

#### Scenario: 自定义 scheme 可解析时原样使用

- **WHEN** 资源地址使用自定义 scheme，且可解析为包含 scheme 与 authority 或绝对 path 的绝对分层 URI
- **THEN** 该地址原样作为 Base，不改写为 `file:///`

#### Scenario: 自定义 scheme 不可解析时退化为无可用地址

- **WHEN** 资源地址使用自定义 scheme，但无法可靠解析为绝对分层 URI
- **THEN** 不猜测、不拼接 `file:///`；需要 Base 时 Base 为空，并产生 `base-unavailable` 诊断

#### Scenario: 绝对文件路径规范化

- **WHEN** 资源地址是 POSIX 绝对路径、Windows 盘符路径或 UNC 路径
- **THEN** 规范化为 `file:///` URL 后作为 Base，路径中的特殊字符按既有编码规则处理

#### Scenario: 无效地址不参与身份构造

- **WHEN** 资源地址缺失、为相对路径或空串，或只提供显示名
- **THEN** 该值不用于身份构造（显示名只用于标题），需要 Base 时产生 `base-unavailable` 诊断

### Requirement: 结构化截断状态

解析结果 SHALL 以结构化字段暴露截断状态：`stats.truncated` 布尔值，以及 `stats.truncation`（未截断时为 `null`，截断时包含 `reason`、`limit`、`kept`）。达到三元组上限时，所有受支持格式 MUST 停止继续解析，而不是仅停止收集三元组；同时 MUST 产生 `triple-limit` 诊断。

#### Scenario: 达到上限时停止解析

- **WHEN** 输入的三元组数量超过 `maxTriples`
- **THEN** 解析在达到上限后停止，结果只包含上限内的三元组，`stats.truncated` 为 true，`stats.truncation` 的 `reason` 为 `triple-limit` 且 `limit`、`kept` 与实际一致，并存在 `triple-limit` 诊断

#### Scenario: 所有格式一致短路

- **WHEN** Turtle、N-Triples、N-Quads、RDF/XML 或 JSON-LD 输入超过三元组上限
- **THEN** 每种格式都在达到上限后停止继续处理，不出现"上限已到仍遍历全文"的格式差异

#### Scenario: 未截断不产生误报

- **WHEN** 输入未达到三元组上限
- **THEN** `stats.truncated` 为 false、`stats.truncation` 为 null，且不存在 `triple-limit` 诊断

### Requirement: 命名图语义损失诊断

TriG 图标签与 N-Quads 第四列图名 SHALL 被忽略且不产生命名图或数据集语义，同时 MUST 产生 `named-graph-ignored` 诊断，诊断按 code 聚合计数而不得逐条刷屏；图内的普通三元组 MUST 完整保留。解析结果 MUST NOT 声称支持数据集语义，也不保留图名。

#### Scenario: TriG 命名图产生诊断

- **WHEN** 输入为带图标签的 TriG
- **THEN** 图标签不产生命名图语义，内部三元组全部保留，并产生至少一条 `named-graph-ignored` 诊断

#### Scenario: N-Quads 图名产生诊断

- **WHEN** 输入行是四元组形式的 N-Quads
- **THEN** 只保留主语、谓语、宾语，第四列图名被忽略，并产生 `named-graph-ignored` 诊断

#### Scenario: 无命名图不误报

- **WHEN** 输入是不含图标签的普通 Turtle 或 N-Triples
- **THEN** 不产生 `named-graph-ignored` 诊断

### Requirement: JSON-LD 已知语义错误修复

JSON-LD 解析 SHALL 修正两处已确认的语义丢失：顶层对象同时含 `@graph` 与兄弟键时，兄弟键（`@id`、`@type` 与普通属性）MUST 与 `@graph` 内容一并处理，不得静默丢弃；term 定义中的 `@container: "@list"` MUST 按 RDF 列表展开（生成 `rdf:first` / `rdf:rest` 链，末尾为 `rdf:nil`），不得退化为多条并列三元组。两项修复 SHALL 由回归测试固化。

#### Scenario: 顶层 @graph 的兄弟键被保留

- **WHEN** 解析 `examples/courses.jsonld`
- **THEN** 顶层目录节点的 `@type` 与 `name` 都生成三元组，不再被静默丢弃

#### Scenario: term 级 @container 的 @list 按列表展开

- **WHEN** term 定义包含 `"@container": "@list"`，且该 term 的值为数组
- **THEN** 该值展开为完整的 RDF 列表（`rdf:first` / `rdf:rest` 链，末尾为 `rdf:nil`），而不是多条并列三元组

### Requirement: 解析资源上限与诊断聚合

解析 SHALL 施加可配置资源上限：单条字面量值长度上限（超限时截断并产生 `literal-limit` 诊断与截断标记）、嵌套深度上限（超限时停止该分支、保留已解析结果并产生 `nesting-limit` 诊断）、原始诊断消息条数上限（超限后继续计数并产生 `diagnostics-truncated` 诊断）。诊断 MUST 按 code 聚合，包含 `count` 与最多 3 条样本；任何上限生效都 MUST 有结构化字段或诊断，不得静默发生。

#### Scenario: 超长字面量被截断

- **WHEN** 单条字面量值超过长度上限
- **THEN** 该值按上限截断并带截断标记，产生 `literal-limit` 诊断，解析继续并返回部分结果

#### Scenario: 超深嵌套保留部分结果

- **WHEN** 输入嵌套深度超过上限
- **THEN** 解析停止该分支并返回已解析的部分结果，产生 `nesting-limit` 诊断，不发生未捕获异常或整份结果丢失

#### Scenario: 诊断洪泛被聚合

- **WHEN** 输入产生超过上限数量的原始诊断消息
- **THEN** 诊断按 code 聚合，原始消息只保留上限数量与每个 code 最多 3 条样本，并产生 `diagnostics-truncated` 诊断，视图不逐条渲染全部消息

## MODIFIED Requirements

### Requirement: Turtle 家族解析

Turtle 解析器 SHALL 支持 `@prefix` / `PREFIX`、`@base`、`;` 与 `,` 缩写、空白节点 `[ ]`、集合 `( )`、语言标签、`^^` 数据类型、数字与布尔简写以及转义序列；N3 复用同一解析器。TriG 的图标签不产生命名图语义但内部三元组保留，且图标签被忽略时 MUST 产生 `named-graph-ignored` 诊断（同一文档内可聚合计数）。

#### Scenario: 解析包含类层次与空白节点的 Turtle

- **WHEN** 解析 `examples/pizza.ttl`
- **THEN** 结果包含类、对象属性、数据属性与内联空白节点对应的三元组

#### Scenario: TriG 图标签被忽略

- **WHEN** 输入是带图标签的 TriG
- **THEN** 图标签与花括号不产生 named graph 语义，内部三元组仍进入结果，并产生 `named-graph-ignored` 诊断

### Requirement: N-Triples 与 N-Quads 解析

N-Triples 解析器 SHALL 按行解析一条语句，支持 `\u` 转义与空白节点；N-Quads 的第四列图名被丢弃，且图名被忽略时 MUST 产生 `named-graph-ignored` 诊断；坏行记录错误后继续解析；达到 `maxTriples` 上限时停止并输出结构化截断状态。

#### Scenario: N-Quads 图名不进入结果

- **WHEN** 输入行是四元组形式
- **THEN** 只保留主语、谓语、宾语，第四列图名被忽略且无图上下文，并产生 `named-graph-ignored` 诊断

#### Scenario: 坏行不会中止整个文件

- **WHEN** 文件中间存在语法错误的行
- **THEN** 解析器记录错误并继续处理后续行，已解析三元组保留

### Requirement: JSON-LD 子集解析

JSON-LD 解析器 SHALL 支持 `@context`（前缀 / term / `@vocab` / `@base`）、`@graph`、`@id`、`@type`、`@value` 加 `@language`，以及 `@container` 的 `@set` / `@list` / `@language` / `@index`；term 级 `@container: "@list"` MUST 按列表展开。远程 `@context` 不联网，跳过并产生 `jsonld-remote-context-skipped` 诊断。节点级 `@reverse` / `@included` / `@nest` 不展开并产生对应 code 诊断；节点级 `@index`、`@language` 会被静默跳过；节点级 `@value` / `@list` / `@set` 会丢弃该节点并产生对应 code 诊断；term 级 `@reverse` 按正向属性展开并产生对应 code 诊断。顶层对象同时含 `@graph` 与兄弟键时，兄弟键 MUST 与 `@graph` 内容一并处理。

#### Scenario: 展开上下文与图

- **WHEN** 解析 `examples/courses.jsonld`
- **THEN** 前缀、`@graph`、嵌套节点、带语言的值，以及顶层 `@graph` 的兄弟键都生成对应三元组

#### Scenario: 远程上下文不联网

- **WHEN** `@context` 是远程 URL
- **THEN** 解析器跳过该上下文并产生 `jsonld-remote-context-skipped` 诊断，不发起网络请求

#### Scenario: 不支持的关键词产生分类诊断

- **WHEN** 文档包含节点级 `@reverse`、`@included`、`@nest` 或不支持的 `@container`
- **THEN** 相应内容按约定跳过或不展开，并分别产生对应 code 的诊断，而不是只有无法分类的自由文本

### Requirement: 容错与统一输出

`parseOntology` SHALL 永不抛出异常，返回统一的 `{ format, prefixes, base, baseSource, triples, stats, diagnostics, warnings, errors }` 结果；`stats` SHALL 包含 `truncated` 与 `truncation`，`diagnostics` SHALL 按 code 聚合并与 `warnings` / `errors` 并存；`baseSource` MUST 标明 Base 来源（文档内声明、真实资源地址或无可用地址）。坏输入保留已解析三元组并记录错误或诊断；解析受 `maxTriples` 上限约束，达到上限后所有格式都必须停止；输入开头的 UTF-8 BOM 会被剥离；CRLF 作为空白被接受但不会被改写（多行字面量内部保留原始换行）；相同输入与相同选项重复解析得到相同结果，包括诊断与截断信息。

#### Scenario: 坏输入返回部分结果

- **WHEN** 输入包含无法解析的片段
- **THEN** 函数返回已解析的三元组，并在 `diagnostics` 与 `warnings` / `errors` 中记录问题，而不是抛出

#### Scenario: 重复解析结果稳定

- **WHEN** 对同一文本与相同选项连续调用两次解析
- **THEN** 两次返回的 JSON 完全一致，诊断计数与截断信息也一致

#### Scenario: Base 来源可判定

- **WHEN** 解析时提供真实资源地址，或只提供显示文件名
- **THEN** `baseSource` 分别为 `resource` 与 `none`，后者不产生伪造的文件地址
