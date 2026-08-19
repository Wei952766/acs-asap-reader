# ACS ASAP Reader

**English** · [中文](README.zh-CN.md)

A Tampermonkey userscript that makes the redesigned ACS Publications
(Silverchair) ASAP listings scannable again — it restores the missing
**graphical abstracts**, inlines **abstracts**, unlocks a **multi-column
grid**, adds **live filtering / keyword highlighting**, and saves papers to
**Zotero** in one click. UI available in English and 中文.

## The problem

After ACS migrated to Silverchair in 2026, the ASAP listing lost its
graphical abstracts, abstracts have to be expanded one article at a time,
and the centre column is pinned at 1300px — so only a couple of papers fit
on screen. ACS's own site notice concedes that graphical abstracts and RSS
feeds are still being worked on.

This script patches the listing page in place:

- **Graphical abstracts restored** — lazily fetches `div.graphical-abstract`
  from each article page and puts the image back at the top of the card
- **Abstracts inlined** — the same request also grabs `section.abstract`,
  rendered under the title (click to expand)
- **Card / list views** — card view lifts the 1300px width cap and hides the
  empty 300px right-hand ad rail
- **Adjustable columns** — auto or a fixed 1–5; at 1–2 columns the native
  width is restored, since full-bleed cards are hard to read
- **Live filter** — title / authors / abstract, space-separated terms are ANDed
- **Keyword highlighting** — matches get an orange marker; the term list is
  editable from the toolbar
- **One-click Zotero save** — a `+ Zotero` button on every card
- **Bilingual UI** — follows the browser language on first run, with a
  `EN / 中` toggle in the toolbar that is remembered

## Install

Install [Tampermonkey](https://www.tampermonkey.net/) first
(Chrome / Edge / Firefox / Safari).

**One click** (recommended — the script declares `@updateURL`, so Tampermonkey
will check for updates afterwards):

👉 [**Install acs-asap-reader.user.js**](https://raw.githubusercontent.com/Wei952766/acs-asap-reader/main/acs-asap-reader.user.js)

Tampermonkey intercepts the link and shows its install page; click Install.

**Manually**: Tampermonkey dashboard → Create a new script → replace the
editor contents with `acs-asap-reader.user.js` → save.

> On macOS, if you copy the script with `pbcopy`, force a UTF-8 locale or the
> non-ASCII UI strings turn into mojibake:
> `LC_CTYPE=UTF-8 pbcopy < acs-asap-reader.user.js`

On first save Tampermonkey asks permission to connect to `api.crossref.org`,
`127.0.0.1` and `localhost` (needed for Zotero saving) — choose "Always allow".

Then open <https://pubs.acs.org/jacsat/latest-articles>.

### Scope

Runs on any `pubs.acs.org` page containing `div.al-article-box` — so besides
JACS, it also covers ASAP listings, issue tables of contents and search
results for **every ACS journal** (ACS Catalysis, Nano Letters, ACS Nano, …).
*Angew. Chem. is a Wiley title and is not on this platform, so it is out of scope.*

## Toolbar

| Control | What it does |
|---------|--------------|
| Cards / List | Graphical-abstract grid vs. a dense one-line-per-paper list |
| Columns | Auto or 1–5; card view only, greyed out in list view |
| Abstracts | Show/hide abstracts (works in both views) |
| Keywords | Opens the highlight-term editor (comma-separated) |
| Load all | Fetches all 50 abstracts on the page — **required before the filter can search abstract text** |
| EN / 中 | Switches the interface language |
| `+ Zotero` | Saves that paper, see below |

The filter only matches abstract text that has actually been fetched. "Load
all" pulls the whole page in about 15–20 s (concurrency 3; cached entries
return instantly).

View, column count, abstract visibility, keyword list and language persist in
`localStorage`.

## Zotero saving

Requires the **Zotero desktop app to be running**. The script posts to
`/connector/saveItems`, the same endpoint the official Zotero connector uses.

Metadata comes from CrossRef where possible. CrossRef registers ASAP DOIs with a
**1–3 day lag**, so for the newest articles the item is built from the listing's
title / authors / date instead — the button shows `✓ Saved*` and the item is
tagged **`metadata-unverified`** (author names are split on "last token is the
family name", which is wrong for compound surnames). CrossRef usually has no
abstract for ACS articles, so the scraped one is always used as a fallback.

Use this button to triage the listing; use the Zotero connector on an individual
article page when you want the richest metadata plus PDF and snapshot.

<details>
<summary><b>Why not just reuse the connector's route?</b></summary>

It already is the same route — the same `/connector/saveItems` endpoint. Only the
metadata source differs.

The connector relies on site-specific translators. Asking Zotero's
`getTranslators`: an **article page** matches `Silverchair` and `Atypon Journals`,
so the extension works well there — but the **ASAP listing matches none of them**
(only the generic unAPI / COinS / Embedded Metadata / DOI fallbacks), because the
new ACS platform strips every `citation_*` and `dc.*` meta tag and ships no
JSON-LD. On the listing the extension degrades to the DOI translator → CrossRef →
the same lag.

Running those translators needs the extension's `Zotero.Translate` sandbox, which
a userscript cannot reproduce, and ACS's own RIS export
(`/Citation/Download`) is behind Cloudflare and returns 403.

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

- **Must run in the page.** pubs.acs.org sits behind Cloudflare — an external
  `curl` always gets 403 — but a same-origin
  `fetch(..., {credentials: 'include'})` from the page works, carrying your
  session. That is why this is a userscript and not a scraper.
- **`@grant GM_xmlhttpRequest`.** The Zotero connector sends no CORS headers
  (an `OPTIONS` returns 200 with no `Access-Control-Allow-Origin`), so an
  ordinary page `fetch` cannot reach `127.0.0.1:23119`; Tampermonkey's
  `GM_xmlhttpRequest` bypasses that. `127.0.0.1` counts as a
  potentially-trustworthy origin, so an HTTPS page calling it is not blocked as
  mixed content. Graphical abstracts and abstracts still use same-origin `fetch`.
- **Cache** keyed by DOI in `localStorage`, 30-day TTL. Graphical-abstract CDN
  URLs are signed (`Expires=`), so the expiry is parsed and stale entries are
  refetched. On quota errors the oldest half is dropped rather than losing the
  whole cache.
- **Highlighting walks text nodes only**, so `<sub>`/`<sup>` in chemical titles
  survive intact.
- **UI strings live in one `I18N` dictionary**; Zotero button labels are derived
  from a `data-state` attribute so switching language relabels buttons that
  already show a result without losing it.

## Known limitations

- Handles the current page of 50 articles; after paging you need to press
  "Load all" again.
- The few articles without a Visual Abstract (mostly Editorials / Corrections)
  simply collapse the image slot.
- If ACS changes its front-end class names (`al-article-box`,
  `graphical-abstract`, `section.abstract`), the selectors need updating.

## Disclaimer

The script only rearranges content that ACS has already returned to your own
browser under your own session. It bypasses no access control and performs no
bulk full-text downloading; fetches are throttled to a concurrency of 3.

## License

[MIT](LICENSE) © Wei952766
