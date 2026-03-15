# Parser-Driven Indexing Package Design

## Goal

新增一个独立、可复用的 workspace 包 `packages/indexing`，直接消费 `VfsNode` 与 `AsyncIterable<ParseChunk>`，将 parser 产出的 chunk 写入 SQLite FTS 与 zvec，并提供统一的混合检索接口与可插拔的 embedding / reranker 注册机制。

## Constraints

- 新包必须独立于现有 `src/core/*` 实现，不能只是应用层索引逻辑的包装。
- 新包接口围绕 parser chunk 建模，而不是围绕本地文件路径建模。
- 存储需要同时覆盖全文检索与向量检索。
- 检索结果既要返回最终混合结果，也要返回 FTS、vector、reranked 各路结果，便于 debug。
- embedding 与 reranker 要像 `VfsProviderRegistry` 一样支持注册多个 provider。

## Package Surface

包入口提供以下主能力：

- `createIndexingService(input)`
- `createEmbeddingRegistry(container)`
- `createRerankerRegistry(container)`

`IndexingService` 暴露：

- `index(input: { node: VfsNode; chunks: AsyncIterable<ParseChunk> }): Promise<{ indexed: number }>`
- `delete(input: { nodeId: string }): Promise<void>`
- `search(query: string, opts?: { topK?: number; titleOnly?: boolean }): Promise<SearchResultSet>`

其中 `index()` 负责全量替换单节点索引，`delete()` 清理单节点全文与向量数据，`search()` 执行 FTS、vector、融合和可选 rerank。

## Architecture

`packages/indexing` 采用四层结构：

1. `service`
   负责 index / delete / search 工作流编排。
2. `repositories`
   一个 SQLite FTS repository，一个 zvec repository。
3. `registries`
   embedding registry 与 reranker registry。
4. `types`
   对外稳定契约、provider 接口、search 结果结构。

这样可以把 parser、VFS、embedding、reranker 解耦：

- parser 只负责产出 chunk
- indexing 负责持久化和检索
- provider 通过 registry 注入
- 上层应用只依赖包公开契约

## Data Model

### Chunk Identity

每个 chunk 使用稳定主键：

- `chunkId = hash(nodeId + chunkIndex)`

同一个 `nodeId` 重建索引时，先删旧数据，再写入新数据，避免增量 diff 在第一版就引入复杂度。

### FTS Schema

SQLite FTS5 文档需要保留：

- `chunkId`
- `nodeId`
- `mountId`
- `sourceRef`
- `name`
- `title`
- `heading`
- `sectionId`
- `sectionPath`
- `text`
- `markdown`
- `tokenEstimate`
- `charStart`
- `charEnd`
- `providerVersion`
- `parserId`
- `parserVersion`
- `converterId`
- `converterVersion`
- `updatedAt`

其中：

- `text` 用于正文检索
- `title`、`name`、`sourceRef` 用于 title-only 检索
- 非文本字段也保留在普通列中，便于结果回填

### Vector Schema

zvec 行保存：

- `chunkId`
- `embedding`
- metadata:
  - `nodeId`
  - `mountId`
  - `sourceRef`
  - `name`
  - `title`
  - `heading`
  - `chunkText`
  - `chunkIndex`
  - `sectionPath`
  - `charStart`
  - `charEnd`
  - `tokenEstimate`
  - `updatedAt`

第一版只为 `status === "ok"` 的 chunk 写入向量库与 FTS。

## Search Contract

### Input

- `query: string`
- `opts.topK?: number`
- `opts.titleOnly?: boolean`

### Output

`search()` 返回：

- `hybrid: SearchHit[]`
- `fts: SearchHit[]`
- `vector: SearchHit[]`
- `reranked: SearchHit[]`
- `meta`

`meta` 包含：

- `query`
- `topK`
- `titleOnly`
- `embeddingProvider`
- `rerankerProvider`

`SearchHit` 统一为：

- `chunkId`
- `nodeId`
- `mountId`
- `sourceRef`
- `name`
- `title`
- `heading`
- `text`
- `chunkIndex`
- `sectionPath`
- `charStart`
- `charEnd`
- `score`
- `scores: { fts?: number; vector?: number; fused?: number; rerank?: number }`

## Search Flow

`search()` 固定按以下顺序执行：

1. 过滤空查询，空串直接返回空结果集。
2. 执行 FTS：
   - `titleOnly=false` 时查正文与标题相关字段
   - `titleOnly=true` 时只查 `title/name/sourceRef`
3. 执行 vector：
   - `titleOnly=false` 时对 query 做 embedding 并查 zvec
   - `titleOnly=true` 时默认跳过 vector，保证行为可解释
4. 以 `chunkId` 合并 FTS 与 vector 结果。
5. 归一化不同召回分数，生成 `fused` 分数。
6. 如果配置了 reranker，则对融合结果 rerank；否则 `reranked = hybrid`。
7. 返回最终 `hybrid` 结果与各路 debug 结果。

## Registry Design

注册表模式参考 `VfsProviderRegistry`，但不绑定 mount。

### Embedding Registry

- `register(type, factory)`
- `get(type, options?)`
- `listTypes()`

provider 契约：

- `embed(text: string): Promise<number[]>`
- `embedBatch?(texts: string[]): Promise<number[][]>`
- `dimension?: number`

### Reranker Registry

- `register(type, factory)`
- `get(type, options?)`
- `listTypes()`

provider 契约：

- `rerank(query: string, rows: SearchHit[], opts: { topK: number }): Promise<SearchHit[]>`

## Error Handling

- 未注册的 embedding / reranker type 直接抛出清晰错误。
- embedding 维度不一致在 upsert 前校验并失败。
- 向量或 FTS 单路失败时，第一版默认让 `search()` 失败，而不是静默降级。
- `index()` 过程中若任一路写入失败，应保证单节点替换操作的失败可见，避免部分成功的无声污染。
- `delete(nodeId)` 必须幂等，节点不存在时直接返回。

## Testing Strategy

最小测试矩阵包括：

- `index()` 首次写入 FTS 与 vector
- 重复 `index()` 替换同一 `nodeId` 的旧数据
- `delete()` 同时清理 FTS 与 vector
- `search()` 返回 `hybrid/fts/vector/reranked`
- `titleOnly` 只走标题相关检索
- embedding registry 可注册并解析自定义 provider
- reranker registry 可注册并解析自定义 provider
- reranker 关闭时 `reranked` 与 `hybrid` 一致
- 非 `ok` chunk 不入库
- 空 query 返回空结果
- embedding 维度不一致报错

## Non-Goals

第一版不做：

- 基于 chunk diff 的增量更新
- 多节点批量事务编排
- provider 自动发现
- title-only 下的标题向量索引
- 跨 provider 迁移与自动重建

## Open Implementation Notes

- `packages/indexing` 应复用 workspace 级依赖：`bun:sqlite` 与 `@zvec/zvec`
- provider 默认实现可以后续再补，第一版先把 registry 契约与 stub 测试立住
- parser example 或上层应用后续再决定如何把 `ParserService.parseNode()` 接到 `IndexingService.index()`
