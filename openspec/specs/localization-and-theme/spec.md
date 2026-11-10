# 本地化与主题 Specification

## Purpose

定义插件界面文案的中英双语机制、i18n 覆盖检查，以及图谱视图对 DSH 明暗主题令牌的适配方式。

## Requirements

### Requirement: 中英词典注册与语言切换

插件 SHALL 通过 `ctx.locale.register('dshOntology', { zh, en })` 注册界面文案，并通过 `ctx.locale.bind` 读取当前语言、`ctx.locale.subscribe` 在宿主语言变化时触发重渲染。

单次 locale 查询失败时（`bind` 抛错、返回空串或返回原 key），翻译层 SHALL 依次回退到内置 `ZH` 字典、内置 `EN` 字典，最后回退到调用方传入的 fallback；`ctx.locale.getLocale` 查询失败时，标题 SHALL 回退为中文。

整个 locale 服务不存在（宿主未注入 `ctx.locale`）不在 V1.0.0 支持范围内，见“已知偏差与待修复事项”。

#### Scenario: 切换语言后文案更新

- **WHEN** 用户在 DSH 中切换界面语言
- **THEN** 图谱视图、按钮、空状态和提示文案随语言重新渲染

#### Scenario: locale 查询失败时使用内置词典

- **WHEN** `ctx.locale.bind(key)` 抛错，或返回空串/原 key
- **THEN** 翻译依次取内置 ZH、内置 EN、调用方 fallback，视图仍可渲染

### Requirement: i18n key 覆盖检查

`scripts/check-i18n.mjs` SHALL 扫描所有承载界面文案的源码模块（包括本 Change 拆分出的 UI 模块），并核对 `src/main.js` 的 `ZH` 与 `EN` 字典是否都包含这些模块中的静态 `tr('key')` 调用；脚本 SHALL 同时覆盖新增的动态 key 家族（节点类型、关系方向、诊断 code、详情分组等）；缺失时退出码为 1。`locale/zh.json` 与 `locale/en.json` SHALL 提供插件清单使用的标题与描述。

#### Scenario: 文案 key 完整

- **WHEN** 运行 `npm run i18n`
- **THEN** 所有 UI 模块的静态 key 与登记的动态 key 家族在 ZH 与 EN 中均存在，命令退出码为 0

#### Scenario: 拆分模块中的 key 也被检查

- **WHEN** 某个新增 UI 模块使用了只在单一词典中存在的 key
- **THEN** 检查脚本报告缺失项并以退出码 1 结束

#### Scenario: 缺少翻译 key

- **WHEN** 某个 `tr('key')` 的 key 只存在于一个词典
- **THEN** 检查脚本报告缺失项并以退出码 1 结束

### Requirement: DSH 主题令牌适配

视图颜色 SHALL 通过 `--dsw-alias-*` 主题令牌取值，并为每个令牌提供字面量兜底；半透明颜色 SHALL 使用 `color-mix` 从品牌色或基础色派生；视图 SHALL 同时适配明暗主题，并在用户偏好减少动画时禁用节点与边的过渡动画。

#### Scenario: 明暗主题自适应

- **WHEN** 宿主切换到暗色或亮色主题
- **THEN** 画布背景、节点、边、文字与控件颜色随主题令牌变化，无需插件重启

#### Scenario: 减少动画偏好

- **WHEN** 宿主或系统启用 `prefers-reduced-motion`
- **THEN** 节点与边的过渡动画被禁用

### Requirement: 新增交互文案与诊断的本地化

本 Change 新增的过滤、探索、详情分组、搜索选择、截断汇总与诊断分类文案 SHALL 通过现有 locale 注册机制提供中文与英文；诊断 SHALL 以分类 code 的本地化标签与次数呈现，原始解析消息只作为可展开的细节，不得把英文原始消息直接当作主要界面文案。

#### Scenario: 新增控件随语言切换

- **WHEN** 用户在 DSH 中切换界面语言
- **THEN** 过滤、探索、详情、搜索、截断与诊断的文案随语言重新渲染

