# Spec Delta

## ADDED Requirements

### Requirement: 性能基准与分阶段指标

仓库 SHALL 提供独立、可重复的性能基准命令，覆盖小型本体、中型本体、接近当前上限的大型本体、高密度关系图与异常输入五类夹具，并按解析、建图、布局、图规模与元素计数分阶段报告耗时。涉及后台计算时，基准 SHALL 同时测量端到端指标：worker 初始化与源码编译、消息往返、结构化克隆或 transfer 成本、主线程等待与最长任务、取消与重建成本；并 SHALL 对照 worker 与主线程路径的语义一致性（节点、边、坐标、诊断一致）。基准 SHALL 支持在相同夹具与环境下做改造前后对比；夹具 SHALL 确定性生成或来自仓库示例，MUST NOT 依赖网络或未固定版本的依赖，MUST NOT 在缺少测量数据前把绝对毫秒阈值写成验收门槛，MUST NOT 把「更快」当作正确性证明。

#### Scenario: 运行性能基准

- **WHEN** 维护者运行性能基准命令
- **THEN** 命令对五类夹具分别输出各阶段耗时与规模统计，并记录运行环境，可重复执行得到可比较的结果

#### Scenario: 基准用于确定预算

- **WHEN** 设计或实施需要确定边预算、多跳预算或降级阈值
- **THEN** 依据基准输出确定初始值并记录测量条件，而不是凭经验写死数字

#### Scenario: CI 不被机器相关阈值阻塞

- **WHEN** CI 在共享 runner 上执行现有检查
- **THEN** 性能基准不参与默认门槛，只有用户可显式运行的命令；CI 结果不因机器性能波动失败

#### Scenario: 后台计算端到端指标

- **WHEN** 基准覆盖使用后台计算的路径
- **THEN** 除计算耗时外，报告初始化与源码编译、消息往返、克隆或 transfer、主线程等待与最长任务、取消与重建成本

#### Scenario: 改造前后同环境对比

- **WHEN** 对同一夹具、同一环境分别运行改造前基线与改造后实现
- **THEN** 输出成对且可比较的结果并记录测量条件，不把 worker 计算时间当作唯一指标

#### Scenario: worker 与主线程语义一致

- **WHEN** 同一输入分别走 worker 与主线程路径
- **THEN** 两条路径产出的节点、边、坐标与诊断一致，差异被记录为缺陷

### Requirement: 真实 DSH 运行时验收

涉及后台计算、图谱交互、状态语义或布局的改动 SHALL 在真实 DSH 页面完成运行时验收并保留证据；验收至少覆盖：插件 Client 模块加载与预览槽位挂载、构建产物在真实页面被加载、后台计算可用性探针、原生预览与 better-sidebar 两个入口、过滤与多跳探索、节点详情分组、空/截断/错误状态、明暗主题与中英切换、窄窗口布局，以及既有缩放、拖拽、重新布局、适配视图、高亮与搜索行为未被破坏。后台计算探针 SHALL 逐项验证构建产物加载、CSP（含 `worker-src` 与 `default-src` 回退）、加载器契约、worker 构造、消息往返、终止与 Blob URL 释放，MUST NOT 仅依据其它插件使用 Worker 的源码先例推断本插件可用。单元测试与 bundle 接线测试 MUST NOT 被当作 UI 验收证据。

#### Scenario: 后台计算探针

- **WHEN** 在真实页面执行最小后台计算探针
- **THEN** 记录通过或失败的原始证据；失败时功能按降级路径工作，并在设计/实施记录中保留失败原因

#### Scenario: 新增交互的页面验收

- **WHEN** 验收人员按步骤操作过滤、多跳、详情与搜索
- **THEN** 行为与规格一致，且既有交互仍可用，验收步骤或截图成为变更证据

#### Scenario: 两个入口一致

- **WHEN** 同一文件分别通过原生预览与 better-sidebar 打开
- **THEN** 两者在加载、空、过大、错误与图谱内容上表现一致

#### Scenario: 后台计算探针覆盖构建与生命周期

- **WHEN** 在真实页面执行后台计算探针
- **THEN** 逐项记录构建产物加载、CSP 判定、worker 构造、消息往返、终止与 Blob URL 释放的原始证据；失败时走降级路径并保留失败原因

#### Scenario: 代码先例不构成可用性证据

- **WHEN** 仅观察到其它插件使用 Blob Worker 的源码先例
- **THEN** 不得据此判定本插件可用，须以本插件在真实 DSH 页面的探针结果为准

## MODIFIED Requirements

### Requirement: 单文件 Client 构建

`build/build.mjs` SHALL 按固定的模块顺序拼接源码，拒绝源码中的 `import` 语句与 `export default`，剥离 named export，生成包裹在 `window.__ModuleLoader__.load` 中的单文件 `client.js`；模块清单 SHALL 随源码拆分同步维护。若采用内嵌后台计算脚本，构建 SHALL 从同一份源码确定性生成该脚本字符串并嵌入 `client.js`，MUST NOT 依赖第二个运行时资源文件或额外请求；生成产物 SHALL 与源码一起提交，不得手改。

#### Scenario: 从源码生成产物

- **WHEN** 运行 `npm run build`
- **THEN** 仓库根目录的 `client.js` 被重写，内容包含全部模块、可能的后台计算脚本字符串与模块加载器调用

#### Scenario: 源码包含 import 时拒绝构建

- **WHEN** `src/` 中任一模块包含 `import` 语句
- **THEN** 构建脚本报错并退出，不生成产物

#### Scenario: 模块清单与产物一致

- **WHEN** 新增或拆分源码模块后未同步构建脚本或未重新生成产物
- **THEN** 构建一致性检查失败并指出产物过期

### Requirement: 自动化验证命令与 CI

`npm run check` SHALL 依次执行 `node --check client.js`、`node build/build.mjs --check` 与仓库当前全部单元测试，其通过条件为全部测试通过，测试数量随代码演进、不作为规格常量；`npm run i18n` SHALL 独立执行文案 key 覆盖检查；`npm run stats` SHALL 保留现有端到端统计；新增的性能基准 SHALL 通过独立命令运行并默认不进入 CI。GitHub Actions CI SHALL 在 Node 22 上执行语法检查、构建一致性、单元测试与 i18n 检查。

#### Scenario: 本地完整检查

- **WHEN** 运行 `npm run check`
- **THEN** 仓库当前全部单元测试通过、构建一致性检查通过，退出码为 0

#### Scenario: CI 覆盖范围

- **WHEN** 向 `main` 推送或提交 Pull Request
- **THEN** CI 执行语法、构建一致性、测试与 i18n 四项检查，不执行性能基准与发布打包

#### Scenario: 新增行为有自动化回归

- **WHEN** 新增解析契约、过滤、探索、预算或任务取消逻辑
- **THEN** 对应单元测试覆盖正常路径、上限路径与坏输入降级路径
