# Changelog

## 1.2.1 — 2026-08-19

- **修复 Zotero 入库在真实 Tampermonkey 下必然失败**。Zotero connector 会掐断
  任何带 `Origin` 头、但未带 `X-Zotero-Connector-API-Version` 的请求——这是它
  阻止任意网站写入文献库的安全闸门。`GM_xmlhttpRequest` 总会附带 `Origin`，
  因此此前每次点 `+ Zotero` 都直接报 `✗ 失败 (network)`。补上该请求头即可。
  （之前用 curl 测试时未带 `Origin`，所以一直是 201，掩盖了这个问题。）

## 1.2.0 — 2026-08-19

- 新增**中英双语界面**：首次运行按 `navigator.language` 自动选择，
  工具栏 `EN / 中` 按钮可手动切换并记住选择。所有 UI 文案集中在一个
  `I18N` 字典里，不再散落于代码。
- Zotero 按钮标签改为 `data-state` 驱动，切换语言时已入库/失败的按钮
  会正确改写文案而不丢结果。
- 工具栏改为可重建（`renderBar()`），重建时保留过滤词、高亮词、
  列数与关键词行展开状态。
- 文档拆分为英文 `README.md` 与中文 `README.zh-CN.md`。

## 1.1.0 — 2026-07-30

- 新增 **Zotero 一键入库**：每张卡片一个 `+ Zotero` 按钮，走
  `/connector/saveItems`（与 Zotero 浏览器插件同一端点）。CrossRef 优先，
  查不到时用页面元数据兜底并打 `metadata-unverified` 标签。
- 新增 **列数可调**：自动 / 1–5 列，1–2 列时恢复原生宽度。
- 卡片视图收掉右侧 300px 广告位，内容区在 1280px 屏幕上从 916px 增至 1216px。
- `@grant` 由 `none` 改为 `GM_xmlhttpRequest`（Zotero connector 不发 CORS 头）。
- 修复：紧凑视图下「摘要」开关被 CSS 覆盖导致点击无效。
- 修复：localStorage 配额超限时丢弃最旧一半而非整个缓存失效。
- 修复：`pagehide` 时立即落盘，避免防抖窗口内关标签页丢失缓存。

## 1.0.0 — 2026-07-30

- 懒加载复原 graphical abstract 与内联摘要。
- 卡片 / 紧凑列表双视图，解除 ACS 的 1300px 宽度锁。
- 实时过滤（标题 / 作者 / 摘要，空格分隔按 AND）与关键词高亮。
- 按 DOI 缓存至 localStorage，30 天 TTL，签名 CDN URL 按 `Expires=` 校验过期。
