# AGENTS.md

本文件是 dsh-ontology-viewer 的 AI 开发入口。开始任何改动前先读本文件，再按任务读取对应文档。

## 一、项目定位

- 本项目是 DeepSeek Harness（DSH）的 Web 插件：把 `.ttl` / `.owl` / `.rdf` / `.jsonld` / `.nt` / `.n3` 等 RDF / 本体文件在右侧栏渲染为可交互的节点-关系图。当前能力是**只读展示**，不是编辑器、不是通用图数据库工具。
- 技术栈：Node.js >= 22；浏览器端单文件 Client 模块；React + SVG；手写零依赖 RDF 解析器；确定性力导向布局；无运行时依赖、不请求网络。
- 真实入口：`index.js` 是几乎为空的 Host 半侧（只为在 profile 里可启停），`cordis.patch.yml` 负责把 bundle 挂进 profile，`package.json` 的 `dsh.bundle.patch` / `dsh.client` 声明加载方式；界面能力全部在 `client.js`（由 `src/*.js` 生成）。
- 项目应保持轻量、可独立安装、便于维护；不做框架级重构，不引入非必要依赖。

## 二、规范与文档路由

| 需要了解 | 读取 |
| --- | --- |
| 对外功能、安装、使用、已知限制 | `README.md` |
| DSH 宿主契约：`ctx.documentPreviews`、可选 `ctx.betterSidebar`、Client 模块格式 | `docs/integration.md` |
| 开发、构建、测试、运行时探查与验证边界 | `docs/development.md` |
| 贡献约定、PR 检查清单、发版流程 | `CONTRIBUTING.md` |
| 版本与变更记录 | `CHANGELOG.md`、`package.json` |
| OpenSpec 工作流上下文与规则 | `openspec/config.yaml` |
| V1.0.0 基线能力规格（含已知偏差记录） | `openspec/specs/`（各 spec 末尾的“已知偏差与待修复事项”） |
| 四层验证（validate / verify-change / npm 测试 / 真实页面）的分工 | 本文件 §四 4.1 |
| 进行中的变更 | `openspec/changes/` |
| OpenSpec 官方工作流技能 | `.dsh/skills/`（由 `openspec init` 生成，勿手改） |

按任务读取相关文档，不要求每次读全部源码和全部文档。

## 三、DSH 创造模式开发约束

- 插件开发优先使用 DSH 官方 `cordis-plugin-development` Skill；涉及宿主扩展点时同时参考本仓库 `docs/integration.md`。
- DSH 的 API、Slots、Services、注册参数必须依据**实际运行时**或当前有效文档；不臆造宿主 API 和插件能力，不根据记忆猜测接口。
- 优先复用 DSH 已有扩展点：本插件现有两个入口是 `ctx.documentPreviews` + `sidebar.right.tab.document`（必需）和 `ctx.betterSidebar`（可选）。
- 不直接修改 DSH 核心源码或全局 profile；不手工改 `~/.dsh` 下的共享配置。
- 安装、启用、更新、卸载插件等会影响当前 profile 的操作，应遵循 DSH 授权流程；本仓库的初始化与普通开发不应顺带重装插件。
- 不得把“运行时注册成功”等同于“真实 UI 验收通过”。注册成功只证明模块加载与扩展点调用；视觉与交互必须在真实 DSH 页面验证，并保留证据。
- 运行时检查优先使用创造模式提供的 Cordis 检查工具（如 `cordis_inspect_list` / `cordis_inspect_query` 查询真实 Slot、Service、Config、Theme）；当前会话未暴露该工具时，用 `dsh --profile <name> --dump-config` 确认 bundle 是否进入 profile（Electron 托管的 profile 可能拒绝 CLI 调用，此时以应用内插件列表为准），用浏览器控制台看 Client 模块与槽位报错。无法确认时标注“待核验”。

## 四、OpenSpec 工作流与验证层级

- 以下情况使用 OpenSpec Change：新功能、重大缺陷修复、接口/契约变更、重要重构。
- 小型文档、注释、无行为变化的简单维护允许直接处理，不必创建 Change。
- 先 Explore（问题不清时）或 Propose（明确范围与规格），再 Apply；不要跳过规格直接写实现。
- 已进入 Apply 的 Change 如需改变设计，应先 Update Change，再继续实施。
- Archive 是独立操作，只在人工明确要求时执行。**禁止**在 `proposal.md`、`design.md`、`tasks.md` 中创建 Archive 任务；不自动归档、不自动发布。
- 使用官方 `spec-driven` Schema，不创建自定义 Schema，不增加复杂审批体系。

### 4.1 四层验证的分工（不可互相替代）

