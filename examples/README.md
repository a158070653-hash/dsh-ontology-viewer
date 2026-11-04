# 示例本体文件

把这些文件复制进 DSH 的工作区（或直接在本仓库目录下打开一个 Session），在右侧栏「文件」里点开即可看到图谱。

| 文件 | 格式 | 内容 | 三元组 |
| --- | --- | --- | --- |
| [`pizza.ttl`](pizza.ttl) | Turtle | 披萨本体：类层次、对象/数据属性、语言标签、内联空白节点 | 73 |
| [`people.nt`](people.nt) | N-Triples | 人物与组织关系，含 `mailto:` IRI 和空白节点文档 | 22 |
| [`library.rdf`](library.rdf) | RDF/XML | 图书馆借阅模型，`xml:base` / `xml:lang` / 带类型字面量 | 30 |
| [`courses.jsonld`](courses.jsonld) | JSON-LD | 课程目录，`@context` / `@graph` / `@value` + `@language` | 34 |
| [`zoo.owl`](zoo.owl) | OWL / RDF-XML | 动物分类、`owl:Restriction` 空白节点、具名个体 | 59 |

这些文件同时被 `tests/fixtures.test.mjs` 用作端到端用例（解析 → 建图 → 布局），因此改内容时请同步断言里的数量约束。
