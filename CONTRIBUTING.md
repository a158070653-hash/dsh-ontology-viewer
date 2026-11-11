# 参与贡献

感谢你愿意改进这个插件。仓库很小，流程也很轻。

## 环境

- Node.js >= 22（`node --test` 的 glob 参数自 v22 起支持）
- 不需要 `npm install`：运行时与测试都零依赖
- 想在真实界面里验证，需要一份 DSH（Web profile）

## 本地开发

```bash
git clone https://github.com/a158070653-hash/dsh-ontology-viewer.git
cd dsh-ontology-viewer
npm test            # 当前全部单元测试（数量随演进）
npm run build       # 改过 src/ 后重新生成 client.js
npm run check       # 语法 + 构建一致性 + 测试（提交前必跑）
npm run i18n        # 视图文案 key 与 zh/en 词典是否对齐
npm run stats       # 示例文件与压力用例的端到端统计
```

把仓库以 link 方式装进 DSH 后，刷新页面即可看到改动：

```bash
dsh plugin --profile <profile> add link:<仓库绝对路径>
```

## 改动约定

1. **不要手改 `client.js`**。它是 `build/build.mjs` 的产物；改功能请改 `src/`，然后 `npm run build` 并把生成的 `client.js` 一起提交。
2. **新增 UI 文案**：在 `src/main.js` 的 `ZH` / `EN` 里同时加 key，再跑 `npm run i18n`。
3. **新增支持格式**：改 `src/rdf-parse.js`（`detectFormat` + 解析器）、`src/main.js` 的 `ONTOLOGY_EXTENSIONS`，并在 `src/graph-model.js` 需要时补分类规则；测试至少覆盖一个正常样例和一个坏样例。
4. **颜色/主题**：只用 `--dsw-alias-*` 令牌，不要写死前景色；需要新色用 `color-mix()` 从品牌色派生。
5. **交互与性能**：布局计算必须确定性（固定种子，禁止 `Math.random`），大图路径要有上限保护。
6. **测试**：新增行为请补 `tests/` 下的 Node 测试；视觉/交互改动请在 PR 描述里说明如何在界面中验证（截图或步骤）。

## 提交信息

用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat: 支持 RDFa
fix: JSON-LD @list 展开丢项
docs: 补充安装说明
refactor: 抽出布局常量
test: 覆盖 N-Quads 图名
```

## PR 检查清单

- [ ] `npm run check` 通过
- [ ] 已提交重新生成的 `client.js`（如有功能改动）
- [ ] 新文案已进 zh/en 词典且 `npm run i18n` 通过
- [ ] 大文件/坏文件行为有上限与降级提示
- [ ] PR 描述写清动机、行为变化和验证方式

## 发版流程

1. 以 `package.json.version` 为包版本唯一来源，遵循 SemVer；将本次 Unreleased 归入带日期的版本条目，保留旧版本历史，并更新 README 固定 tag 安装示例、`docs/compatibility.md` 的已验证 DSH/可选集成版本与限制。不根据单个测试版本猜测 `engines.dsh` 范围。
2. 执行 `npm run check`、`npm run i18n`、`npm run stats` 与 `openspec validate --all --strict`；打包并核对 tarball 内的版本、Client、patch、图标、locale、兼容说明与零依赖声明。仅暂存本次发布文件。提交后创建不可变的 annotated tag：`git tag -a vX.Y.Z -m "vX.Y.Z"`，确认远端目标后推送 `git push origin main vX.Y.Z`；已有发布 tag 不覆盖。
3. 为本次版本编写 `docs/release-vX.Y.Z.md`（功能、兼容基线、安装与验证限制），生成预构建包并挂到 Release（资产名固定为不带版本号的 `dsh-ontology-viewer.tgz`，否则 `latest/download/` 链接下次发版就会 404；已发布资产不覆盖）：

   ```bash
   npm run pack:release
   gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file docs/release-vX.Y.Z.md
   gh release upload vX.Y.Z dsh-ontology-viewer.tgz
   ```

4. 若插件市场条目的 `tarball:` 指向 `releases/latest/download/dsh-ontology-viewer.tgz`，无需改动。

## 视觉验证说明

视觉类改动须在实际 DSH 页面验证并记录宿主版本、入口、主题、语言和窗口宽度；Node 测试不能替代该验收。1.1.0 的记录见 OpenSpec 归档。提交 PR 时附截图或可复现步骤，未验证的组合明确注明。
