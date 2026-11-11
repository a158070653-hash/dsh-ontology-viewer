# Spec Delta

## MODIFIED Requirements

### Requirement: Turtle 家族解析

Turtle 解析器 SHALL 支持 `@prefix` / `PREFIX`、`@base`、`;` 与 `,` 缩写、空白节点 `[ ]`、集合 `( )`、语言标签、`^^` 数据类型、数字与布尔简写以及转义序列；N3 复用同一解析器。TriG SHALL 保留 IRI/空白节点图标签至语句 graph 字段；默认块为 default。坏图上下文须诊断，不得静默当作默认图。

#### Scenario: 解析包含类层次与空白节点的 Turtle

- **WHEN** 解析 `examples/pizza.ttl`
- **THEN** 结果包含类、对象属性、数据属性与内联空白节点对应的三元组

#### Scenario: TriG 图标签被忽略

- **WHEN** 输入是带图标签的 TriG
- **THEN** 图标签进入内部语句的 graph 字段，普通三元组保留，成功保留图名时不产生 named-graph-ignored

### Requirement: N-Triples 与 N-Quads 解析

N-Triples 解析器 SHALL 按行解析一条语句，支持 `\u` 转义与空白节点；N-Quads 的第四列 IRI 或空白图名 SHALL 保留至语句 graph 字段，无第四项时为 default；坏行记录错误后继续解析；达到 `maxTriples` 上限时停止并输出结构化截断状态。

#### Scenario: N-Quads 图名不进入结果

- **WHEN** 输入行是四元组形式
- **THEN** 保留主语、谓语、宾语以及第四列图身份，成功解析时不产生 named-graph-ignored

#### Scenario: 坏行不会中止整个文件

- **WHEN** 文件中间存在语法错误的行
- **THEN** 解析器记录错误并继续处理后续行，已解析三元组保留

### Requirement: 容错与统一输出

`parseOntology` SHALL 永不抛出异常，返回统一的 `{ format, prefixes, base, baseSource, triples, stats, diagnostics, warnings, errors }` 结果；语句 SHALL 增量输出 graph 与 location=null，不删除原字段；`stats` SHALL 包含 `truncated` 与 `truncation`，`diagnostics` SHALL 按 code 聚合并与 `warnings` / `errors` 并存；`baseSource` MUST 标明 Base 来源（文档内声明、真实资源地址或无可用地址）。坏输入保留已解析三元组并记录错误或诊断；解析受 `maxTriples` 上限约束，达到上限后所有格式都必须停止；输入开头的 UTF-8 BOM 会被剥离；CRLF 作为空白被接受但不会被改写（多行字面量内部保留原始换行）；相同输入与相同选项重复解析得到相同结果，包括诊断与截断信息。

#### Scenario: 坏输入返回部分结果

- **WHEN** 输入包含无法解析的片段
- **THEN** 函数返回已解析的三元组，并在 `diagnostics` 与 `warnings` / `errors` 中记录问题，而不是抛出

#### Scenario: 重复解析结果稳定

- **WHEN** 对同一文本与相同选项连续调用两次解析
- **THEN** 两次返回的 JSON 完全一致，诊断计数与截断信息也一致

#### Scenario: Base 来源可判定

- **WHEN** 解析时提供真实资源地址，或只提供显示文件名
- **THEN** `baseSource` 分别为 `resource` 与 `none`，后者不产生伪造的文件地址

#### Scenario: 增量图与位置字段

- **WHEN** 解析器返回语句
- **THEN** 原有 s/p/o/oKind/dt/lang/literalTruncated 字段兼容；每条新语句包含 graph（default/iri/blank/unknown）和 location=null；没有伪造成功语句的位置

### Requirement: Base IRI 来源与相对 IRI 身份

解析器 SHALL 分离导航地址、宿主确认的绝对路径与 RDF Base。DSH 会话文件路由只用于访问、授权和导航，MUST NOT 作为默认 RDF Base；两入口 SHALL 将可靠路径交给同一映射规则。其它可靠合法资源 URI 仍可作 Base。文档声明按格式作用域优先，相对 Base 必须基于可靠上层解析；作为资源 Base 的地址去掉 fragment。缺少 Base 时相对 IRI 保持原文并产生 base-unavailable，合并层 MUST 将其限定于来源内部；显示名、Session ID 与未经验证的路由内容不得生成磁盘身份。

#### Scenario: 不同目录的同名文件身份不冲突

