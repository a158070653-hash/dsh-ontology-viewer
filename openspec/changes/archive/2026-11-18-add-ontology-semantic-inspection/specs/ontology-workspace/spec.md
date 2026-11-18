# Spec Delta

## MODIFIED Requirements

### Requirement: 语句去重与来源保留

工作区 SHALL 以完整且可靠的 RDF term 身份及命名图身份识别重复语句，去重展示时保留全部已接纳出现记录的来源、版本、图及次数。不同图的相同 SPO MUST 保持可区分。字面量语义身份 SHALL 包含完整词法值、语言和数据类型，不做值空间等价推理；UI 显示摘要 MUST NOT 充当语义身份；截断或身份材料不完整的字面量 MUST NOT 仅凭相同前缀判定重复。身份不可靠的语句 SHALL 保留为独立出现并显式携带 unknown 身份状态。来源和 statement occurrence 的关联 MUST 在跨文件合并、来源移除、原子重载与分析快照重建中保持一致。完整来源声明 SHALL 明确受解析及工作区接纳范围限制，并披露预算截断。

#### Scenario: 多文件重复语句

- **WHEN** 同一完整且可靠的语句在两个来源出现
- **THEN** 可以合并展示一条关系，详情及报告仍列出所有来源、版本、图、语句标识及正确出现次数

#### Scenario: 不同命名图

- **WHEN** 相同 SPO 分别出现在两个命名图
- **THEN** 语句记录可区分，合并绘制的关系详情分别列出两个图及其来源

#### Scenario: 来源 statement IDs retained

- **WHEN** a reliably equal statement occurs more than once in one or multiple sources
- **THEN** the merged display relation retains all accepted source-local statement IDs and occurrence counts

#### Scenario: 相同显示前缀的不同长字面量

- **WHEN** 不同长 literal 截断为相同显示摘要
- **THEN** L0 语句身份与多文件合并 MUST NOT 把它们判为相同；身份材料不足时保留两个 unknown 身份的 occurrence 并显示分析不完整

#### Scenario: 完全相同的长字面量

- **WHEN** 完整语义身份材料证明两个长 literal 的词法值、语言、datatype 与图均相同
- **THEN** 可合并语句展示，但仍保留每次来源/版本/statement occurrence；若材料不能证明相等则不合并

#### Scenario: 语言标签和数据类型不同

- **WHEN** 两个 literal 具有相同词法显示值但 language 或 datatype 不同
- **THEN** 它们保持不同 RDF term 身份，不做值空间等价或显示值等价合并

#### Scenario: 同一长字面量出现在不同文件

- **WHEN** 同一完整长 literal 语句出现在两个来源，且身份可可靠确认
- **THEN** 合并图可聚合该关系，同时 occurrence 仍分别指向两个来源、版本、图与语句标识

#### Scenario: 文件移除与重新加载后的身份和来源

- **WHEN** 移除一个贡献长 literal 的来源，或以新版本原子重载该来源
- **THEN** 只移除/替换该来源的 occurrences，其他来源贡献保持；重新生成的索引不得残留旧 statement occurrence 或错绑来源

#### Scenario: 字面量差异与截断

- **WHEN** 两个值仅语言或类型不同，或超长值被裁为同一前缀
- **THEN** 不错误合并为同一完整 RDF 字面量

#### Scenario: 字面量长度达到预算

- **WHEN** literal 长度等于或超过解析/显示长度预算
- **THEN** 边界结果的截断与身份可靠性状态明确；达到显示预算的值不得静默当成完整值，身份 unknown 时不得去重
