// ==UserScript==
// @name         Journal Triage
// @namespace    github.com/Wei952766
// @version      2.0.0
// @description  Make journal listings scannable: multi-column grid, live filtering, keyword highlighting and one-click Zotero saving with the full-text PDF. Restores graphical abstracts and abstracts on ACS, which strips them. Works on ACS, Wiley and Nature. Bilingual EN/中文.
// @author       Wei952766
// @license      MIT
// @match        https://pubs.acs.org/*
// @match        https://onlinelibrary.wiley.com/*
// @match        https://www.nature.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api.crossref.org
// @connect      127.0.0.1
// @connect      localhost
// @homepageURL  https://github.com/Wei952766/journal-triage
// @supportURL   https://github.com/Wei952766/journal-triage/issues
// @downloadURL  https://raw.githubusercontent.com/Wei952766/journal-triage/main/journal-triage.user.js
// @updateURL    https://raw.githubusercontent.com/Wei952766/journal-triage/main/journal-triage.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '2.0.0';

  // ------------------------------------------------------------------ sites
  // Each adapter describes where the parts of a listing live, and declares
  // which pieces the publisher already renders. ACS is the outlier: its
  // Silverchair rebuild dropped graphical abstracts and abstracts from the
  // listing, so those have to be pulled from each article page.
  const SITES = [
    {
      id: 'acs',
      host: /(^|\.)pubs\.acs\.org$/,
      item: 'div.al-article-box',
      list: '.al-article-list-group',
      title: 'h5.al-title',
      link: 'h5.al-title a',
      authors: '.al-authors-list .wi-fullname',
      date: '.al-pub-date',
      actionBar: '.badge-bar .resource-links-info',
      abstract: { mode: 'fetch', sel: 'section.abstract' },
      graphic: { mode: 'fetch', sel: '.graphical-abstract img' },
      doi: ({ href }) => (href.match(/\/doi\/(10\.\d{4,9}\/[^/?#]+)/) || [])[1],
      pdf: ({ el }) => el.querySelector('a.article-pdfLink, a.al-link.pdf')?.getAttribute('href') || '',
      css: `
        /* ACS caps these wrappers at 1300px and parks a 300px ad rail beside them */
        body.jt-grid .page-column-wrap, body.jt-grid .issue-browse_content { max-width: none }
        body.jt-grid .page-column--right { display: none }
        body.jt-grid .issue-browse_content { grid-template-columns: 1fr }
        body.jt-grid.jt-narrow .page-column-wrap,
        body.jt-grid.jt-narrow .issue-browse_content { max-width: 1300px }
        .jt-list > .inlist-ad-wrapper { display: none }
        .jt-item .badge-bar { margin: 6px 0 0 }
        .jt-item .badge-bar .resource-links-info { display: flex; flex-wrap: wrap; gap: 10px; align-items: center }
        .jt-item .badge-bar .item { margin: 0 !important; padding: 0 !important; border: 0 !important }
        .jt-item .badge-bar a { font-size: 11px !important; padding: 0 !important; border: 0 !important;
          background: none !important; text-decoration: underline }
        .jt-item .badge-bar .item:has(a.SupplementaryDataLink) { display: none }
        .jt-item .al-expanded-section { display: none }`,
    },
    {
      id: 'wiley',
      host: /(^|\.)onlinelibrary\.wiley\.com$/,
      item: 'div.issue-item',
      list: '.issue-items-container',
      title: '.issue-item__title',
      link: 'a.issue-item__title',
      authors: '.loa .comma__item',
      date: '.ePubDate',
      actionBar: null,                       // no natural row; the button is appended
      abstract: { mode: 'native', sel: '.toc-item__abstract' },
      graphic: { mode: 'native', sel: 'img' },
      doi: ({ href }) => (href.match(/\/doi\/(?:abs\/|full\/|epdf\/)?(10\.\d{4,9}\/[^/?#]+)/) || [])[1],
      // /doi/pdf/ serves the reader shell, not a PDF; pdfdirect serves the file.
      pdf: ({ doi }) => (doi ? `/doi/pdfdirect/${doi}` : ''),
      css: `
        /* Wiley pins the list into a 720px Bootstrap column beside a promo rail */
        body.jt-grid .container:has(.main-content) { max-width: none; width: auto }
        body.jt-grid .main-content.col-md-8 { width: 100%; float: none }
        body.jt-grid .main-content.col-md-8 ~ .col-md-4 { display: none }
        body.jt-grid.jt-narrow .container:has(.main-content) { max-width: 1080px }
        body.jt-grid.jt-narrow .main-content.col-md-8 { width: 66.66% }
        body.jt-grid.jt-narrow .main-content.col-md-8 ~ .col-md-4 { display: block }
        /* section labels are siblings of the cards inside the grid */
        body.jt-grid .jt-list > .toc__heading { grid-column: 1 / -1; margin: 10px 0 0 }
        body.jt-grid .issue-items-container { padding: 0 }
        .jt-item .issue-item__footer, .jt-item .issue-item__links { display: none }`,
    },
    {
      id: 'nature',
      host: /(^|\.)nature\.com$/,
      item: 'article, li.app-article-list-row__item',
      list: '.app-article-list-row, ul.app-article-list-row',
      title: 'h3, h2',
      link: 'a[href*="/articles/"]',
      authors: '.c-author-list li, li[itemprop="creator"]',
      date: 'time',
      actionBar: null,
      abstract: { mode: 'native', sel: '.c-card__summary, [data-test="article-description"]' },
      // The listing thumbnail is a cropped teaser, not a graphical abstract.
      graphic: { mode: 'none' },
      doi: ({ href }) => {
        const id = (href.match(/\/articles\/([^/?#]+)/) || [])[1];
        return id ? '10.1038/' + id : undefined;
      },
      pdf: ({ href }) => {
        const id = (href.match(/\/articles\/([^/?#]+)/) || [])[1];
        return id ? `/articles/${id}.pdf` : '';
      },
      css: `
        body.jt-grid .c-article-list, body.jt-grid .app-article-list-row { display: contents }
        .jt-item .c-card__image { display: none }`,
    },
  ];

  const SITE = SITES.find(s => s.host.test(location.hostname) && document.querySelector(s.item));
  if (!SITE) return;

  const items = [...document.querySelectorAll(SITE.item)]
    .filter(el => el.querySelector(SITE.link));
  if (!items.length) return;

  // --------------------------------------------------------------- settings
  const LS = {
    get(k, fallback) {
      try { const v = localStorage.getItem('jt.' + k); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(k, v) { try { localStorage.setItem('jt.' + k, JSON.stringify(v)); } catch (e) {} },
  };

  const state = {
    view: LS.get('view', 'grid'),
    showAbs: LS.get('showAbs', true),
    keywords: LS.get('keywords', ['enzyme', 'biocatalysis', 'protein design', 'catalysis']),
    cols: LS.get('cols', 'auto'),
    lang: LS.get('lang', /^zh/i.test(navigator.language || '') ? 'zh' : 'en'),
    query: '',
  };

  const I18N = {
    zh: {
      other: 'EN', otherTitle: 'Switch to English',
      grid: '卡片', compact: '列表',
      colsTitle: '卡片视图的列数', colsAuto: '自动列数', colsN: n => `${n} 列`,
      abs: '摘要', kw: '关键词',
      all: '全部加载', allTitle: '抓取本页全部文章的摘要，让过滤能搜到摘要正文',
      loading: (d, t) => `加载中 ${d}/${t}`,
      filterPh: '过滤：标题/作者/摘要（空格 = AND）',
      kwLabel: '高亮词（逗号分隔）：',
      count: (n, t) => `${n} / ${t} 篇`,
      zotAdd: '+ Zotero', zotOk: '✓ 已入库', zotOkScraped: '✓ 已入库*', zotFail: '✗ 失败',
      zotBusyPdf: 'PDF…',
      zotPdfOk: 'PDF 已附加', zotPdfNone: '未附加 PDF',
      zotViaCrossref: 'CrossRef 元数据',
      zotViaPage: 'CrossRef 尚未收录此 DOI，元数据取自页面，已打 metadata-unverified 标签待核',
      zotErr: e => `Zotero 没在运行？先打开 Zotero 桌面版再试。(${e})`,
    },
    en: {
      other: '中', otherTitle: '切换到中文',
      grid: 'Cards', compact: 'List',
      colsTitle: 'Columns in card view', colsAuto: 'Auto columns',
      colsN: n => `${n} column${n === '1' ? '' : 's'}`,
      abs: 'Abstracts', kw: 'Keywords',
      all: 'Load all', allTitle: 'Fetch every abstract on this page so the filter can search their full text',
      loading: (d, t) => `Loading ${d}/${t}`,
      filterPh: 'Filter: title / authors / abstract (space = AND)',
      kwLabel: 'Highlight terms (comma-separated):',
      count: (n, t) => `${n} / ${t} papers`,
      zotAdd: '+ Zotero', zotOk: '✓ Saved', zotOkScraped: '✓ Saved*', zotFail: '✗ Failed',
      zotBusyPdf: 'PDF…',
      zotPdfOk: 'PDF attached', zotPdfNone: 'no PDF attached',
      zotViaCrossref: 'Metadata from CrossRef',
      zotViaPage: 'DOI not in CrossRef yet; metadata scraped from the page and tagged metadata-unverified',
      zotErr: e => `Is Zotero running? Open the Zotero desktop app and retry. (${e})`,
    },
  };
  const t = (k, ...a) => {
    const v = I18N[state.lang][k];
    return typeof v === 'function' ? v(...a) : v;
  };

  function debounce(fn, ms) {
    let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
  }

  // ------------------------------------------------------------------ cache
  const CACHE_KEY = 'cache';
  let cache = LS.get(CACHE_KEY, {});
  const CACHE_TTL = 30 * 24 * 3600 * 1000;
  let cacheDirty = false;

  function writeCache() {
    if (!cacheDirty) return;
    const cutoff = Date.now() - CACHE_TTL;
    for (const k of Object.keys(cache)) if (!cache[k].t || cache[k].t < cutoff) delete cache[k];
    try {
      localStorage.setItem('jt.' + CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      const byAge = Object.keys(cache).sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0));
      byAge.slice(0, Math.ceil(byAge.length / 2)).forEach(k => delete cache[k]);
      try { localStorage.setItem('jt.' + CACHE_KEY, JSON.stringify(cache)); } catch (e2) {}
    }
    cacheDirty = false;
  }
  const flushCache = debounce(writeCache, 2000);
  addEventListener('pagehide', writeCache);

  // ------------------------------------------------------------------ style
  const css = `
  .jt-bar{position:sticky;top:0;z-index:900;display:flex;flex-wrap:wrap;gap:8px;align-items:center;
    padding:8px 12px;margin:0 0 14px;background:#fff;border:1px solid #d5d9e0;border-radius:8px;
    box-shadow:0 2px 6px rgba(0,0,0,.08);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a1a1a}
  .jt-bar button{flex:0 0 auto;width:auto;height:auto;margin:0;padding:4px 10px;border:1px solid #c3c9d2;border-radius:6px;background:#f7f8fa;cursor:pointer;font-size:12px;color:#1a1a1a}
  .jt-bar button.on{background:#00558c;border-color:#00558c;color:#fff}
  .jt-bar input[type=text]{padding:4px 8px;border:1px solid #c3c9d2;border-radius:6px;font-size:12px;
    min-width:180px;width:auto;flex:1 1 220px;height:auto;margin:0;display:inline-block;box-sizing:border-box}
  .jt-bar select{padding:4px 6px;border:1px solid #c3c9d2;border-radius:6px;background:#f7f8fa;font-size:12px;
    cursor:pointer;width:auto;flex:0 0 auto;height:auto;margin:0;display:inline-block;box-sizing:border-box}
  .jt-bar select:disabled{opacity:.45;cursor:default}
  .jt-bar .jt-count{margin-left:auto;color:#5a6472;font-size:12px;white-space:nowrap}
  .jt-bar .jt-sep{width:1px;height:20px;background:#dde1e6}
  .jt-kw-row{flex-basis:100%;display:none;gap:6px;align-items:center}
  .jt-kw-row.open{display:flex}
  .jt-kw-row input{flex:1 1 auto;width:auto}

  body.jt-grid .jt-list{display:grid;gap:16px;
    grid-template-columns:var(--jt-cols, repeat(auto-fill, minmax(330px, 1fr)))}
  body.jt-grid .jt-item{border:1px solid #e0e4e9;border-radius:8px;padding:12px;margin:0;background:#fff;
    max-width:none;width:auto;float:none}
  body.jt-grid .jt-item .jt-title{font-size:15px;line-height:1.35;margin:6px 0}
  body.jt-grid .jt-ga img{max-height:160px}

  body.jt-compact .jt-item{border:0;border-bottom:1px solid #eceff2;padding:6px 0;margin:0}
  body.jt-compact .jt-item .jt-title{font-size:14px;line-height:1.3;margin:2px 0}
  body.jt-compact .jt-ga{display:none}

  .jt-ga{margin:2px 0 6px;min-height:4px}
  .jt-ga img{width:100%;max-height:220px;object-fit:contain;background:#fafbfc;border:1px solid #eceff2;border-radius:6px;cursor:zoom-in}
  .jt-ga.jt-empty{display:none}
  .jt-abs{font-size:12px;line-height:1.5;color:#3c4450;margin:6px 0 2px;
    max-height:6.4em;overflow:hidden;position:relative;cursor:pointer}
  .jt-abs.open{max-height:none}
  .jt-abs:not(.open)::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.6em;
    background:linear-gradient(rgba(255,255,255,0),#fff)}
  .jt-abs:empty{display:none}
  .jt-hidden{display:none !important}
  .jt-hit{box-shadow:inset 3px 0 0 #e8a33d}
  body.jt-grid .jt-item.jt-hit{border-color:#e8a33d}
  .jt-abs mark, .jt-title mark{background:#ffe9a8;color:inherit;padding:0 1px;border-radius:2px}
  .jt-spin{display:inline-block;width:11px;height:11px;border:2px solid #d5d9e0;border-top-color:#00558c;
    border-radius:50%;animation:jtspin .7s linear infinite;vertical-align:-1px}
  @keyframes jtspin{to{transform:rotate(360deg)}}

  button.jt-zot{font-size:11px;padding:1px 7px;border:1px solid #b23c2e;border-radius:4px;
    background:#fff;color:#b23c2e;cursor:pointer;line-height:1.6;margin-top:6px}
  button.jt-zot:hover:not(:disabled){background:#b23c2e;color:#fff}
  button.jt-zot:disabled{cursor:default;opacity:.9}
  button.jt-zot.ok{border-color:#2e7d4f;color:#2e7d4f;background:#f2f9f5}
  button.jt-zot.err{border-color:#b23c2e;color:#fff;background:#b23c2e}

  .jt-lightbox{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;
    align-items:center;justify-content:center;cursor:zoom-out}
  .jt-lightbox img{max-width:92vw;max-height:92vh;background:#fff;border-radius:6px}
  ` + (SITE.css || '');
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  // ------------------------------------------------------------------ cards
  // Own classes go on the publisher's elements so every rule above is
  // site-agnostic; anything publisher-specific lives in SITE.css.
  const listEl = (SITE.list && items[0].closest(SITE.list)) || items[0].parentElement;
  listEl.classList.add('jt-list');

  const cards = items.map((el) => {
    el.classList.add('jt-item');
    const link = el.querySelector(SITE.link);
    const href = link.getAttribute('href') || '';
    const titleEl = el.querySelector(SITE.title) || link;
    titleEl.classList.add('jt-title');

    const ctx = { el, href, link };
    const doi = SITE.doi(ctx) || href;
    ctx.doi = doi;

    const ga = document.createElement('div');
    ga.className = 'jt-ga jt-empty';
    const abs = document.createElement('div');
    abs.className = 'jt-abs';
    abs.addEventListener('click', () => abs.classList.toggle('open'));

    // Native pieces are adopted in place; fetched ones get empty slots to fill.
    // Read everything before removing anything -- on Wiley the graphic sits
    // inside the abstract container, so removing that first would take it too.
    const absNode = SITE.abstract.mode === 'native' ? el.querySelector(SITE.abstract.sel) : null;
    const imgNode = SITE.graphic.mode === 'native' ? el.querySelector(SITE.graphic.sel) : null;
    const nativeAbs = absNode ? absNode.textContent.replace(/\s+/g, ' ').trim() : '';
    const nativeGa = imgNode
      ? (imgNode.getAttribute('src') || imgNode.getAttribute('data-src') || '') : '';

    if (nativeGa) {
      ga.classList.remove('jt-empty');
      ga.appendChild(mkImage(new URL(nativeGa, location.origin).href));
    }
    if (absNode) absNode.remove();
    if (imgNode && imgNode.isConnected) {
      (imgNode.closest('figure, picture, .issue-item__image') || imgNode).remove();
    }

    titleEl.parentElement.insertBefore(ga, titleEl);
    titleEl.after(abs);
    if (nativeAbs) abs.textContent = nativeAbs;

    const card = {
      el, href, doi, ga, abs, link,
      loaded: SITE.abstract.mode === 'native' && SITE.graphic.mode !== 'fetch',
      title: (titleEl.textContent || '').replace(/\s+/g, ' ').trim(),
      authors: [...el.querySelectorAll(SITE.authors)].map(a => a.textContent.trim()).filter(Boolean),
      date: el.querySelector(SITE.date)?.getAttribute?.('datetime')
        || el.querySelector(SITE.date)?.textContent.trim() || '',
      text: '',
    };
    card.pdfHref = SITE.pdf({ el, href, doi }) || '';
    return card;
  });

  const JOURNAL = document.querySelector('.journal-banner-text, .ja-journal-title, .cover-image__parent-item a')
    ?.textContent.trim() || document.title.split(/[|–—-]/)[0].trim();

  function mkImage(src) {
    const im = new Image();
    im.loading = 'lazy';
    im.src = src;
    im.alt = 'Graphical abstract';
    im.addEventListener('click', () => lightbox(src));
    im.addEventListener('error', () => im.parentElement?.classList.add('jt-empty'));
    return im;
  }

  function lightbox(src) {
    const d = document.createElement('div');
    d.className = 'jt-lightbox';
    d.innerHTML = `<img src="${src.replace(/"/g, '&quot;')}">`;
    d.addEventListener('click', () => d.remove());
    document.body.appendChild(d);
  }

  // ---------------------------------------------------------------- toolbar
  const bar = document.createElement('div');
  bar.className = 'jt-bar';
  bar.dataset.jtVersion = VERSION;
  bar.dataset.jtSite = SITE.id;
  listEl.parentElement.insertBefore(bar, listEl);

  let countEl, filterInput, colsSelect;
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function renderBar() {
    const kwOpen = bar.querySelector('.jt-kw-row')?.classList.contains('open');
    bar.innerHTML = `
      <button data-view="grid">${esc(t('grid'))}</button>
      <button data-view="compact">${esc(t('compact'))}</button>
      <select data-act="cols" title="${esc(t('colsTitle'))}">
        <option value="auto">${esc(t('colsAuto'))}</option>
        ${['1', '2', '3', '4', '5'].map(n => `<option value="${n}">${esc(t('colsN', n))}</option>`).join('')}
      </select>
      <span class="jt-sep"></span>
      <button data-act="abs">${esc(t('abs'))}</button>
      <button data-act="kw">${esc(t('kw'))}</button>
      ${needsFetch ? `<button data-act="all" title="${esc(t('allTitle'))}">${esc(t('all'))}</button>` : ''}
      <button data-act="lang" title="${esc(t('otherTitle'))}">${esc(t('other'))}</button>
      <span class="jt-sep"></span>
      <input type="text" data-act="filter" placeholder="${esc(t('filterPh'))}" value="${esc(state.query)}">
      <span class="jt-count"></span>
      <div class="jt-kw-row${kwOpen ? ' open' : ''}">
        <span style="color:#5a6472">${esc(t('kwLabel'))}</span>
        <input type="text" data-act="kwlist" value="${esc(state.keywords.join(', '))}">
      </div>`;

    countEl = bar.querySelector('.jt-count');
    filterInput = bar.querySelector('[data-act=filter]');
    colsSelect = bar.querySelector('[data-act=cols]');
    colsSelect.value = state.cols;

    filterInput.addEventListener('input', debounce(() => {
      state.query = filterInput.value.trim().toLowerCase();
      applyFilter();
    }, 180));
    bar.querySelector('[data-act=kwlist]').addEventListener('input', debounce((e) => {
      state.keywords = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
      LS.set('keywords', state.keywords);
      cards.forEach(markKeywords);
      applyFilter();
    }, 400));
    colsSelect.addEventListener('change', () => {
      state.cols = colsSelect.value;
      LS.set('cols', state.cols);
      applyView();
    });
  }

  const needsFetch = SITE.abstract.mode === 'fetch' || SITE.graphic.mode === 'fetch';

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) { state.view = b.dataset.view; LS.set('view', state.view); applyView(); }
    else if (b.dataset.act === 'abs') { state.showAbs = !state.showAbs; LS.set('showAbs', state.showAbs); applyView(); }
    else if (b.dataset.act === 'kw') { bar.querySelector('.jt-kw-row').classList.toggle('open'); }
    else if (b.dataset.act === 'all') { loadAll(b); }
    else if (b.dataset.act === 'lang') {
      state.lang = state.lang === 'zh' ? 'en' : 'zh';
      LS.set('lang', state.lang);
      renderBar(); applyView(); applyFilter();
      document.querySelectorAll('button.jt-zot').forEach(labelZotButton);
    }
  });

  function applyView() {
    document.body.classList.toggle('jt-grid', state.view === 'grid');
    document.body.classList.toggle('jt-compact', state.view === 'compact');
    if (state.cols === 'auto') document.body.style.removeProperty('--jt-cols');
    else document.body.style.setProperty('--jt-cols', `repeat(${state.cols}, minmax(0, 1fr))`);
    document.body.classList.toggle('jt-narrow', state.cols === '1' || state.cols === '2');
    colsSelect.disabled = state.view !== 'grid';
    bar.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
    bar.querySelector('[data-act=abs]').classList.toggle('on', state.showAbs);
    document.querySelectorAll('.jt-abs').forEach(el => { el.style.display = state.showAbs ? '' : 'none'; });
  }

  // ------------------------------------------------------------ data loader
  const MAX_CONCURRENT = 3;
  let running = 0;
  const queue = [];
  function pump() {
    while (running < MAX_CONCURRENT && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  }

  function cacheValid(entry) {
    if (!entry) return false;
    if (!entry.ga) return true;
    const exp = +(entry.ga.match(/Expires=(\d+)/) || [])[1];
    return !exp || exp * 1000 > Date.now() + 3600e3;   // signed CDN URLs expire
  }

  async function load(card) {
    if (card.loaded) return;
    card.loaded = true;
    const hit = cache[card.doi];
    if (cacheValid(hit)) { render(card, hit); return; }

    card.ga.classList.remove('jt-empty');
    card.ga.innerHTML = '<span class="jt-spin"></span>';
    try {
      const res = await fetch(card.href, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const img = SITE.graphic.mode === 'fetch' ? doc.querySelector(SITE.graphic.sel) : null;
      const absNode = SITE.abstract.mode === 'fetch' ? doc.querySelector(SITE.abstract.sel) : null;
      const entry = {
        ga: img ? new URL(img.getAttribute('src'), location.origin).href : '',
        abs: absNode ? absNode.textContent.replace(/\s+/g, ' ').replace(/^Abstract\s*/i, '').trim() : '',
        t: Date.now(),
      };
      cache[card.doi] = entry; cacheDirty = true; flushCache();
      render(card, entry);
    } catch (err) {
      card.ga.classList.add('jt-empty');
      card.ga.innerHTML = '';
    }
  }

  function render(card, entry) {
    card.ga.innerHTML = '';
    if (entry.ga) { card.ga.classList.remove('jt-empty'); card.ga.appendChild(mkImage(entry.ga)); }
    else card.ga.classList.add('jt-empty');
    if (entry.abs) card.abs.textContent = entry.abs;
    if (!state.showAbs) card.abs.style.display = 'none';
    card.text = buildText(card);
    markKeywords(card);
    applyFilterTo(card);
  }

  function loadAll(btn) {
    const pending = cards.filter(c => !c.loaded);
    if (!pending.length) return;
    btn.disabled = true;
    let done = 0;
    const tick = () => {
      done++;
      btn.textContent = t('loading', done, pending.length);
      if (done === pending.length) { btn.textContent = t('all'); btn.disabled = false; applyFilter(); }
    };
    for (const c of pending) { io.unobserve(c.el); queue.push(() => load(c).then(tick)); }
    pump();
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const card = cards.find(c => c.el === e.target);
      if (card) { queue.push(() => load(card)); pump(); }
    }
  }, { rootMargin: '600px 0px' });
  if (needsFetch) cards.forEach(c => io.observe(c.el));

  // ----------------------------------------------------------------- zotero
  // Zotero closes any request carrying an Origin header unless it also
  // identifies as a connector, so EVERY call here needs this header.
  const GM_HTTP = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;
  const ZOTERO = 'http://127.0.0.1:23119/connector';
  const ZOTERO_HEADERS = { 'X-Zotero-Connector-API-Version': '3' };
  let sessionSeq = 0;
  const newSessionID = () => `jt-${Date.now().toString(36)}-${sessionSeq++}`;

  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      GM_HTTP({
        timeout: 20000, ...opts,
        onload: r => resolve(r),
        onerror: () => reject(new Error('network')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  function splitName(full) {
    const parts = full.replace(/\s+/g, ' ').trim().split(' ');
    return parts.length < 2
      ? { firstName: '', lastName: full, creatorType: 'author' }
      : { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1], creatorType: 'author' };
  }

  function itemFromCrossref(cr, card) {
    const dp = (cr.published || cr.issued || {})['date-parts'] || [[]];
    const crAbs = (cr.abstract || '')
      .replace(/<jats:title>.*?<\/jats:title>/gi, '').replace(/<\/?jats:[^>]+>/g, '').trim();
    return {
      itemType: 'journalArticle',
      title: (cr.title || []).join(' '),
      DOI: cr.DOI || card.doi,
      url: cr.URL || ('https://doi.org/' + card.doi),
      abstractNote: crAbs || card.abs.textContent || '',
      publicationTitle: (cr['container-title'] || []).join(' '),
      volume: cr.volume || '', issue: cr.issue || '', pages: cr.page || '',
      ISSN: (cr.ISSN || []).join(', '),
      date: dp[0] && dp[0].length ? dp[0].map((p, i) => i ? String(p).padStart(2, '0') : p).join('-') : card.date,
      creators: (cr.author || []).map(a => ({
        firstName: a.given || '', lastName: a.family || '', creatorType: 'author',
      })),
      tags: [{ tag: '/unread' }],
    };
  }

  function itemFromPage(card) {
    return {
      itemType: 'journalArticle',
      title: card.title,
      DOI: card.doi,
      url: new URL(card.href, location.origin).href,
      abstractNote: card.abs.textContent || '',
      publicationTitle: JOURNAL,
      date: card.date,
      creators: card.authors.map(splitName),
      tags: [{ tag: '/unread' }, { tag: 'metadata-unverified' }],
    };
  }

  async function fetchCrossref(doi) {
    const r = await gmRequest({ method: 'GET', url: 'https://api.crossref.org/works/' + doi });
    if (r.status !== 200) return null;          // ASAP DOIs lag registration by 1-3 days
    try { return JSON.parse(r.responseText).message; } catch (e) { return null; }
  }

  function bufToBinaryString(buf) {
    const bytes = new Uint8Array(buf);
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return out;
  }

  // The PDF is fetched same-origin so it carries the reader's institutional
  // entitlement, which Zotero on its own does not have.
  async function attachPdf(card, sessionID) {
    if (!card.pdfHref) return 'no pdf link';
    let buf;
    try {
      const res = await fetch(card.pdfHref, { credentials: 'include' });
      if (!res.ok) return 'fetch HTTP ' + res.status;
      buf = await res.arrayBuffer();
    } catch (e) { return 'fetch ' + (e.message || e.name); }
    const magic = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
    if (!magic.startsWith('%PDF')) return 'not a PDF';

    const headers = {
      ...ZOTERO_HEADERS,
      'Content-Type': 'application/pdf',
      'X-Metadata': JSON.stringify({
        sessionID, url: new URL(card.pdfHref, location.origin).href, title: 'Full Text PDF',
      }),
    };
    const attempts = [
      { name: 'blob', data: new Blob([buf], { type: 'application/pdf' }) },
      { name: 'binstr', data: bufToBinaryString(buf), binary: true },
    ];
    const errs = [];
    for (const a of attempts) {
      try {
        const r = await gmRequest({
          method: 'POST', url: ZOTERO + '/saveAttachment',
          headers, data: a.data, binary: a.binary, timeout: 180000,
        });
        if (r.status === 201) return null;
        errs.push(a.name + ':HTTP' + r.status);
      } catch (e) { errs.push(a.name + ':' + (e.message || e.name)); }
    }
    return errs.join(' | ');
  }

  function labelZotButton(btn) {
    const st = btn.dataset.state || 'idle';
    if (st === 'busy') { btn.textContent = btn.dataset.busy || '…'; btn.title = ''; return; }
    if (st === 'ok') {
      const scraped = btn.dataset.via === 'page';
      const pdf = btn.dataset.pdf === '1';
      btn.textContent = (scraped ? t('zotOkScraped') : t('zotOk')) + (pdf ? ' + PDF' : '');
      const why = btn.dataset.pdfErr ? ` (${btn.dataset.pdfErr})` : '';
      btn.title = (scraped ? t('zotViaPage') : t('zotViaCrossref'))
        + ' · ' + (pdf ? t('zotPdfOk') : t('zotPdfNone') + why);
      return;
    }
    if (st === 'err') {
      btn.textContent = t('zotFail');
      btn.title = t('zotErr', btn.dataset.err || '');
      return;
    }
    btn.textContent = t('zotAdd');
    btn.title = '';
  }

  async function saveToZotero(card, btn) {
    if (!GM_HTTP) return;
    btn.disabled = true;
    btn.dataset.state = 'busy';
    btn.dataset.busy = '…';
    labelZotButton(btn);

    if (!card.loaded) { io.unobserve(card.el); await load(card); }

    let item, viaCrossref = false;
    try {
      const cr = await fetchCrossref(card.doi);
      if (cr) { item = itemFromCrossref(cr, card); viaCrossref = true; }
    } catch (e) { /* fall through to the page scrape */ }
    if (!item) item = itemFromPage(card);

    const sessionID = newSessionID();
    try {
      const r = await gmRequest({
        method: 'POST', url: ZOTERO + '/saveItems',
        headers: { ...ZOTERO_HEADERS, 'Content-Type': 'application/json' },
        data: JSON.stringify({ items: [item], uri: item.url, sessionID }),
      });
      if (r.status !== 201) throw new Error('HTTP ' + r.status);
      btn.dataset.via = viaCrossref ? 'crossref' : 'page';
      btn.className = 'jt-zot ok';

      btn.dataset.busy = t('zotBusyPdf');
      labelZotButton(btn);
      const pdfErr = await attachPdf(card, sessionID);

      btn.dataset.state = 'ok';
      btn.dataset.pdf = pdfErr ? '0' : '1';
      btn.dataset.pdfErr = pdfErr || '';
      labelZotButton(btn);
    } catch (e) {
      btn.disabled = false;
      btn.dataset.state = 'err';
      btn.dataset.err = e.message;
      btn.className = 'jt-zot err';
      labelZotButton(btn);
    }
  }

  function addZoteroButton(card) {
    if (!GM_HTTP) return;
    const btn = document.createElement('button');
    btn.className = 'jt-zot';
    btn.dataset.state = 'idle';
    labelZotButton(btn);
    btn.addEventListener('click', (e) => { e.preventDefault(); saveToZotero(card, btn); });

    const host = SITE.actionBar && card.el.querySelector(SITE.actionBar);
    if (host) {
      const wrap = document.createElement('div');
      wrap.className = 'item';
      wrap.appendChild(btn);
      host.appendChild(wrap);
    } else {
      card.el.appendChild(btn);
    }
  }

  // ------------------------------------------------------- filter + keywords
  function buildText(card) {
    return [card.title, card.authors.join(' '), card.abs.textContent].join(' ').toLowerCase();
  }
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapeHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // Text nodes only, so <sub>/<sup> in chemical titles survive intact.
  function markKeywords(card) {
    const targets = [card.el.querySelector('.jt-title'), card.abs].filter(Boolean);
    let hit = false;
    for (const root of targets) {
      root.querySelectorAll('mark').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
      root.normalize();
      if (!state.keywords.length) continue;
      const re = new RegExp('(' + state.keywords.map(escapeRe).join('|') + ')', 'gi');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const n of nodes) {
        if (!re.test(n.nodeValue)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        const span = document.createElement('span');
        span.innerHTML = escapeHtml(n.nodeValue).replace(re, '<mark>$1</mark>');
        n.replaceWith(...span.childNodes);
        hit = true;
      }
    }
    card.el.classList.toggle('jt-hit', hit);
  }

  function applyFilterTo(card) {
    const terms = state.query ? state.query.split(/\s+/) : [];
    const show = terms.every(x => card.text.includes(x));
    card.el.classList.toggle('jt-hidden', !show);
    return show;
  }
  function applyFilter() {
    let n = 0;
    for (const c of cards) if (applyFilterTo(c)) n++;
    countEl.textContent = t('count', n, cards.length);
  }

  cards.forEach(c => { c.text = buildText(c); });
  cards.forEach(markKeywords);
  cards.forEach(addZoteroButton);
  renderBar();
  applyView();
  applyFilter();
})();
