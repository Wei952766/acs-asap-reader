# Changelog

## 2.6.0 — 2026-09-23

项目更名为 **Journal Triage**，定位从「修 ACS 坏掉的列表页」转为
「跨出版商的文献分诊层」。脚本文件为 `journal-triage.user.js`，
旧的 `acs-asap-reader.user.js` 不再维护。

- **新增 Wiley 与 Nature 支持**。站点适配器声明列表各部分位置及
  **页面本身已提供什么**，缺的才抓。ACS 的 ASAP 页要抓摘要，
  Wiley / Nature 两者都自带。
- **新增 ACS 期目录支持**（`al-article-item-wrap`，与 ASAP 的标记不同）。
- **分段合并为连续网格**：出版商的 RESEARCH ARTICLE / COMMUNICATION / 日期批次
  不再切断网格，标题折叠成卡片徽章（含 HOT PAPER、VERY IMPORTANT PAPER）。
- 解除各家的内容栏宽度锁并收起推广栏；每家条目内部的布局冲突在各自适配器
  的 CSS 里单独驯服（ACS 期目录的 `float:left; width:0`、Nature 的
  `flex-flow:row-reverse`）。
- 沿用 1.5.0 对 ACS 恢复图摘的适配。

## 1.5.0 — 2026-09-23

- **修复 ACS 恢复图摘后出现的重复图片**。ACS 于 2026-09-22 把 graphical abstract
  放回了 ASAP 列表页，但用的容器是 `div.featured-img-wrapper`，与期目录页的
  `.issue-graphical-abstract` 不同名。脚本两个都不认，于是仍去抓文章页并插入
  第二张图，同一张卡片上出现两张图摘。现在优先接管页面已有的那张，抓取只作为
  仍然缺图时的兜底；摘要照旧抓取（ACS 没有恢复摘要）。

## 1.4.0 — 2026-08-20

- **入库时一并附上全文 PDF**。脚本在页内用同源 `fetch` 取 PDF（因此带着你的机构
  订阅授权，这是 Zotero 单独做不到的），再经 `/connector/saveAttachment` 上传，
  与元数据用同一个 `sessionID` 关联，无需 `parentItemID`。开放获取与订阅文章均已实测。
  按钮相应显示 `✓ 已入库 + PDF`；PDF 失败不影响条目本身，只降级标签并在 tooltip
  里给出原因。
- `X-Zotero-Connector-API-Version` 提取为常量 `ZOTERO_HEADERS`，供所有 connector
  调用共用。**此前 `saveAttachment` 漏发该头，被 Zotero 的安全闸门静默掐断连接**
  （表现为 `network` 错误），是 PDF 一直附加失败的根因。
- 工具栏根节点新增 `data-asap-version`，便于确认页面上实际运行的版本。

## 1.2.3 — 2026-08-19

- 脚本头补 `@license MIT`（Greasy Fork 等分发平台会读取该字段）。

## 1.2.2 — 2026-08-19

- 精简 README 的 Zotero 章节：要点直给，调查过程与踩坑记录收进折叠块。
- 移除脚本与文档中的个人身份信息。**`@namespace` 已从 `weihuang.acs` 改为
  `github.com/Wei952766`** —— Tampermonkey 以 `@name + @namespace` 标识脚本，
  因此这一版会被视为新脚本：请先删除旧的 “ACS ASAP Reader”，再从
  README 的一键安装链接重新安装，否则会同时存在两份、在同一页面重复运行。

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
