# Journal Triage（中文）

[English](README.md) · **中文**

一个 Tampermonkey 用户脚本，把期刊列表页变成真正能扫读的样子：**图摘多列网格**、
**实时过滤**（标题 / 作者 / 摘要）、**关键词高亮**，以及**一键存入 Zotero 并附上全文 PDF**。

支持 **ACS**、**Wiley**、**Nature** 三大平台的列表页。界面中英双语。

## 安装

先装 [Tampermonkey](https://www.tampermonkey.net/)，然后：

👉 [**点此安装 journal-triage.user.js**](https://raw.githubusercontent.com/Wei952766/journal-triage/main/journal-triage.user.js)

首次保存时 Tampermonkey 会请求 `api.crossref.org`、`127.0.0.1`、`localhost`
的连接权限（Zotero 入库需要），选「始终允许」。

> 从旧版 **ACS ASAP Reader** 升级？**请先删掉它**。Tampermonkey 按脚本名识别，
> 否则两份会在 ACS 页面上同时运行。

## 覆盖范围

| 出版商 | 页面 | 图摘 | 摘要 |
|--------|------|------|------|
| ACS（`pubs.acs.org`）| ASAP 列表、期目录 | 页面自带 | 逐篇抓取 |
| Wiley（`onlinelibrary.wiley.com`）| Early View、期目录、期刊首页 | 页面自带 | 页面自带 |
| Nature（`nature.com`）| 文章列表、期刊首页 | 列表配图，自动升清晰度 | 页面自带 |

每个平台下的所有期刊都适用——JACS、ACS Catalysis、Nano Letters、Angew. Chem.、
Chem. Eur. J.、Adv. Mater.、Nature Chemistry、Nature Catalysis 等等。文章详情页不会被改动。

## 工具栏

| 控件 | 作用 |
|------|------|
| 卡片 / 列表 | 图摘网格 vs. 一行一篇的紧凑清单 |
| 列数 | 自动或 1–5 列，仅卡片视图可用 |
| 摘要 | 摘要显隐 |
| 关键词 | 编辑高亮词（逗号分隔）|
| 全部加载 | 抓完本页所有摘要——**过滤器要搜摘要正文必须先点**；页面本身带摘要时不显示此按钮 |
| EN / 中 | 切换界面语言 |
| `+ Zotero` | 单篇入库并附 PDF，见下节 |

视图、列数、摘要开关、关键词表、语言都存在 `localStorage`，跨会话保留。

### 它对列表页做了什么

- 把出版商的分段（RESEARCH ARTICLE、COMMUNICATION、按日期的批次）合并成一个
  连续网格，分段标题折叠成卡片上的小标签——包括值得一眼看到的
  **HOT PAPER** 和 **VERY IMPORTANT PAPER**。
- 解除出版商给内容栏设的宽度锁，收起旁边的推广栏，让网格占满整个窗口。

## Zotero 入库

需要 **Zotero 桌面版正在运行**。脚本打的是 `/connector/saveItems`，和 Zotero
浏览器插件同一个端点，随后再附上**全文 PDF**。

PDF 是在页内同源取的，因此带着你的机构订阅授权——这正是订阅文章能成功、
而 Zotero 自己下不到的原因。

元数据优先取 CrossRef。CrossRef 收录新 DOI **有 1–3 天延迟**，未收录时改用
列表页信息建条目，按钮显示 `✓ 已入库*` 并打 **`metadata-unverified`** 标签待核。
PDF 失败不影响条目本身：按钮只是显示 `✓ 已入库` 而非 `✓ 已入库 + PDF`，
tooltip 里给出原因。

<details>
<summary><b>为什么不复用 Zotero 插件的路径</b></summary>

已经是同一条路了——用的就是插件那个 `/connector/saveItems` 端点，差别只在元数据来源。
而在列表页上插件并不占优：它靠站点专用 translator，问 Zotero `getTranslators` 可见
**文章页**能匹配到专用 translator，而 **ACS 的 ASAP 列表页一个都匹配不到**
（只剩 unAPI / COinS / Embedded Metadata / DOI 这些通用兜底），因为 ACS 平台
不输出 `citation_*` meta 标签。列表页上插件只能退化成 DOI translator → 查 CrossRef
→ 撞上同样的延迟。

跑 translator 需要插件自带的 `Zotero.Translate` 沙箱，用户脚本复刻不了；
ACS 自家的 RIS 导出又被 Cloudflare 拦着。

</details>

<details>
<summary><b>从网页调 connector 的三个坑</b></summary>

- **带 `Origin` 的请求必须同时发 `X-Zotero-Connector-API-Version`**，否则 Zotero
  直接掐断连接——这是它阻止任意网站写入文献库的安全闸门。`GM_xmlhttpRequest` 必然
  附带 `Origin`，缺这个头就每次以 `network` 错误告终，换任何其他自定义头都无效。
  用 `curl` 测会误导：curl 不带 `Origin`，永远返回 201，掩盖真实浏览器必然遇到的失败。
- **`sessionID` 必须每次唯一**。Zotero 把它当保存会话标识，复用同一个 ID 第二次提交
  返回 409 且**静默丢弃条目**。
- **刚启动 Zotero 的头 1–2 分钟不要存**：connector 在数据库就绪前就会回 201，
  这段窗口里的保存会静默丢失。

</details>

## 实现说明

- **必须在页内跑**。这几个站点都有 Cloudflare，外部 `curl` 一律 403；但页面内的
  同源 `fetch(..., {credentials:'include'})` 带着你的会话走得通。这决定了方案只能
  是用户脚本。
- **站点适配器**。每个出版商声明列表各部分在哪、以及**页面本身已经提供了什么**；
  缺的才去文章页抓。出版商特有的布局修正留在各自适配器的 CSS 里，共用规则不引用
  任何出版商的类名。
- **`@grant GM_xmlhttpRequest`**。Zotero connector 不发 CORS 头，页面内普通 `fetch`
  打不通 `127.0.0.1:23119`。`127.0.0.1` 属于规范定义的「可信来源」，所以 HTTPS 页面
  调它不触发 mixed-content 拦截。
- **缓存**按 DOI 存进 `localStorage`，30 天 TTL。图片的 CDN URL 带签名（`Expires=`），
  过期的重新抓；配额满时丢掉最老的一半而不是整个缓存失效。
- **高亮只走文本节点**，所以化学标题里的 `<sub>` / `<sup>` 不会被破坏。

## 已知边界

- 只处理当前页；翻页后需重新点「全部加载」。
- ACS 搜索结果页用的是第三套标记，未支持。
- 出版商会改前端。某个列表页突然不渲染了，先查对应站点适配器里的选择器。

## 免责声明

脚本只在你自己的浏览器里、用你自己的登录态重排出版商已经返回的内容，
不绕过任何访问控制，也不批量下载。抓取并发限制为 3。

## License

[MIT](LICENSE) © Wei952766
