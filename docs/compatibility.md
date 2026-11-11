# 1.1.0 兼容性、依赖与升级

## 支持基线

1.1.0 的发布验收环境是 **DeepSeek Harness Desktop 0.2.2-rc.1、Windows x64**，该次运行使用 Node.js 24.21.0。以下表格区分包要求与验收结果；验收一个版本不代表所有更高或更低版本都兼容。

| 项目 | 要求或状态 |
| --- | --- |
| DSH 宿主 | 需要提供下述 Client 加载、槽位和文档预览契约；已验证版本为 Desktop 0.2.2-rc.1 |
| 其他 DSH 版本 | 未建立兼容矩阵；旧版本、新版本升级后均应复验 |
| 独立 Web 部署、macOS、Linux、其他架构 | 未纳入本次真实页面验收；不等于已知不兼容 |
| Node.js | 包声明 `>=22`；24.21.0 是验收环境，不是最低版本 |
| React | 由 DSH Client 模块加载器提供，插件不另行安装 |
| npm 运行时依赖 / peerDependencies | 无；不安装图形库、数据库或服务端渲染组件 |
| dsh-better-sidebar | 可选；已验证 0.30.1，不装仍可使用 DSH 原生预览 |
| workspaceFiles Remote | 可选；验收 profile 中不可用，逐目录选择入口未启用，使用浏览器本地文件选择 |

当前不声明 `engines.dsh` 数值范围：现有证据只能确认一个宿主版本，无法据此确定最低或最高兼容版本。安装成功或 Host 行 active 也不能替代 Client 界面验收。

## 必需宿主契约

- DSH Web Client 模块加载器 `window.__ModuleLoader__.load`，由宿主提供 `react`。
- Cordis Client 的 `slots`、`locale`、`ctx.inject`、`ctx.effect` 生命周期。
- 原生文档预览 `documentPreviews` 与 `sidebar.right.tab.document` 槽位，支持 `bytes-complete` 内容。
- 宿主 `--dsw-alias-*` 主题令牌；每个令牌都有本地兜底值。

没有 `betterSidebar` 服务时不注册其扩展；没有可靠绝对路径时，相对 IRI 在来源内隔离并给出诊断，不猜测磁盘路径。Blob Worker 不可用时使用受更严格预算保护的主线程路径。PNG 需要浏览器 Image/Canvas/Blob 能力，失败可改用 SVG。下载路径和保存对话框由宿主控制，插件只报告“已发起下载”。

## 可选 better-sidebar

`dsh-better-sidebar@0.30.1` 已验证文件查看器接入、三视图、多文件添加/移除和超大文件提示。其 `fsRead` 入口在本次环境受宿主 **5 MiB** 读取阈值限制；原生预览的插件限制为 **12 MiB（UTF-8 字节）**。不修改宿主或其他插件配置来放宽阈值。

同名异目录、空/坏文件、文本编辑切换、更新/重载及全部快捷键未在 better-sidebar 入口逐项重复验收。相关逻辑测试和原生入口证据不能替代这些组合的实际验收。详细记录保留在仓库的 OpenSpec 归档中。

## 从 1.0.0 升级

推荐固定发布资产，避免安装到不断变化的 main：

```bash
dsh plugin --profile <profile> add https://github.com/a158070653-hash/dsh-ontology-viewer/releases/download/v1.1.0/dsh-ontology-viewer.tgz
```

也可安装 Git tag `https://github.com/a158070653-hash/dsh-ontology-viewer.git#v1.1.0`。`<profile>` 使用现有 profile 名；本次验收使用 `desktop`。通过官方插件管理流程更新，不手动编辑共享 profile。更新后刷新页面；桌面版若仍显示旧 Client，重启应用一次。

升级前保存需要保留的导出结果。工作区及共享来源是页面内临时状态，关闭/重载后清空，没有数据库或持久数据迁移。

1.1.0 修正相对 IRI 的身份规则：DSH Session 路由和显示文件名不再充当 RDF Base。文档声明的绝对 Base 仍优先；未提供可靠 Base 的本地文件按来源隔离。因此依赖旧的伪造 file URI 的显示结果可能改变。

升级后建议打开 `pizza.ttl`，检查三视图、添加与移除来源、主题语言和 SVG/PNG 导出；安装 better-sidebar 时另走查其入口。若需回退，通过相同官方安装流程选择已发布的 `v1.0.0` Git tag（或该 Release 的固定资产地址），再重新加载 Client；临时工作区状态不会跨版本恢复。

## 版本管理

- `package.json.version` 为唯一包版本；1.1 系列的首个正式版本是 **1.1.0**，Git tag 为 **v1.1.0**。
- `CHANGELOG.md` 按版本记录变更，后续改动放在 Unreleased；SemVer 的 PATCH 用于兼容修复、MINOR 用于兼容新增功能、MAJOR 用于不兼容的公开契约变更。
- GitHub Release 绑定不可变版本 tag，预构建资产名固定为 `dsh-ontology-viewer.tgz`；`releases/latest/download/` 会跟随新发布，固定 `/download/v1.1.0/` 才能锁定版本。
- GitHub Release 与 npm registry 发布是不同渠道；本项目本次发布采用 GitHub Release，不宣称已发布至 npm。