#### Scenario: 诊断按分类本地化

- **WHEN** 解析产生命名图忽略、远程上下文跳过等语义损失诊断
- **THEN** 提示条显示对应语言的分类名称与发生次数，展开后可见原始消息

#### Scenario: 缺少翻译时回退

- **WHEN** 某个新增 key 在宿主 locale 中不可用
- **THEN** 翻译回退到内置中英词典或调用方 fallback，界面仍可渲染

### Requirement: 入口上限与降级提示的本地化

插件 SHALL 为两个入口分别提供本地化的真实上限提示：DSH 原生预览按 12 MiB（UTF-8 字节）提示，better-sidebar 按宿主 5 MiB 读取上限提示，MUST NOT 把一个入口的上限文案套用到另一个入口，也不得为让 better-sidebar 读大文件而修改宿主配置。性能降级模式提示 SHALL 在中文与英文词典中均可用，说明降级原因与收紧后的预算，且该提示不属于过滤状态。本 Change 新增的诊断 code 与分类 SHALL 同时提供中英本地化标签。

#### Scenario: 两个入口的上限文案不同

- **WHEN** 原生预览与 better-sidebar 分别打开超过各自上限的文件
- **THEN** 两个入口分别显示各自语言下的真实上限（12 MiB / 5 MiB），不互相套用

#### Scenario: 降级模式提示本地化

- **WHEN** 视图因 Worker 不可用进入性能降级模式
- **THEN** 状态条以当前语言说明降级原因与收紧后的解析 / 显示预算，且该提示不改变过滤状态

#### Scenario: 新增诊断 code 本地化

- **WHEN** 出现本 Change 新增的诊断 code（如嵌套深度、字面量长度上限）
- **THEN** 提示条显示对应的中英分类标签与次数，原始消息只作为可展开细节

### Requirement: 新增控件的主题令牌与动效约束

新增的过滤面板、探索控件、详情分组、搜索结果列表与状态条 SHALL 只通过宿主 `--dsw-alias-*` 主题令牌取色并带字面量兜底，MUST NOT 写死前景色；在 `prefers-reduced-motion` 下 MUST NOT 为新增控件引入强制动画；焦点可见样式 MUST 与现有视觉风格一致。

#### Scenario: 明暗主题下新增控件可读

- **WHEN** 宿主切换亮色或暗色主题
- **THEN** 新增控件的背景、文字、边框与选中态随主题令牌变化，无需重启插件

#### Scenario: 减少动画偏好

- **WHEN** 宿主或系统启用 `prefers-reduced-motion`
- **THEN** 新增面板与列表不播放过渡动画，状态切换即时生效

## 已知偏差与待修复事项（V1.0.0 基线）

1. **整个 locale 服务缺失不受支持（未实现，不是已实现降级）**：Client 工厂声明 `inject: ['slots', 'locale']`，`apply` 在 `ctx.effect` 中直接调用 `ctx.locale.register(...)`，没有服务存在性判断；若宿主完全不提供 `ctx.locale`，插件不会被正常装载或在注册时抛错。现存的“词典回退”只覆盖“locale 服务存在但单次查询失败/尚未就绪”，不能外推为“locale 服务不存在时仍可渲染”。该降级路径未实现，也未经运行时验证。
2. **语言切换与主题适配的真实界面证据**：上述行为由 `ctx.locale.subscribe` 与主题令牌代码路径支持，仓库内没有 UI 自动化测试；真实宿主中的语言/主题切换需按 `build-and-verification` 的真实页面验收执行。当前仓库没有记录这类验收证据，不得声称“已在浏览器中验证”。
3. **i18n 检查范围**：`scripts/check-i18n.mjs` 只核对 `src/graph-view.js` 的静态 key 与脚本内硬编码的动态 key（kind / stats / degree），不覆盖 `src/main.js` 中其它直接取用的中文文案 key；它是覆盖检查，不是完整的 i18n 测试。
