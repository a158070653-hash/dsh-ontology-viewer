# Spec Delta

## MODIFIED Requirements

### Requirement: DSH 原生文档预览注册

Client SHALL 通过 `ctx.inject(['documentPreviews'])` 注册 `ctx.documentPreviews`，实现 id 为 `dsh-ontology-viewer/graph`，覆盖 `ttl`、`turtle`、`owl`、`rdf`、`rdfxml`、`jsonld`、`nt`、`n3`、`nq`、`trig` 十种后缀，`priority` 为 `extension`，`loading` 为 `bytes-complete`，`wrap` 为 `false`；并 SHALL 在 `sidebar.right.tab.document` 槽位注册相同 key 的正文组件。用户仍可在预览头部下拉框切回宿主纯文本。正文组件 SHALL 保留 resourceAddress 作为 navigationAddress，从官方 metadata/stat/readBytes 取得宿主确认 absolutePath 后统一转换 RDF Base；显示名单独用于标题。路径不可用时来源隔离并诊断。

#### Scenario: 打开本体文件默认显示图谱

- **WHEN** 用户从 DSH 文件树打开一个受支持后缀的文件
- **THEN** 右侧预览默认选择“本体图谱”渲染器

#### Scenario: 可切回纯文本

- **WHEN** 用户在预览头部下拉框选择宿主纯文本
- **THEN** 同一文件以文本方式显示

#### Scenario: 预览正文使用资源地址解析

- **WHEN** 宿主为预览正文提供 `content` 与 `resourceAddress`
- **THEN** 路由保留作访问与导航，宿主确认的路径才用于默认 RDF Base，标题显示文件名，三者互不替代

### Requirement: 可选 better-sidebar 集成

插件 SHALL 通过 `ctx.inject(['betterSidebar'])` 注册 better-sidebar 文件查看器（id `dsh-ontology-viewer`、`priority` 30、`fetchStrategy` 为 `fsRead`）与文件图标（id `dsh-ontology-viewer/icons`）；未安装 `dsh-better-sidebar` 时该回调不执行，原生预览仍必须可用。文件查看器 SHALL 以实际提供且可靠的绝对 `path` 通过统一路径转换得到默认 RDF Base；若 path 为相对值则先用其授权 Session 的官方 stat 确认，不由显示名猜测路径，并 SHALL 与原生预览使用同一套读取中、空、过大、错误状态语义。

#### Scenario: 未安装 better-sidebar 时降级

- **WHEN** 当前 profile 没有 `dsh-better-sidebar`
- **THEN** 插件不注册 better-sidebar 扩展，也不抛错，原生预览继续工作

#### Scenario: 已安装时显示文件树入口

- **WHEN** 当前 profile 安装了 `dsh-better-sidebar`
- **THEN** 文件树中受支持的本体文件可打开图谱页签，并显示图谱文件图标

#### Scenario: 两个入口对同一文件给出一致图谱

- **WHEN** 同一文件分别从原生预览与 better-sidebar 打开
- **THEN** 两者使用同一资源身份与解析语义，节点 IRI 与空/过大/错误状态一致

### Requirement: 资源身份与两个入口的状态一致性

正文组件 SHALL 分离 navigationAddress、absolutePath 与 rdfBase：原生通过官方元数据或 workspaceFiles 获取真实路径，better-sidebar 使用其实际绝对路径，两者统一规范化。DSH 会话路由仅作访问、授权、导航；显示文件名不参与身份。无可靠路径时仍可由文档绝对 Base 定义身份，否则相对项来源隔离并诊断。读取中、空、失败、过大状态及两入口上限 SHALL 保持：原生插件12 MiB（UTF-8），better-sidebar宿主5 MiB；不得伪造宿主未提供状态。

#### Scenario: 相对 IRI 使用真实资源地址

- **WHEN** 用户打开一个包含相对 IRI 的文件，且宿主确认了真实绝对路径
- **THEN** 图中相对 IRI 基于该绝对路径转换的 RDF Base 解析，不使用显示名或 DSH 路由

#### Scenario: 同名文件在不同目录不冲突

- **WHEN** 两个不同目录下的同名文件都包含相同的相对 IRI
- **THEN** 两个文件中的该资源得到不同的绝对 IRI，不会被视为同一节点

#### Scenario: 空文件在两个入口都进入空状态

- **WHEN** 用户打开 0 字节的本体文件，无论从原生预览还是 better-sidebar 进入
- **THEN** 视图显示"没有可绘制内容"的空状态，而不是持续显示读取中

#### Scenario: 读取失败与读取中可区分

- **WHEN** 宿主读取文件失败或返回不可解码的内容
- **THEN** 视图进入错误状态并说明原因，而不是无限停留在读取中

