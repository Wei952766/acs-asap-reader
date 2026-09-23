# Journal Triage

**English** · [中文](README.zh-CN.md)

A Tampermonkey userscript that turns journal listings into something you can
actually scan: a **multi-column grid** of graphical abstracts, **live filtering**
over title / authors / abstract, **keyword highlighting**, and **one-click Zotero
saving with the full-text PDF**.

Works on **ACS**, **Wiley** and **Nature** listings. UI in English and 中文.

## Install

Install [Tampermonkey](https://www.tampermonkey.net/), then:

👉 [**Install journal-triage.user.js**](https://raw.githubusercontent.com/Wei952766/journal-triage/main/journal-triage.user.js)

On first save Tampermonkey asks permission to connect to `api.crossref.org`,
`127.0.0.1` and `localhost` (needed for Zotero saving) — choose "Always allow".

> Replacing the older **ACS ASAP Reader**? Delete it first. Tampermonkey
> identifies scripts by name, so the two will otherwise both run on ACS pages.

## Where it runs

| Publisher | Pages | Graphical abstracts | Abstracts |
|-----------|-------|---------------------|-----------|
| ACS (`pubs.acs.org`) | ASAP listings, issue TOCs | from the page | fetched per article |
| Wiley (`onlinelibrary.wiley.com`) | Early View, issue TOCs, journal home | from the page | from the page |
| Nature (`nature.com`) | article listings, journal home | listing image, upscaled | from the page |

Every journal on each platform is covered — JACS, ACS Catalysis, Nano Letters,
Angew. Chem., Chem. Eur. J., Adv. Mater., Nature Chemistry, Nature Catalysis and
the rest. Article pages are left alone.

## Toolbar

| Control | What it does |
|---------|--------------|
| Cards / List | Graphical-abstract grid vs. a dense one-line-per-paper list |
| Columns | Auto or 1–5; card view only |
| Abstracts | Show/hide abstracts |
| Keywords | Edit the highlight terms (comma-separated) |
| Load all | Fetches every abstract on the page — **needed before the filter can search abstract text**, and only shown where abstracts aren't already on the page |
| EN / 中 | Switches the interface language |
| `+ Zotero` | Saves that paper with its PDF, see below |

View, column count, abstract visibility, keyword list and language persist in
`localStorage`.

### What it does to a listing

- Merges the publisher's section bands (RESEARCH ARTICLE, COMMUNICATION, date
  batches) into one continuous grid, and folds the labels into per-card badges —
  including the ones worth noticing, like **HOT PAPER** and **VERY IMPORTANT PAPER**.
- Lifts the width caps publishers put on their content column, and hides the
  promo rail beside it, so the grid gets the whole window.

## Zotero saving

Requires the **Zotero desktop app to be running**. The script posts to
`/connector/saveItems`, the same endpoint the official Zotero connector uses,
then attaches the **full-text PDF**.

The PDF is fetched same-origin from the page, so it carries your institutional
entitlement — which is why this works for subscribed articles that Zotero could
not download on its own.

Metadata comes from CrossRef where possible. CrossRef registers new DOIs with a
**1–3 day lag**, so for the newest articles the item is built from the listing
instead — the button shows `✓ Saved*` and the item is tagged
**`metadata-unverified`**. A failed PDF never blocks the item: the button reads
`✓ Saved` instead of `✓ Saved + PDF` and the tooltip says why.

<details>
<summary><b>Why not just reuse the Zotero connector?</b></summary>

It already is the same route — the same `/connector/saveItems` endpoint. Only the
metadata source differs, and on a listing page the extension is not better off:
it relies on site-specific translators, and asking Zotero's `getTranslators`
shows that an **article page** matches one while an **ACS ASAP listing matches
none** (only the generic unAPI / COinS / Embedded Metadata / DOI fallbacks),
because the ACS platform ships no `citation_*` meta tags. On the listing the
extension degrades to the DOI translator → CrossRef → the same lag.

Running those translators needs the extension's `Zotero.Translate` sandbox, which
a userscript cannot reproduce, and ACS's own RIS export is behind Cloudflare.

</details>

<details>
<summary><b>Three gotchas when calling the connector from a page</b></summary>

- **A request carrying `Origin` must also send `X-Zotero-Connector-API-Version`**,
  or Zotero silently closes the connection — the gate that stops arbitrary
  websites from writing to your library. `GM_xmlhttpRequest` always sends
  `Origin`, so without the header every save fails with a bare `network` error,
  and no other custom header substitutes. Testing with `curl` is misleading: it
  sends no `Origin`, always returns 201, and hides the failure a real browser hits.
- **`sessionID` must be unique per save.** Zotero treats it as a save-session key;
  reusing one makes later saves return 409 and be **silently dropped**.
- **Don't save in the first minute or two after launching Zotero.** The connector
  answers 201 before its database is ready, and saves in that window vanish.

</details>

## Implementation notes

- **It has to run in the page.** These sites sit behind Cloudflare — an external
  `curl` gets 403 — but a same-origin `fetch(..., {credentials: 'include'})` from
  the page works, carrying your session. That is why this is a userscript.
- **Site adapters.** Each publisher declares where the parts of a listing live and
  which pieces it already renders; anything missing is fetched from the article
  page. Publisher-specific layout fixes stay in that adapter's own CSS, so the
  shared rules never reference a publisher's class names.
- **`@grant GM_xmlhttpRequest`.** The Zotero connector sends no CORS headers, so an
  ordinary page `fetch` cannot reach `127.0.0.1:23119`. `127.0.0.1` counts as a
  potentially-trustworthy origin, so an HTTPS page calling it is not blocked as
  mixed content.
- **Cache** keyed by DOI in `localStorage`, 30-day TTL. Signed CDN image URLs are
  re-fetched once their `Expires=` passes; on quota errors the oldest half is
  dropped rather than losing the whole cache.
- **Highlighting walks text nodes only**, so `<sub>`/`<sup>` in chemical titles
  survive intact.

## Known limitations

- Handles the current page of results; after paging you press "Load all" again.
- ACS search results use a third markup variant and are not covered.
- Publishers change their front-end. When a listing stops rendering, the selectors
  in that site's adapter are the place to look.

## Disclaimer

The script only rearranges content the publisher has already returned to your own
browser under your own session. It bypasses no access control and performs no
bulk downloading; fetches are throttled to a concurrency of 3.

## License

[MIT](LICENSE) © Wei952766
