# Spec Delta

## MODIFIED Requirements

### Requirement: 图构建与节点分类

`buildGraph` SHALL 把 IRI 与空白节点三元组转换为节点和边，字面量不成为节点而挂在主语节点上；节点分类按 blank → property → class → external → individual 的优先级判定，其中 property 仅覆盖 `rdf:Property` / `owl:ObjectProperty` / `owl:DatatypeProperty` 三种类型；跨来源相同完整绝对 IRI SHALL 合并，空白节点与未解析相对项 SHALL 来源隔离；节点 provenance SHALL 引用来源及语句而不推断位置。节点 SHALL 输出 `id`、`label`、`iri`、`local`、`kind`、`types`、`degree`、`literals`、`outEdges`、`inEdges`。

#### Scenario: 字面量不成为节点

- **WHEN** 一条三元组的宾语是字面量
- **THEN** 该字面量进入主语节点的 `literals`，图中不新增节点或边

#### Scenario: 类节点识别

- **WHEN** IRI 被声明为 `owl:Class` / `rdfs:Class`、作为 `rdf:type` 的宾语，或参与 `rdfs:subClassOf`
- **THEN** 该节点分类为 `class`

#### Scenario: 外部引用识别

- **WHEN** IRI 没有出边、入边不超过 1、没有字面量和类型
- **THEN** 该节点分类为 `external`

### Requirement: 字面量、标签与边合并

图模型 SHALL 把字面量收集到主语并默认每节点最多保留 60 条（超出时产生警告），节点 SHALL 报告被丢弃的字面量条数（0 表示未截断）；单条字面量值超过可配置长度上限时 SHALL 截断并标记，不得静默丢弃；节点标签按 `rdfs:label`、`skos:prefLabel`、`foaf:name`、`dcterms:title` 的优先级选择，`rdfs:comment` 只进入详情；相同 `(主语, 谓词, 宾语)` 合并为一条带 `count` 的显示边；count SHALL 为已接纳语句出现次数，边 SHALL 关联全部来源及 statementIds，不同图的语句身份仍可区分；`rdf:first` / `rdf:rest` 列表管道不生成边。

#### Scenario: 平行边合并计数

- **WHEN** 同一对节点之间存在多条相同谓词的边
- **THEN** 图中只保留一条边，`count` 为出现次数

#### Scenario: 列表管道不画成边

- **WHEN** 输入包含 `rdf:first` / `rdf:rest` 的 RDF 集合结构
- **THEN** 这些三元组计入统计但不生成图边

#### Scenario: 每节点字面量超限报告丢弃条数

- **WHEN** 某个主语的字面量数量超过每节点上限
- **THEN** 该节点只保留上限内的字面量并报告被丢弃条数，图级截断元数据汇总被截断节点数，提示说明保留数量与上限

#### Scenario: 单条字面量值超长被截断

- **WHEN** 单条字面量值超过可配置长度上限
- **THEN** 该值被截断并标记为已截断，截断信息在节点数据与提示中可见，不得静默保留超长值

### Requirement: 过滤投影

图模型 SHALL 提供只读的过滤投影：按节点类型（类 / 属性 / 个体 / 空白节点 / 外部引用，多选；均未选择视为全部）、关系谓词（取自图中实际出现的谓词，多选）与相对锚点节点的方向（出边 / 入边 / 双向）投影当前图。投影 SHALL 不修改图模型或解析数据；锚点节点在现有类型/谓词/方向过滤下 SHALL 保留；若被来源筛选排除，只保留隐藏上下文提示，不重新带回来源外关系或用于探索；无锚点时方向条件 SHALL 不生效并给出说明；关系过滤使孤立节点消失属于预期行为。结果 SHALL 报告可见节点数、可见边数与各类隐藏数量（按类型、谓词、方向），供界面显示「可见 / 总数」。

#### Scenario: 按类型与谓词过滤只影响投影

- **WHEN** 用户选择只显示类节点并保留 `rdf:type` 谓词
- **THEN** 投影只包含类节点及两端都在投影内的边，原始图模型与解析数据保持不变，并报告隐藏的节点数与边数

#### Scenario: 锚点节点始终保留

- **WHEN** 当前锚点节点仍属于来源投影，但不满足类型/谓词/方向条件
- **THEN** 该锚点节点仍出现在投影中，以保证选中上下文不消失

#### Scenario: 无锚点时方向条件不生效

- **WHEN** 未选中任何节点而用户设置了入边或出边方向
- **THEN** 过滤只按类型与谓词生效，并明确提示「选择节点后才能过滤方向」

### Requirement: 源位置预留

图模型 SHALL 在顶层保留来源元数据 `source`，包含真实资源地址 `address`、显示名 `displayName` 与解析格式 `format`；节点 SHALL 预留来源位置字段 `source`，本次变更中该字段 SHALL 恒为 null：不得根据文件名、文档顺序或其它线索伪造行号、列号或字节偏移；来源元数据缺失时 SHALL 以空值表示，同样不得伪造。单文件顶层 source 仍提供兼容元数据，多文件 SHALL 追加 sources 表与 provenance 来源/语句引用；联合图不得用单个文件冒充全部来源。位置字段仍不影响实体身份，provenance 仅记录真实贡献，不推断位置。

#### Scenario: 来源元数据传递

- **WHEN** 输入提供真实资源地址、显示名与格式
- **THEN** 图顶层来源元数据与输入一致，并可在详情或诊断中展示

#### Scenario: 节点位置不伪造

- **WHEN** 图构建完成
- **THEN** 每个节点的来源位置字段为 null，即使输入缺少或包含位置线索也不得填充

#### Scenario: 缺失地址不伪造

- **WHEN** 没有可用的真实资源地址
- **THEN** 来源元数据中的地址为空值，不生成伪造地址

## ADDED Requirements

### Requirement: 来源贡献过滤

文件工作集 SHALL 从已接纳解析语句 L0 选择来源并构建 L1；单/联合工作集变化可重建 L1 但不重新解析未变文件。来源显示筛选 SHALL 在 L1 的真实来源贡献上形成 L2，再应用既有过滤、探索和绘制。搜索与完整详情 SHALL 读取当前工作集 L1 并标注来源隐藏，不从绘制结果反推语句。

#### Scenario: 共享实体不泄露来源外边

- **WHEN** L1 中共享节点同时具有文件A和B的不同关系，来源筛选仅A
- **THEN** L2只保留A贡献的关系，搜索详情仍可说明L1中的B关系当前隐藏，探索不能沿B跳转

#### Scenario: 单文件工作集重建

- **WHEN** 用户从联合切换到单文件工作集
- **THEN** 从该文件L0构建其L1及分类，未变文件不重新解析，图裁剪数据不被当作L0