- **WHEN** 两个位于不同目录、显示文件名相同且包含相对 IRI 的文件被解析
- **THEN** 两者的相对 IRI 解析为不同的绝对 IRI，资源身份互不冲突

#### Scenario: 显示名不参与身份构造

- **WHEN** 只提供显示文件名而没有真实资源地址
- **THEN** Base 为空，相对 IRI 保持原文并产生 `base-unavailable` 诊断，结果中不出现由文件名构造的 `file:///` 地址

#### Scenario: 文档内声明优先于资源地址

- **WHEN** 文件带有可靠资源 Base，同时内容中声明了 `@base`、`xml:base` 或 JSON-LD `@base`
- **THEN** 文档声明按格式作用域生效，绝对声明直接使用，相对声明基于可靠上层 Base 解析，不追溯改写之前语句

#### Scenario: 两个入口得到一致身份

- **WHEN** 同一文件分别通过原生预览与 better-sidebar 打开
- **THEN** 两个入口得到相同的 Base IRI 与相对 IRI 解析结果

#### Scenario: DSH 路由不能成为默认 Base

- **WHEN** 只有 dsh-resource://file/session/... 路由而无法取得真实路径
- **THEN** 不以路由或 Session ID 构造 RDF 身份，来源内相对资源隔离并提示

#### Scenario: 没有上层的相对 Base

- **WHEN** 文档声明相对 Base 且缺少可靠资源 Base
- **THEN** 不能据此生成绝对 RDF IRI，返回来源不可确认诊断

#### Scenario: 浏览器来源声明绝对 Base

- **WHEN** 浏览器 File 没有真实路径但文档给出有效绝对 Base
- **THEN** 按该 Base 解析，允许与同一完整 IRI 跨文件合并

### Requirement: 资源地址映射策略

资源 Base 映射 SHALL 排除 DSH 会话文件 navigationAddress，同时保留其它合法 http/https/file 及可解析绝对层次 custom URI 的语义（移除资源 Base 的 fragment）。宿主确认的 POSIX、Windows 盘符与 UNC 路径 SHALL 由统一转换生成 file URI：Windows 盘符与分隔符规范化，保留路径大小写和 UNC authority，按路径段编码特殊字符与 Unicode，区分原始路径与已编码 URI，避免重复解码。缺失、相对路径、显示名不生成 Base；需要解析时诊断。

#### Scenario: 标准绝对 URI 原样作为 Base

- **WHEN** 资源地址是 `http:`、`https:` 或 `file:` 绝对 URI，且带有 fragment
- **THEN** 该地址原样作为 Base，fragment 被剥离，相对 IRI 以其解析

#### Scenario: 自定义 scheme 可解析时原样使用

- **WHEN** 可靠资源地址使用非 DSH 会话文件路由的自定义 scheme，且可解析为包含 scheme 与 authority 或绝对 path 的绝对分层 URI
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

#### Scenario: Windows 转义一致

- **WHEN** 同一路径的 Windows 盘符/斜杠形式不同且包含空格、中文、#、?、%
- **THEN** 两入口得到同一规范 file URI；原始路径字面 %20 编码为 %2520；合法 file URI 的 %20 不重复编码

#### Scenario: 不猜测平台等价

- **WHEN** 两个路径仅大小写不同或含未确认符号链接别名
- **THEN** 不自行当作同一物理文件，不全局转小写或猜测 realpath

### Requirement: 命名图语义损失诊断

TriG 与 N-Quads SHALL 保留可解析命名图身份，普通无图语句为 default；无法可靠保留的图上下文 SHALL 标为 unknown 并产生按 code 聚合的 named-graph-unavailable 诊断，不得冒充默认图。JSON-LD 未支持的命名 @graph 同样明确标记，保留可解析语句；本能力不声明完整 dataset 查询或推理语义。

#### Scenario: TriG 命名图产生诊断

- **WHEN** 输入为带图标签的 TriG
- **THEN** 内部语句保留相应图身份，不产生 named-graph-ignored

#### Scenario: N-Quads 图名产生诊断

- **WHEN** 输入行是四元组形式的 N-Quads
- **THEN** 普通三元组字段和第四列图名同时保留，不产生 named-graph-ignored

#### Scenario: 无命名图不误报

- **WHEN** 输入是不含图标签的普通 Turtle 或 N-Triples
- **THEN** 不产生 `named-graph-ignored` 诊断

#### Scenario: 不支持的命名图明确未知

- **WHEN** 输入为当前 JSON-LD 子集不支持的带命名图结构
- **THEN** 可解析语句的 graph 为 unknown，并产生分类诊断，不伪称默认图完整