#### Scenario: 入口可读上限分别提示

- **WHEN** 文件大小超过某个入口的真实读取能力（原生预览的插件 12 MiB 限制，或 better-sidebar 宿主 5 MiB 阈值）
- **THEN** 视图说明该入口的真实上限与原因，不把另一个入口的上限文案套用过来，也不修改宿主或其它插件的读取配置

#### Scenario: 超大可读文件降级为过大提示

- **WHEN** better-sidebar 只提供文件大小而不提供内容
- **THEN** 视图显示文件过大提示，并说明这是 better-sidebar 的读取限制

#### Scenario: 同文件双入口一致

- **WHEN** 同一真实文件分别经原生 metadata/stat/readBytes 与 better-sidebar absolute path 进入
- **THEN** 默认 RDF Base 和解析后的完整 IRI 一致，来源去重不依赖显示名或 Session ID

### Requirement: 后台计算与宿主加载契约兼容

解析、建模与布局 SHALL 可以在后台或可中断任务中完成；该计算能力 MUST NOT 引入新的宿主服务或额外插件脚本资源请求；多文件读取仅通过已确认的官方 workspaceFiles 能力适配，MUST NOT 改变现有 Client 模块的单文件加载、工厂签名与注册生命周期；后台计算不可用时 SHALL 退化为可用的主线程路径而不是功能缺失。gen 代际号只用于识别过期结果，SHALL NOT 被当作真正取消；对正在执行同步任务的 Worker SHALL 使用终止并重建（或等价的有效取消）机制。Worker 路线 MUST 先通过真实 DSH 环境探针（构建、CSP、加载、通信、终止与释放）才能启用，源码中其它插件的 Worker 先例不构成启用依据。

#### Scenario: 后台计算不改变注册契约

- **WHEN** 插件加载并注册文档预览、槽位正文、better-sidebar viewer 与 locale
- **THEN** 注册参数、key、加载方式与 V1.0.0 契约一致，且没有发起额外插件脚本资源请求；用户主动选定文件的官方 Remote 读取不属于插件脚本加载

#### Scenario: 后台计算不可用

- **WHEN** 运行环境无法创建后台任务或创建失败
- **THEN** 插件继续在页面主线程完成解析与布局，采用更严格的输入预算并明确提示性能降级，不丢失任何功能

#### Scenario: 输入变化取消旧计算

- **WHEN** 用户在计算完成前切换文件、关闭面板或更换宿主视图
- **THEN** 旧任务被终止或取消，其过期结果不会覆盖新输入对应的界面，Worker 资源被释放

#### Scenario: 同步任务无法中断时终止重建

- **WHEN** Worker 正在执行不可中断的同步解析，而输入已经变化
- **THEN** 插件终止该 Worker 并（按需）重建，而不是等待其完成后再丢弃结果

#### Scenario: 启用 Worker 前完成真实探针

- **WHEN** 实施准备启用 Worker 路线
- **THEN** 已记录真实 DSH 页面中构建加载、CSP、Worker 构造/通信/终止/释放的探针结果；未通过时使用降级路线而不是启用

## ADDED Requirements

### Requirement: 多文件入口能力门

插件 SHALL 优先使用已验证的官方 workspaceFiles Client Remote 逐目录列举和用户复选读取；不得自动递归扫描。实测缺失或不可调用时 SHALL 提供浏览器 File API 主动多选/文件拖放，不伪造绝对路径。权限拒绝不得通过其它隐藏接口重试；取消和过期结果不得加入集合。Mock 结果 MUST NOT 代替真实宿主验收。

#### Scenario: 官方多文件读取

- **WHEN** 真实 Client 的 list/stat/readBytes、授权和取消验证通过
- **THEN** 使用用户所选 Session 与路径读取，列表截断和拒绝明确呈现

#### Scenario: 后备本地选择

- **WHEN** 官方能力缺失或验证失败
- **THEN** 禁用该入口并说明，用户可主动通过 File API 选择文件；取消不修改集合

### Requirement: 更新和来源导航能力

插件 SHALL 处理预览内容更新与重新打开；额外来源可用正式 changes 订阅标记过期，不可用时提供手动重载。来源打开 SHALL 仅使用已验证宿主导航接口和有效地址，否则提供文件信息与复制标识；没有真实语句位置不得传伪行号。关闭工作区、连接重置或卸载 SHALL 取消相关订阅与请求。

#### Scenario: watch 不可用

- **WHEN** 宿主拒绝或不支持 changes
- **THEN** 保留读取能力并提示手动重载，不假称自动同步

#### Scenario: 来源打开回退

- **WHEN** 来源是浏览器文件或宿主打开接口未验证
- **THEN** 显示文件信息和复制操作，不伪造可跳转磁盘地址
