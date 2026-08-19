// ==UserScript==
// @name         ACS ASAP Reader
// @namespace    weihuang.acs
// @version      1.2.1
// @description  Restore graphical abstracts + inline abstracts on ACS (JACS etc.) ASAP / TOC / search list pages, with compact view, keyword filter, highlight, one-click Zotero save and a bilingual (EN/中文) UI.
// @author       weihuang
// @match        https://pubs.acs.org/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api.crossref.org
// @connect      127.0.0.1
// @connect      localhost
// @homepageURL  https://github.com/Wei952766/acs-asap-reader
// @supportURL   https://github.com/Wei952766/acs-asap-reader/issues
// @downloadURL  https://raw.githubusercontent.com/Wei952766/acs-asap-reader/main/acs-asap-reader.user.js
// @updateURL    https://raw.githubusercontent.com/Wei952766/acs-asap-reader/main/acs-asap-reader.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LIST_SELECTOR = 'div.al-article-box';
  if (!document.querySelector(LIST_SELECTOR)) return;

  // ---------------------------------------------------------------- settings
  const LS = {
    get(k, fallback) {
      try { const v = localStorage.getItem('asapReader.' + k); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(k, v) { try { localStorage.setItem('asapReader.' + k, JSON.stringify(v)); } catch (e) {} },
  };

  const state = {
    view: LS.get('view', 'grid'),          // 'grid' | 'compact'
    showAbs: LS.get('showAbs', true),
    keywords: LS.get('keywords', ['enzyme', 'biocatalysis', 'protein design', 'catalysis']),
    cols: LS.get('cols', 'auto'),         // 'auto' | '1'..'5', grid view only
    // First run follows the browser; after that the toolbar toggle wins.
    lang: LS.get('lang', /^zh/i.test(navigator.language || '') ? 'zh' : 'en'),
    query: '',
  };

  // ----------------------------------------------------------------- i18n
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
      zotViaCrossref: 'Metadata from CrossRef',
      zotViaPage: 'DOI not in CrossRef yet; metadata scraped from the page and tagged metadata-unverified',
      zotErr: e => `Is Zotero running? Open the Zotero desktop app and retry. (${e})`,
    },
  };
  const t = (k, ...a) => {
    const v = I18N[state.lang][k];
    return typeof v === 'function' ? v(...a) : v;
  };

  // Cached article payloads live under one key so pruning is a single write.
  const CACHE_KEY = 'cache';
  let cache = LS.get(CACHE_KEY, {});
  const CACHE_TTL = 30 * 24 * 3600 * 1000;
  let cacheDirty = false;

  function writeCache() {
    if (!cacheDirty) return;
    const cutoff = Date.now() - CACHE_TTL;
    for (const k of Object.keys(cache)) if (!cache[k].t || cache[k].t < cutoff) delete cache[k];
    try {
      localStorage.setItem('asapReader.' + CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      // Quota exceeded: drop the oldest half rather than losing the cache forever.
      const byAge = Object.keys(cache).sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0));
      byAge.slice(0, Math.ceil(byAge.length / 2)).forEach(k => delete cache[k]);
      try { localStorage.setItem('asapReader.' + CACHE_KEY, JSON.stringify(cache)); } catch (e2) {}
    }
    cacheDirty = false;
  }
  const flushCache = debounce(writeCache, 2000);
  // The debounce leaves a window where a closed tab would lose fresh entries.
  addEventListener('pagehide', writeCache);

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ------------------------------------------------------------------- style
  const css = `
  .asap-bar{position:sticky;top:0;z-index:900;display:flex;flex-wrap:wrap;gap:8px;align-items:center;
    padding:8px 12px;margin:0 0 14px;background:#fff;border:1px solid #d5d9e0;border-radius:8px;
    box-shadow:0 2px 6px rgba(0,0,0,.08);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .asap-bar button{padding:4px 10px;border:1px solid #c3c9d2;border-radius:6px;background:#f7f8fa;cursor:pointer;font-size:12px;color:#1a1a1a}
  .asap-bar button.on{background:#00558c;border-color:#00558c;color:#fff}
  .asap-bar input[type=text]{padding:4px 8px;border:1px solid #c3c9d2;border-radius:6px;font-size:12px;min-width:180px}
  .asap-bar select{padding:4px 6px;border:1px solid #c3c9d2;border-radius:6px;background:#f7f8fa;font-size:12px;cursor:pointer}
  .asap-bar select:disabled{opacity:.45;cursor:default}
  .asap-bar .asap-count{margin-left:auto;color:#5a6472;font-size:12px;white-space:nowrap}
  .asap-bar .asap-sep{width:1px;height:20px;background:#dde1e6}
  .asap-kw-row{flex-basis:100%;display:none;gap:6px;align-items:center}
  .asap-kw-row.open{display:flex}
  .asap-kw-row input{flex:1}

  /* grid view — ACS caps these wrappers at 1300px, which leaves room for only 2 columns */
  body.asap-grid .page-column-wrap, body.asap-grid .issue-browse_content{max-width:none}
  /* the right rail is a 300px ad slot with no content; reclaim it for the grid */
  body.asap-grid .page-column--right{display:none}
  body.asap-grid .issue-browse_content{grid-template-columns:1fr}
  /* ...but at 1-2 columns the native width reads better than full-bleed */
  body.asap-grid.asap-narrow .page-column-wrap, body.asap-grid.asap-narrow .issue-browse_content{max-width:1300px}
  body.asap-grid .al-article-list-group{display:grid;gap:16px;
    grid-template-columns:var(--asap-cols, repeat(auto-fill, minmax(330px, 1fr)))}
  body.asap-grid .al-article-box{border:1px solid #e0e4e9;border-radius:8px;padding:12px;margin:0;background:#fff}
  body.asap-grid .al-article-box h5.al-title{font-size:15px;line-height:1.35;margin:6px 0}
  body.asap-grid .al-authors-list{font-size:11.5px;color:#5a6472;max-height:2.8em;overflow:hidden}
  body.asap-grid .asap-ga img{max-height:160px}

  /* compact view */
  body.asap-compact .al-article-box{border:0;border-bottom:1px solid #eceff2;padding:6px 0;margin:0}
  body.asap-compact .al-article-box h5.al-title{font-size:14px;line-height:1.3;margin:2px 0}
  body.asap-compact .asap-ga{display:none}
  body.asap-compact .al-authors-list{font-size:11px;color:#7a828d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  /* injected bits */
  .asap-ga{margin:2px 0 6px;min-height:4px}
  .asap-ga img{width:100%;max-height:220px;object-fit:contain;background:#fafbfc;border:1px solid #eceff2;border-radius:6px;cursor:zoom-in}
  .asap-ga.asap-empty{display:none}
  .asap-abs{font-size:12px;line-height:1.5;color:#3c4450;margin:6px 0 2px;
    max-height:6.4em;overflow:hidden;position:relative;cursor:pointer}
  .asap-abs.open{max-height:none}
  .asap-abs:not(.open)::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.6em;
    background:linear-gradient(rgba(255,255,255,0),#fff)}
  .asap-abs:empty{display:none}
  .asap-hidden{display:none !important}
  .asap-hit{box-shadow:inset 3px 0 0 #e8a33d}
  body.asap-grid .al-article-box.asap-hit{border-color:#e8a33d}
  .asap-abs mark, .al-title mark{background:#ffe9a8;color:inherit;padding:0 1px;border-radius:2px}
  .asap-spin{display:inline-block;width:11px;height:11px;border:2px solid #d5d9e0;border-top-color:#00558c;
    border-radius:50%;animation:asapspin .7s linear infinite;vertical-align:-1px}
  @keyframes asapspin{to{transform:rotate(360deg)}}

  /* trim the noisiest native chrome inside cards */
  .al-article-box .badge-bar{margin:6px 0 0}
  .al-article-box .badge-bar .resource-links-info{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .al-article-box .badge-bar .item{margin:0 !important;padding:0 !important;border:0 !important}
  .al-article-box .badge-bar a{font-size:11px !important;padding:0 !important;border:0 !important;
    background:none !important;text-decoration:underline}
  .al-article-box .badge-bar .item:has(a.SupplementaryDataLink){display:none}
  .al-article-box .al-expanded-section{display:none}
  /* in-list ads are direct children of the group and would become grid cells */
  .al-article-list-group > .inlist-ad-wrapper{display:none}

  button.asap-zot{font-size:11px;padding:1px 7px;border:1px solid #b23c2e;border-radius:4px;
    background:#fff;color:#b23c2e;cursor:pointer;line-height:1.6}
  button.asap-zot:hover:not(:disabled){background:#b23c2e;color:#fff}
  button.asap-zot:disabled{cursor:default;opacity:.9}
  button.asap-zot.ok{border-color:#2e7d4f;color:#2e7d4f;background:#f2f9f5}
  button.asap-zot.err{border-color:#b23c2e;color:#fff;background:#b23c2e}

  .asap-lightbox{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;
    align-items:center;justify-content:center;cursor:zoom-out}
  .asap-lightbox img{max-width:92vw;max-height:92vh;background:#fff;border-radius:6px}
  `;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  // ----------------------------------------------------------------- toolbar
  const listGroup = document.querySelector('.al-article-list-group')?.parentElement
    || document.querySelector(LIST_SELECTOR).closest('.article-list-resources')
    || document.querySelector(LIST_SELECTOR).parentElement;

  const bar = document.createElement('div');
  bar.className = 'asap-bar';
  listGroup.insertBefore(bar, listGroup.firstChild);

  let countEl, filterInput, colsSelect;

  const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  // Rebuilt wholesale on a language switch, so it carries the live values over.
  function renderBar() {
    const kwOpen = bar.querySelector('.asap-kw-row')?.classList.contains('open');
    bar.innerHTML = `
      <button data-view="grid">${esc(t('grid'))}</button>
      <button data-view="compact">${esc(t('compact'))}</button>
      <select data-act="cols" title="${esc(t('colsTitle'))}">
        <option value="auto">${esc(t('colsAuto'))}</option>
        ${['1', '2', '3', '4', '5'].map(n => `<option value="${n}">${esc(t('colsN', n))}</option>`).join('')}
      </select>
      <span class="asap-sep"></span>
      <button data-act="abs">${esc(t('abs'))}</button>
      <button data-act="kw">${esc(t('kw'))}</button>
      <button data-act="all" title="${esc(t('allTitle'))}">${esc(t('all'))}</button>
      <button data-act="lang" title="${esc(t('otherTitle'))}">${esc(t('other'))}</button>
      <span class="asap-sep"></span>
      <input type="text" data-act="filter" placeholder="${esc(t('filterPh'))}" value="${esc(state.query)}">
      <span class="asap-count"></span>
      <div class="asap-kw-row${kwOpen ? ' open' : ''}">
        <span style="color:#5a6472">${esc(t('kwLabel'))}</span>
        <input type="text" data-act="kwlist" value="${esc(state.keywords.join(', '))}">
      </div>`;

    countEl = bar.querySelector('.asap-count');
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

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) { state.view = b.dataset.view; LS.set('view', state.view); applyView(); }
    else if (b.dataset.act === 'abs') { state.showAbs = !state.showAbs; LS.set('showAbs', state.showAbs); applyView(); }
    else if (b.dataset.act === 'kw') { bar.querySelector('.asap-kw-row').classList.toggle('open'); }
    else if (b.dataset.act === 'all') { loadAll(b); }
    else if (b.dataset.act === 'lang') {
      state.lang = state.lang === 'zh' ? 'en' : 'zh';
      LS.set('lang', state.lang);
      applyLang();
    }
  });

  function applyLang() {
    renderBar();
    applyView();
    applyFilter();
    document.querySelectorAll('button.asap-zot').forEach(labelZotButton);
  }

  // The filter can only match abstract text that has actually been fetched, so
  // offer an explicit "load everything on this page" escape hatch.
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
    for (const c of pending) { io.unobserve(c.box); queue.push(() => load(c).then(tick)); }
    pump();
  }

  function applyView() {
    document.body.classList.toggle('asap-grid', state.view === 'grid');
    document.body.classList.toggle('asap-compact', state.view === 'compact');
    if (state.cols === 'auto') document.body.style.removeProperty('--asap-cols');
    else document.body.style.setProperty('--asap-cols', `repeat(${state.cols}, minmax(0, 1fr))`);
    document.body.classList.toggle('asap-narrow', state.cols === '1' || state.cols === '2');
    colsSelect.disabled = state.view !== 'grid';
    bar.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
    bar.querySelector('[data-act=abs]').classList.toggle('on', state.showAbs);
    document.querySelectorAll('.asap-abs').forEach(el => {
      el.style.display = state.showAbs ? '' : 'none';
    });
  }

  // ------------------------------------------------------------------- cards
  const cards = [...document.querySelectorAll(LIST_SELECTOR)].map((box) => {
    const link = box.querySelector('h5.al-title a');
    if (!link) return null;
    const href = link.getAttribute('href');
    const doi = (href.match(/\/doi\/(10\.\d{4,9}\/[^/]+)/) || [])[1] || href;

    const ga = document.createElement('div');
    ga.className = 'asap-ga asap-empty';
    box.querySelector('.al-article-items').insertBefore(ga, box.querySelector('h5.al-title'));

    const abs = document.createElement('div');
    abs.className = 'asap-abs';
    abs.addEventListener('click', () => abs.classList.toggle('open'));
    (box.querySelector('.al-authors-list') || box.querySelector('h5.al-title')).after(abs);

    return {
      box, href, doi, ga, abs, text: '', loaded: false,
      title: link.textContent.replace(/\s+/g, ' ').trim(),
      authors: [...box.querySelectorAll('.al-authors-list .wi-fullname')].map(s => s.textContent.trim()),
      date: box.querySelector('.al-pub-date')?.textContent.trim() || '',
    };
  }).filter(Boolean);

  const JOURNAL = document.querySelector('.journal-banner-text, .ja-journal-title')?.textContent.trim()
    || document.title.split('|')[0].trim();

  // ------------------------------------------------------------- data loader
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
    if (!entry.ga) return true;                       // abstract-only entries never expire
    const exp = +(entry.ga.match(/Expires=(\d+)/) || [])[1];
    return !exp || exp * 1000 > Date.now() + 3600e3;  // signed CDN URLs need refreshing
  }

  async function load(card) {
    if (card.loaded) return;
    card.loaded = true;

    const hit = cache[card.doi];
    if (cacheValid(hit)) { render(card, hit); return; }

    card.ga.classList.remove('asap-empty');
    card.ga.innerHTML = '<span class="asap-spin"></span>';
    try {
      const res = await fetch(card.href, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const img = doc.querySelector('.graphical-abstract img');
      const absNode = doc.querySelector('section.abstract');
      const entry = {
        ga: img ? new URL(img.getAttribute('src'), location.origin).href : '',
        abs: absNode ? absNode.textContent.replace(/\s+/g, ' ').replace(/^Abstract\s*/i, '').trim() : '',
        t: Date.now(),
      };
      cache[card.doi] = entry; cacheDirty = true; flushCache();
      render(card, entry);
    } catch (err) {
      card.ga.classList.add('asap-empty');
      card.ga.innerHTML = '';
    }
  }

  function render(card, entry) {
    if (entry.ga) {
      card.ga.classList.remove('asap-empty');
      card.ga.innerHTML = '';
      const im = new Image();
      im.loading = 'lazy';
      im.src = entry.ga;
      im.alt = 'Graphical abstract';
      im.addEventListener('click', () => lightbox(entry.ga));
      im.addEventListener('error', () => card.ga.classList.add('asap-empty'));
      card.ga.appendChild(im);
    } else {
      card.ga.classList.add('asap-empty');
      card.ga.innerHTML = '';
    }
    card.abs.textContent = entry.abs || '';
    if (!state.showAbs) card.abs.style.display = 'none';
    card.text = buildText(card);
    markKeywords(card);
    applyFilterTo(card);
  }

  function lightbox(src) {
    const d = document.createElement('div');
    d.className = 'asap-lightbox';
    d.innerHTML = `<img src="${src}">`;
    d.addEventListener('click', () => d.remove());
    document.body.appendChild(d);
  }

  // ------------------------------------------------------------------ zotero
  // The Zotero connector sends no CORS headers, so a page-context fetch is
  // blocked; GM_xmlhttpRequest is the only way to reach 127.0.0.1:23119.
  const GM_HTTP = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;
  const ZOTERO = 'http://127.0.0.1:23119/connector';
  let sessionSeq = 0;
  const newSessionID = () => `acs-asap-${Date.now().toString(36)}-${sessionSeq++}`;

  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      GM_HTTP({
        timeout: 20000,
        ...opts,
        onload: r => resolve(r),
        onerror: () => reject(new Error('network')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  // "Cuiyi Deng" -> {firstName:"Cuiyi", lastName:"Deng"}. Wrong for compound
  // surnames, which is why scraped items get flagged for review.
  function splitName(full) {
    const parts = full.replace(/\s+/g, ' ').trim().split(' ');
    return parts.length < 2
      ? { firstName: '', lastName: full, creatorType: 'author' }
      : { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1], creatorType: 'author' };
  }

  function itemFromCrossref(cr, card) {
    const dp = (cr.published || cr.issued || {})['date-parts'] || [[]];
    const crAbs = (cr.abstract || '')
      .replace(/<jats:title>.*?<\/jats:title>/gi, '')
      .replace(/<\/?jats:[^>]+>/g, '').trim();
    return {
      itemType: 'journalArticle',
      title: (cr.title || []).join(' '),
      DOI: cr.DOI || card.doi,
      url: cr.URL || ('https://doi.org/' + card.doi),
      // CrossRef abstracts are frequently absent for ACS; we already scraped one.
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
      url: 'https://doi.org/' + card.doi,
      abstractNote: card.abs.textContent || '',
      publicationTitle: JOURNAL,
      date: card.date,
      creators: card.authors.map(splitName),
      // Flag it: this metadata came off the page, not from the DOI registry.
      tags: [{ tag: '/unread' }, { tag: 'metadata-unverified' }],
    };
  }

  async function fetchCrossref(doi) {
    const r = await gmRequest({ method: 'GET', url: 'https://api.crossref.org/works/' + doi });
    if (r.status !== 200) return null;              // ASAP DOIs lag registration by 1-3 days
    try { return JSON.parse(r.responseText).message; } catch (e) { return null; }
  }

  // Label is derived from state so a language switch can relabel buttons that
  // already show a result, without losing that result.
  function labelZotButton(btn) {
    const st = btn.dataset.state || 'idle';
    if (st === 'busy') { btn.textContent = '…'; btn.title = ''; return; }
    if (st === 'ok') {
      const scraped = btn.dataset.via === 'page';
      btn.textContent = scraped ? t('zotOkScraped') : t('zotOk');
      btn.title = scraped ? t('zotViaPage') : t('zotViaCrossref');
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
    labelZotButton(btn);

    // Make sure the abstract is on hand before building the item.
    if (!card.loaded) { io.unobserve(card.box); await load(card); }

    let item, viaCrossref = false;
    try {
      const cr = await fetchCrossref(card.doi);
      if (cr) { item = itemFromCrossref(cr, card); viaCrossref = true; }
    } catch (e) { /* fall through to page scrape */ }
    if (!item) item = itemFromPage(card);

    try {
      const r = await gmRequest({
        method: 'POST',
        url: ZOTERO + '/saveItems',
        // Zotero drops any request that carries an Origin header unless it also
        // identifies as a connector -- that is the gate stopping arbitrary sites
        // from writing to your library. GM_xmlhttpRequest always sends Origin,
        // so without this header the connection is closed and the save fails.
        headers: {
          'Content-Type': 'application/json',
          'X-Zotero-Connector-API-Version': '3',
        },
        // Zotero treats sessionID as a save-session key: reusing one returns 409
        // and silently drops the item, so every save needs a fresh id.
        data: JSON.stringify({ items: [item], uri: item.url, sessionID: newSessionID() }),
      });
      if (r.status !== 201) throw new Error('HTTP ' + r.status);
      btn.dataset.state = 'ok';
      btn.dataset.via = viaCrossref ? 'crossref' : 'page';
      btn.className = 'asap-zot ok';
      labelZotButton(btn);
    } catch (e) {
      btn.disabled = false;
      btn.dataset.state = 'err';
      btn.dataset.err = e.message;
      btn.className = 'asap-zot err';
      labelZotButton(btn);
    }
  }

  function addZoteroButton(card) {
    if (!GM_HTTP) return;                            // bookmarklet / no Tampermonkey
    const host = card.box.querySelector('.badge-bar .resource-links-info') || card.box.querySelector('.badge-bar');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.className = 'item';
    const btn = document.createElement('button');
    btn.className = 'asap-zot';
    btn.dataset.state = 'idle';
    labelZotButton(btn);
    btn.addEventListener('click', (e) => { e.preventDefault(); saveToZotero(card, btn); });
    wrap.appendChild(btn);
    host.appendChild(wrap);
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const card = cards.find(c => c.box === e.target);
      if (card) { queue.push(() => load(card)); pump(); }
    }
  }, { rootMargin: '600px 0px' });
  cards.forEach(c => io.observe(c.box));

  // -------------------------------------------------------- filter + keywords
  function buildText(card) {
    return [
      card.box.querySelector('h5.al-title')?.textContent || '',
      card.box.querySelector('.al-authors-list')?.textContent || '',
      card.abs.textContent,
    ].join(' ').toLowerCase();
  }
  cards.forEach(c => { c.text = buildText(c); });

  // Walks text nodes only, so <sub>/<sup> in chemical titles survive intact.
  function markKeywords(card) {
    const targets = [card.box.querySelector('h5.al-title'), card.abs].filter(Boolean);
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
    card.box.classList.toggle('asap-hit', hit);
  }
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapeHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function applyFilterTo(card) {
    const terms = state.query ? state.query.split(/\s+/) : [];
    const show = terms.every(t => card.text.includes(t));
    card.box.classList.toggle('asap-hidden', !show);
    return show;
  }
  function applyFilter() {
    let n = 0;
    for (const c of cards) if (applyFilterTo(c)) n++;
    countEl.textContent = t('count', n, cards.length);
  }

  cards.forEach(markKeywords);
  cards.forEach(addZoteroButton);
  renderBar();
  applyView();
  applyFilter();
})();