| 机制 | 验证什么 | 不能证明什么 |
| --- | --- | --- |
| `openspec validate`（`--all` / `--specs` / `--changes`） | OpenSpec 配置、基线规格与变更产物的结构与格式有效性 | 实现是否符合规格；运行时或 UI 行为 |
| `openspec-verify-change` Skill | 某个 Change 的实现是否符合其规格与任务要求（需对照源码、测试、命令输出与验收证据） | 规格/产物本身的语法有效性；真实 UI 外观与交互 |
| `npm run check` / `npm test` / `npm run i18n` | 自动化测试覆盖的行为、`client.js` 产物一致性、i18n key 覆盖 | 测试未覆盖的视觉、布局、交互与宿主真实挂载 |
| 真实 DSH 页面验收 | 实际 UI 渲染、明暗主题、窗口宽度适配与交互 | 纯逻辑回归（不能替代自动化测试） |

- `openspec validate` 通过只说明规格与产物“格式正确”，**不等于**实现合规；仓库没有 Change 时它只校验基线与配置。
- `openspec-verify-change` 只在存在 Change 时使用，结论必须基于真实命令输出与代码/运行时证据；不能用它替代 `npm run check`。
- `npm test` 通过不等于 UI 验收通过；真实页面验收也不产生自动化回归保护。四层验证按改动范围组合执行。
- 未执行、无法执行或只做了静态推断的验证，必须标注“未执行 / 未验证 / 静态推断”，不得写成“已通过”。

### 4.2 命令入口

- 在本仓库根目录执行 OpenSpec 命令（若 DSH 工作区根不是本仓库，先 `cd` 到本仓库）：

  ```bash
  openspec list
  openspec status --change <name> --json
  openspec instructions <artifact> --change <name> --json
  openspec validate --all
  ```

  也可直接调用对应 Skill：`openspec-explore`、`openspec-propose`、`openspec-apply-change`、`openspec-update-change`、`openspec-verify-change`、`openspec-archive-change`。

## 五、代码与测试约束

- `src/` 是源代码；`client.js` 是 `build/build.mjs` 的生成产物。**禁止直接修改 `client.js`**。
- 修改 `src/` 后执行 `npm run build` 重新生成 `client.js`，并检查产物与源码一致；提交时源码与产物一起提交。
- 遵守零运行时依赖策略。确需增加依赖时，说明必要性、收益与代价，并等待人工确认；不得为了省事引入 d3、cytoscape 等库。
- 兼容已有 DSH 原生预览与可选 better-sidebar 集成；可选集成缺失时插件必须仍能工作，不能把 better-sidebar 变成硬依赖。
- 不因新功能破坏现有解析格式。新增格式需同时改 `src/rdf-parse.js`（`detectFormat` + 解析器）、`src/main.js` 的 `ONTOLOGY_EXTENSIONS`，必要时改 `src/graph-model.js` 分类规则，并补测试。
- 修改解析、建模或渲染行为必须补充相应测试；坏输入、上限、降级路径也要覆盖。
- 使用项目已有 npm scripts 验证：`npm run check`（语法 + 产物一致性 + 全部测试）与 `npm run i18n`；需要端到端统计时用 `npm run stats`。测试数量不是规格常量，以仓库当前全部测试通过为准；不要在新文档或规格里把某个具体数字写成永久门槛。
- 不将未执行的测试描述为已通过；未运行的验证要明确标注“未执行”。
- 不要求每个小修改都运行无关的完整测试集；按改动范围选择最小充分验证。
- 新增 UI 文案时同时在 `src/main.js` 的 `ZH` / `EN` 字典加 key，并运行 `npm run i18n`。
- 颜色只通过宿主 `--dsw-alias-*` 主题令牌取值，并可为每个令牌提供字面量兜底；不要写死前景色。
- 布局必须确定性：固定种子，禁止 `Math.random`；大图路径要有上限保护。

## 六、现状冲突上报

当需求或规划与当前真实代码、已有功能、已归档规格、当前 Change、DSH 运行时 API、构建方式或依赖关系发生冲突时：

1. 停止相关实施。
2. 报告冲突来源和实际证据（文件与行号、命令输出、运行时结果）。
3. 给出可选处理方案及各自影响。
4. 等待人工决策。
5. 不得自行覆盖现有实现或已确认规范。

## 七、Git 与版本管理

- 保护用户的未提交修改；不擅自清理、重置、强制切换或覆盖工作区。
- 不自动执行 `git push`、创建 Release 或发布到插件市场。
- 代码变更与生成产物保持一致；不提交无关文件。
- 版本升级遵守 `package.json` 与 `CHANGELOG.md` 的既有规则；本次 OpenSpec 初始化本身**不升级 V1.0.0**。
- 提交信息使用 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` 等）。
