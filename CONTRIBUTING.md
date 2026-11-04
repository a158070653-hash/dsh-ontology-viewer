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
npm test            # 46 个单元测试
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

1. 更新 `CHANGELOG.md` 与 `package.json` 的 `version`。
2. `npm run check`，然后提交并打 tag：`git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z`。
3. 生成预构建包并挂到 Release（资产名固定为不带版本号的 `dsh-ontology-viewer.tgz`，否则 `latest/download/` 链接下次发版就会 404）：

   ```bash
   npm run pack:release
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md
   gh release upload vX.Y.Z dsh-ontology-viewer.tgz --clobber
   ```

4. 若插件市场条目的 `tarball:` 指向 `releases/latest/download/dsh-ontology-viewer.tgz`，无需改动。

## 视觉验证说明

本项目作者环境没有浏览器控制能力，界面截图无法自动生成。视觉类改动请在 PR 中附截图（明暗主题各一张更好），这会直接帮助维护者 review。
