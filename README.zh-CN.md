# ACS ASAP Reader（中文）

[English](README.md) · **中文**

一个 Tampermonkey 用户脚本，用来救 ACS 新版（Silverchair 平台）的 ASAP 列表页。

## 解决什么问题

ACS 2026 年迁到 Silverchair 后，ASAP 列表页去掉了 graphical abstract，摘要要一篇篇点开，
中间栏被锁死在 1300px，一屏看不了几篇。站点自己的公告也承认 graphical abstracts 和 RSS
仍在修复中。

这个脚本在列表页原地补回：

- **图摘复活** — 懒加载每篇文章页的 `div.graphical-abstract` 图片，塞回卡片顶部
- **摘要内联** — 同一次请求顺便抓 `section.abstract`，直接铺在标题下（点击展开全文）
- **卡片 / 列表双视图** — 卡片视图解除 ACS 的 1300px 宽度锁，并收掉右侧 300px 广告位
- **列数可调** — 自动 / 1–5 列任选，选 1–2 列时恢复原生宽度（否则卡片过宽难读）
- **实时过滤** — 标题 / 作者 / 摘要全文，空格分隔多词按 AND
- **关键词高亮** — 命中的论文左侧橙色标记，默认词表可在工具栏里改
- **一键入库 Zotero** — 每张卡片一个 `+ Zotero` 按钮

## 安装

先装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox / Safari）。

**一键安装**（推荐，脚本头里带 `@updateURL`，之后能自动检查更新）：

👉 [**点此安装 acs-asap-reader.user.js**](https://raw.githubusercontent.com/Wei952766/acs-asap-reader/main/acs-asap-reader.user.js)

Tampermonkey 会拦截这个链接并弹出安装页，点 Install 即可。

**手动安装**：Tampermonkey 面板 → Create a new script → 用
`acs-asap-reader.user.js` 全文覆盖编辑器内容 → ⌘S 保存。

> macOS 下如果用 `pbcopy` 拷贝脚本，务必带 UTF-8 locale，否则中文界面会变乱码：
> `LC_CTYPE=UTF-8 pbcopy < acs-asap-reader.user.js`

装好后首次保存时，Tampermonkey 会请求 `api.crossref.org`、`127.0.0.1`、`localhost`
的连接权限（Zotero 入库需要），选「始终允许」。

打开 <https://pubs.acs.org/jacsat/latest-articles> 验证。

### 适用范围

生效于 `pubs.acs.org` 下任何出现 `div.al-article-box` 的页面 —— 除 JACS 外，
ACS Catalysis、Nano Letters、ACS Nano 等**所有 ACS 期刊**的 ASAP 页、
期刊目录页、检索结果页都能用。（Angew. Chem. 是 Wiley 的刊，不在 ACS 平台上，用不了。）

## 用法要点

| 控件 | 作用 |
|------|------|
| 卡片 / 列表 | 图摘网格 vs. 一行一篇的紧凑清单 |
| 列数下拉 | 自动 / 1–5 列，仅卡片视图可用，列表视图下自动置灰 |
| 摘要 | 摘要显隐（两种视图下都生效）|
| 关键词 | 展开高亮词编辑框，逗号分隔 |
| 全部加载 | 抓完本页 50 篇，**过滤器要搜摘要正文必须先点这个** |
| + Zotero | 单篇入库，见下节 |

过滤器默认只能搜到已经滚动到、加载过的卡片的摘要。点「全部加载」约 15–20 秒抓完一整页
（并发 3，缓存命中的会秒回）。

视图、摘要开关、关键词表存在 localStorage，跨会话保留。

## Zotero 一键入库

需要 **Zotero 桌面版正在运行**。脚本打的是 `/connector/saveItems`，和 Zotero
浏览器插件同一个端点。

元数据优先取 CrossRef。CrossRef 收录 ASAP 的 DOI **有 1–3 天延迟**，未收录时改用
列表页的标题/作者/日期建条目，按钮显示 `✓ 已入库*` 并打 **`metadata-unverified`**
标签待核（作者按"最后一个词是姓"切分，复姓会错）。CrossRef 的 ACS 摘要常缺失，
一律用页面抓到的摘要补上。

**全文 PDF 也会一并附上**。脚本在页内同源取 PDF，因此带着你的机构订阅授权——
这正是订阅文章能成功、而 Zotero 自己下不到的原因。PDF 失败不影响条目本身：
按钮只是显示 `✓ 已入库` 而非 `✓ 已入库 + PDF`，tooltip 里给出原因。

列表页批量扫读用这个按钮；还想要网页快照的话，在单篇文章页用 Zotero 插件。

<details>
<summary><b>为什么不复用 Zotero 插件的路径</b></summary>

已经是同一条路了——用的就是插件那个 `/connector/saveItems` 端点，差别只在元数据来源。

插件靠站点专用 translator。问 Zotero `getTranslators`：**文章页**能匹配到
`Silverchair` / `Atypon Journals`，插件在那儿很好用；但 **ASAP 列表页一个都匹配不到**
（只剩 unAPI / COinS / Embedded Metadata / DOI 这些通用兜底），因为新版 ACS 把
`citation_*`、`dc.*` meta 标签和 JSON-LD 全删了——插件在列表页只能退化成
DOI translator → 查 CrossRef → 撞上同样的延迟。

跑 translator 需要插件自带的 `Zotero.Translate` 沙箱，用户脚本复刻不了；
ACS 自家的 RIS 导出（`/Citation/Download`）又被 Cloudflare 拦成 403。

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

- **必须在页内跑**：pubs.acs.org 有 Cloudflare，外部 `curl` 一律 403；但页面内的同源
  `fetch(..., {credentials:'include'})` 带着 cookie 走得通。这也是做成用户脚本而不是
  抓取器的原因。
- **`@grant GM_xmlhttpRequest`** —— Zotero connector **不发任何 CORS 头**（实测 OPTIONS 返回 200
  但没有 `Access-Control-Allow-Origin`），所以页面内的普通 `fetch` 打不通 `127.0.0.1:23119`，
  必须用 Tampermonkey 的 `GM_xmlhttpRequest` 绕过。`127.0.0.1` 属于规范定义的"可信来源"，
  所以 HTTPS 页面调它不会触发 mixed-content 拦截。抓图摘和摘要仍走同源 `fetch`。
- **缓存**：按 DOI 存进 localStorage，30 天 TTL。图摘的 CDN URL 带签名（`Expires=`），
  脚本会解析过期时间，过期的重新抓。配额满时丢掉最老的一半而不是整个缓存失效。
- **高亮只走文本节点**，所以化学标题里的 `<sub>` / `<sup>` 不会被破坏。

## 已知边界

- 只处理当前页 50 篇；翻页后需要重新点「全部加载」。
- 极少数没有 Visual Abstract 的文章（多为 Editorial / Correction）图位自动收起。
- ACS 若再改前端类名（`al-article-box`、`graphical-abstract`、`section.abstract`），
  需要同步更新选择器。

## 免责声明

脚本只在你自己的浏览器里、用你自己的登录态重排 ACS 页面已经返回的内容，
不绕过任何访问控制，也不批量下载全文。抓取节流为并发 3。

## License

[MIT](LICENSE) © Wei952766
