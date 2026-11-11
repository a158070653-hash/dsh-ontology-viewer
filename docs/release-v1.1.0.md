# v1.1.0 — 多文件本体工作区与三视图

## 更新内容

- 多文件来源管理、跨文件实体合并、来源追溯与同 Session 显式共享。
- 关系网络、类/属性层级树、分层语义关系图；支持多重继承、循环提示与循环组成员查看。
- 当前视口/显示集合完整布局的安全 SVG 与 PNG 导出，像素预检、失败回退和手动复制 SVG。
- 更准确的 RDF Base、来源隔离与 TriG/N-Quads 命名图身份保留。
- Worker 解析/组合/布局、分层预算、过滤、多跳探索、详情分页、键盘导航与即时中英切换。
- 修复导出标签裁剪、暗色导出主题、过期布局覆盖、循环组键盘操作和语言切换后旧提示不更新等问题。

## DSH 支持与依赖

已验收：**DSH Desktop 0.2.2-rc.1，Windows x64**；记录运行环境 Node.js 24.21.0。包要求为 **Node.js >=22**。其它 DSH 版本、独立 Web 部署与其它平台尚未建立兼容矩阵，不把单版本测试视为完整范围保证。

`dsh-better-sidebar` 为可选插件，选定接入路径已在 **0.30.1** 验证；原生预览不需要它。React、Cordis slots/locale 和文档预览由 DSH 提供，插件无 npm 运行时或 peer 依赖。

本次 profile 不具备 `remote.workspaceFiles`，多文件使用浏览器本地文件选择。Worker 不可用时有主线程降级；better-sidebar 的 5 MiB 读取阈值与原生预览的 12 MiB 插件上限分别提示。

## 安装与升级

```bash
dsh plugin --profile <profile> add https://github.com/a158070653-hash/dsh-ontology-viewer/releases/download/v1.1.0/dsh-ontology-viewer.tgz
```

使用现有 profile 名（验收环境为 `desktop`），更新后重载 Client；桌面保留旧模块时重启一次。页面内工作区为临时数据，升级前保存所需导出。DSH 路由/显示名不再伪造 RDF Base，无可靠 Base 时来源隔离，依赖旧伪 URI 的显示结果可能改变。

完整说明：[兼容、依赖与升级](https://github.com/a158070653-hash/dsh-ontology-viewer/blob/v1.1.0/docs/compatibility.md) · [更新日志](https://github.com/a158070653-hash/dsh-ontology-viewer/blob/v1.1.0/CHANGELOG.md)。

## 验证与边界

- 发布前运行语法、构建一致性、全部 Node 测试、i18n、示例/压力统计和 OpenSpec strict；tarball 清单与版本单独核验。
- 真实 DSH 记录覆盖明暗、中英、窄栏、三视图、Worker 和 SVG/PNG 保存；better-sidebar 未逐项重复全部交互，内存采样不作为泄漏定论。
- 本发布为 GitHub Release，资产名固定 `dsh-ontology-viewer.tgz`；未向 npm registry 发布。
