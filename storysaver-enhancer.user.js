// ==UserScript==
// @name         Instagram CDN URL Extractor & Safe Downloader (StorySaver)
// @namespace    your-namespace
// @version      8.0
// @author       ne0liberal
// @description  Download IG stories via storysaver.
// @match        https://www.storysaver.net/*
// @updateURL    https://github.com/n30liberal/random-userscripts/raw/main/storysaver-enhancer.user.js
// @downloadURL  https://github.com/n30liberal/random-userscripts/raw/main/storysaver-enhancer.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      *.cdninstagram.com
// ==/UserScript==

(function () {
  'use strict';

  function safe(fn) { try { return fn(); } catch (e) { console.warn('[StorySaver DL] init error:', e); } }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => safe(init));
  } else {
    safe(init);
  }

  function init() {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const jitter = (base) => base + Math.floor(Math.random() * base);

    function sanitizeFilename(name) {
      return (name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    }

    function getExtFromContentType(ct) {
      if (!ct) return '';
      const c = ct.toLowerCase();
      if (c.includes('mp4')) return '.mp4';
      if (c.includes('jpeg') || c.includes('jpg')) return '.jpg';
      if (c.includes('png')) return '.png';
      if (c.includes('webp')) return '.webp';
      if (c.includes('gif')) return '.gif';
      return '';
    }

    function getUsername() {
      const candidates = [
        "a[href='#show'] p",
        ".card a[href='#show'] p",
        ".content a[href='#show'] p",
        ".username",
        ".name",
        "h2, h3"
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim()) {
          return sanitizeFilename(el.textContent.trim().toLowerCase());
        }
      }
      return 'unknown';
    }

    function collectUrls() {
      const set = new Set();

      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href;
        if (!href) continue;
        if (href.includes('cdninstagram.com') || href.includes('_nc_ht=')) set.add(href);
      }

      for (const img of document.images) {
        if (img.src && img.src.includes('cdninstagram.com')) set.add(img.src);
        const srcset = img.srcset || '';
        srcset.split(',').forEach(part => {
          const url = part.trim().split(/\s+/)[0];
          if (url && url.includes('cdninstagram.com')) set.add(url);
        });
      }

      for (const el of document.querySelectorAll('video, source')) {
        const src = el.currentSrc || el.src;
        if (src && src.includes('cdninstagram.com')) set.add(src);
      }

      return [...set];
    }

    function keyFromUrl(url) {
      try {
        const u = new URL(url);
        const igk = u.searchParams.get('ig_cache_key');
        if (igk) return igk;
        const last = u.pathname.split('/').filter(Boolean).pop() || 'file';
        return last + (u.searchParams.get('efg') ? ('_' + u.searchParams.get('efg')) : '');
      } catch {
        return url;
      }
    }

    function dedupeByKey(urls) {
      const seen = new Set();
      const out = [];
      for (const u of urls) {
        const k = keyFromUrl(u);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(u);
      }
      return out;
    }

    function buildFilename(username, url, contentTypeHint) {
      let base = keyFromUrl(url).split('?')[0];
      const hasExt = /\.[a-z0-9]{2,5}$/i.test(base);
      let ext = hasExt ? '' : getExtFromContentType(contentTypeHint);

      if (!hasExt && !ext) {
        if (/\.mp4(\?|$)/i.test(url)) ext = '.mp4';
        else if (/\.jpe?g(\?|$)/i.test(url)) ext = '.jpg';
        else if (/\.png(\?|$)/i.test(url)) ext = '.png';
        else if (/\.webp(\?|$)/i.test(url)) ext = '.webp';
        else if (/\.gif(\?|$)/i.test(url)) ext = '.gif';
      }
      return sanitizeFilename(`${username}-${base}${ext || ''}`);
    }

    function historyKey(username) { return `downloadHistoryStorySaver:${username}`; }
    function loadHistory(username) { try { return JSON.parse(localStorage.getItem(historyKey(username))) || {}; } catch { return {}; } }
    function saveHistory(username, obj) { localStorage.setItem(historyKey(username), JSON.stringify(obj || {})); }

    async function downloadOne(url, filename, onProgress) {
      return new Promise((resolve, reject) => {
        if (typeof GM_download === 'function') {
          try {
            GM_download({
              url,
              name: filename,
              onprogress: (e) => onProgress && onProgress(e),
              ontimeout: () => reject(new Error('timeout')),
              onerror: (e) => reject(new Error((e && e.error) || 'GM_download error')),
              onload: () => resolve(true),
            });
            return;
          } catch (e) {}
        }

        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'blob',
          onprogress: (e) => onProgress && onProgress(e),
          onload: function (res) {
            try {
              const blob = res.response;
              const headers = res.responseHeaders || '';
              const match = /content-type:\s*([^\r\n]+)/i.exec(headers);
              const ext = getExtFromContentType(match ? match[1] : '');
              const finalName = /\.[a-z0-9]{2,5}$/i.test(filename) ? filename : (filename + ext);

              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = finalName;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2500);

              resolve(true);
            } catch (e) { reject(e); }
          },
          onerror: () => reject(new Error('xhr error')),
          ontimeout: () => reject(new Error('xhr timeout')),
        });
      });
    }

    async function downloadQueue(urls, username, ui) {
      const history = loadHistory(username);
      const seenFilenames = new Set();

      const toDownload = urls.filter(u => {
        try {
          const d = new URL(u).hostname;
          if (!/cdninstagram\.com$/i.test(d)) return false;
        } catch { return false; }
        return !history[keyFromUrl(u)];
      });

      ui.setTotal(toDownload.length);

      for (let i = 0; i < toDownload.length; i++) {
        const url = toDownload[i];

        let fname = buildFilename(username, url, '');
        if (seenFilenames.has(fname)) fname = fname.replace(/(\.[a-z0-9]{2,5})?$/i, `-${i}$1`);
        seenFilenames.add(fname);

        let success = false;
        let attempt = 0;
        const maxAttempts = 4;

        while (!success && attempt < maxAttempts) {
          attempt++;
          ui.update(`Downloading ${i + 1}/${toDownload.length} (try ${attempt})`);
          try {
            await downloadOne(url, fname, () => {});
            success = true;
            history[keyFromUrl(url)] = true;
            saveHistory(username, history);
            addToCount(username, 1);
            ui.tick();
          } catch (e) {
            if (attempt >= maxAttempts) {
              console.warn('Failed:', url, e);
              ui.warn(`Failed: ${fname}`);
              break;
            }
            await sleep(jitter(400) * attempt);
          }
        }
        await sleep(jitter(120));
      }

      ui.done();
    }

    const POS_KEY = 'ssv-card-pos';

    GM_addStyle(`
      .ssv-helper { position: fixed; bottom: 20px; right: 20px; z-index: 2147483646; font: 12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; pointer-events: none; }

      .ssv-card {
        --ssv-bg: #0b5cff;
        --ssv-fg: #fff;

        position: fixed;
        width: 440px;
        max-width: min(92vw, 540px);
        display: flex; flex-direction: column; box-sizing: border-box;

        background: var(--ssv-bg) !important; color: var(--ssv-fg) !important;
        border-radius: 12px !important;
        box-shadow: 0 12px 28px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.2) !important;
        padding: 12px !important; gap: 10px !important;

        pointer-events: auto !important;
        overflow: visible;
      }

      .ssv-row { display: flex !important; gap: 8px !important; align-items: center !important; flex-wrap: nowrap !important; }
      .ssv-header { align-items: center !important; justify-content: space-between !important; gap: 8px !important; }

      .ssv-title {
        font-weight: 800 !important; font-size: 14px !important; padding: 6px 10px !important;
        border-radius: 8px !important; background: rgba(0,0,0,.18) !important; user-select: none !important; cursor: move;
      }

      .ssv-btn {
        cursor: pointer !important; padding: 7px 9px !important;
        border: 1px solid rgba(0,0,0,0.15) !important; border-radius: 8px !important;
        background: #ffffff !important; color: #0b5cff !important;
        font-weight: 800 !important; line-height: 1 !important; white-space: nowrap !important;
      }
      .ssv-btn:disabled { opacity: .55 !important; cursor: default !important; }
      .ssv-btn.ghost { background: rgba(255,255,255,.14) !important; color: #fff !important; border-color: rgba(255,255,255,.2) !important; }
      .ssv-btn:focus { outline: 2px solid rgba(255,255,255,0.9) !important; outline-offset: 1px !important; }

      .ssv-small { opacity: .95 !important; font-size: 12px !important; }
      .ssv-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace !important; }

      .ssv-section {
        background: rgba(0,0,0,.12); border-radius: 10px; padding: 10px;
        display: flex; flex-direction: column; gap: 10px;
      }

      .ssv-grid { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; }

      .ssv-badge {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(255,255,255,.15); border: 1px solid rgba(0,0,0,.15);
        padding: 6px 8px; border-radius: 999px; font-weight: 800;
      }

      .ssv-input {
        width: 100%; border-radius: 8px; padding: 8px 10px; border: 0; outline: none; min-width: 0;
        font-size: 12.5px; line-height: 1.2;
      }

      .ssv-actions { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
      .ssv-actions-left { display: flex; gap: 8px; align-items: center; }
      .ssv-actions-right { display: flex; gap: 8px; align-items: center; position: relative; pointer-events: auto; }

      .ssv-manage-row { display: flex; }
      .ssv-manage-row .ssv-btn { width: 100%; justify-content: center; }

      .ssv-menu {
        position: absolute; top: calc(100% + 6px); left: 0;
        min-width: 220px; max-width: 100%;
        max-height: 260px; overflow: auto;
        background: #ffffff; color: #0b2a6f;
        border-radius: 10px; border: 1px solid rgba(0,0,0,.15);
        box-shadow: 0 12px 28px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.2);
        padding: 4px; display: none; z-index: 2147483647;
        pointer-events: auto;
      }
      .ssv-menu.open { display: block; }
      .ssv-menu.flip { top: auto; bottom: calc(100% + 6px); }
      .ssv-menu .ssv-empty { padding: 8px; color: rgba(0,0,0,.55); }

      .ssv-opt {
        padding: 8px 10px; border-radius: 8px; font-weight: 700; color: #0b2a6f;
        overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
      }
      .ssv-opt:hover { background: rgba(11,92,255,.08); cursor: pointer; }

      .ssv-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,.35); display: none;
        z-index: 2147483647;
        pointer-events: auto;
      }
      .ssv-backdrop.open { display: block; }

      .ssv-modal {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(600px, 92vw); max-height: min(68vh, 560px);
        background: #fff; color: #0b2a6f; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,.28);
        display: flex; flex-direction: column; overflow: hidden;
        pointer-events: auto;
      }
      .ssv-modal-header {
        padding: 12px 14px; display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid rgba(0,0,0,.08); font-weight: 800;
      }
      .ssv-modal-body { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
      .ssv-row-item {
        display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px;
        padding: 8px 10px; border: 1px solid rgba(0,0,0,.08); border-radius: 8px;
      }
      .ssv-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
      .ssv-modal-footer {
        padding: 10px; display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid rgba(0,0,0,.08);
      }
      .ssv-danger { background: #ffe5e8 !important; color: #b00020 !important; border-color: rgba(176,0,32,.25) !important; }
    `);

    function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
    function loadPos() { try { const pos = JSON.parse(localStorage.getItem(POS_KEY)); if (!pos) return null; const { left, top } = pos; if (typeof left !== 'number' || typeof top !== 'number') return null; return { left, top }; } catch { return null; } }
    function savePos(left, top) { localStorage.setItem(POS_KEY, JSON.stringify({ left, top })); }

    const UN_KEY = 'ssvUsernames:v1';
    function loadUsernames() { try { return JSON.parse(GM_getValue(UN_KEY, '[]')) || []; } catch { return []; } }
    function saveUsernames(list) { try { GM_setValue(UN_KEY, JSON.stringify(list || [])); } catch {} }

    const COUNT_KEY = 'ssvDownloadCounts:v1';
    function loadCounts() { try { return JSON.parse(GM_getValue(COUNT_KEY, '{}')) || {}; } catch { return {}; } }
    function saveCounts(obj) { try { GM_setValue(COUNT_KEY, JSON.stringify(obj || {})); } catch {} }
    function getCount(u) { const c = loadCounts(); return c[(u || '').trim().toLowerCase()] | 0; }
    function addToCount(u, delta = 1) {
      u = (u || '').trim().toLowerCase();
      if (!u) return;
      const c = loadCounts();
      c[u] = (c[u] | 0) + delta;
      saveCounts(c);
    }
    function deleteCount(u) {
      u = (u || '').trim().toLowerCase();
      if (!u) return;
      const c = loadCounts();
      if (u in c) { delete c[u]; saveCounts(c); }
    }
    function clearAllCounts() { saveCounts({}); }

    function addUsername(u) {
      u = (u || '').trim().toLowerCase();
      if (!u) return;
      const list = loadUsernames().filter(x => x !== u);
      list.unshift(u);
      if (list.length > 200) list.length = 200;
      saveUsernames(list);
      renderSavedUI();
    }
    function removeUsername(u) {
      const norm = (u || '').trim().toLowerCase();
      saveUsernames(loadUsernames().filter(x => x !== norm));
      deleteCount(norm);
      renderSavedUI();
    }
    function clearUsernames() {
      saveUsernames([]);
      clearAllCounts();
      renderSavedUI();
    }

    function getFormInput() { return document.querySelector('input[name="text_username"]'); }
    function waitForFormInput(timeoutMs = 15000) {
      return new Promise((resolve) => {
        const el = getFormInput();
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
          const e = getFormInput();
          if (e) { obs.disconnect(); resolve(e); }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
      });
    }

    (async () => {
      const inp = await waitForFormInput();
      if (!inp) return;
      const form = inp.form || inp.closest('form');
      if (!form) return;
      form.addEventListener('submit', () => {
        const val = (inp.value || '').trim();
        if (val) addUsername(val);
      }, { capture: true });
    })();
    (async () => {
      const inp = await waitForFormInput();
      if (!inp) return;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = (inp.value || '').trim();
          if (val) addUsername(val);
        }
      }, { capture: true });
    })();

    let menuOpen = false;
    function closeMenu(menu) { if (!menu) return; menu.classList.remove('open', 'flip'); menuOpen = false; }
    function positionMenuRelativeToButton(btn, menu) {
      if (!btn || !menu) return;
      const btnRect = btn.getBoundingClientRect();
      const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
      menu.style.minWidth = btnRect.width + 'px';
      const spaceBelow = vh - btnRect.bottom - 10;
      const spaceAbove = btnRect.top - 10;
      const targetMax = 260;
      if (spaceBelow < 160 && spaceAbove > spaceBelow) {
        menu.classList.add('flip');
        menu.style.maxHeight = Math.min(targetMax, spaceAbove) + 'px';
      } else {
        menu.classList.remove('flip');
        menu.style.maxHeight = Math.min(targetMax, spaceBelow) + 'px';
      }
    }
    function toggleMenu(btn, menu) {
      if (!menu) return;
      if (menu.classList.contains('open')) {
        closeMenu(menu);
        btn && btn.setAttribute('aria-expanded', 'false');
      } else {
        positionMenuRelativeToButton(btn, menu);
        menu.classList.add('open');
        btn && btn.setAttribute('aria-expanded', 'true');
        menuOpen = true;
      }
    }

    function renderSavedUI() {
      const card = document.querySelector('.ssv-card');
      if (!card) return;

      const names = loadUsernames();
      const savedBtn = card.querySelector('[data-id="un-saved-btn"]');
      const menu = card.querySelector('[data-id="un-menu"]');
      const manageList = document.querySelector('.ssv-modal-body');

      if (savedBtn) savedBtn.textContent = `Saved (${names.length}) ▾`;

      if (menu) {
        if (!names.length) menu.innerHTML = `<div class="ssv-empty">No saved usernames yet.</div>`;
        else menu.innerHTML = names.map(u => `<div class="ssv-opt" data-user="${u}" title="${u}">${u}</div>`).join('');
      }

      if (manageList) {
        if (!names.length) {
          manageList.innerHTML = `<div class="ssv-empty">No saved usernames.</div>`;
        } else {
          manageList.innerHTML = names.map(u => {
            const total = getCount(u);
            return `
              <div class="ssv-row-item">
                <div class="ssv-row-name" title="${u}">${u}</div>
                <div style="display:flex; gap:6px; align-items:center;">
                  <span class="ssv-badge ssv-small" title="Total successful downloads for this username">
                    Total: <span class="ssv-mono" style="margin-left:4px">${total}</span>
                  </span>
                  <button class="ssv-btn ssv-danger" data-action="m-del" data-user="${u}">Delete</button>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }

    function buildUI() {
      const wrap = document.createElement('div');
      wrap.className = 'ssv-helper';
      wrap.innerHTML = `
        <div class="ssv-card" role="region" aria-label="StorySaver Downloader" tabindex="-1">
          <div class="ssv-row ssv-header">
            <div class="ssv-title ssv-handle">StorySaver Downloader</div>
            <div>
              <button class="ssv-btn" data-action="start" title="Scan & Download">Start</button>
            </div>
          </div>

          <div class="ssv-section">
            <div class="ssv-grid">
              <div class="ssv-small" data-id="status">Idle</div>
              <div class="ssv-badge ssv-small">Found: <span class="ssv-mono" data-id="found" style="margin-left:4px">0</span></div>
              <div class="ssv-badge ssv-small">Pending: <span class="ssv-mono" data-id="pending" style="margin-left:4px">0</span></div>
            </div>
          </div>

          <div class="ssv-section">
            <input class="ssv-input" type="text" data-id="un-input" placeholder="Add or select a username (no auto-submit)" />
            <div class="ssv-actions">
              <div class="ssv-actions-left">
                <button class="ssv-btn" data-action="un-add" title="Add to memory">Add</button>
                <button class="ssv-btn" data-action="un-clear" title="Clear all">Clear</button>
              </div>
              <div class="ssv-actions-right">
                <button class="ssv-btn ghost" data-action="un-menu" data-id="un-saved-btn" aria-haspopup="listbox" aria-expanded="false">Saved (0) ▾</button>
                <div class="ssv-menu" data-id="un-menu" role="listbox" aria-label="Saved usernames"></div>
              </div>
            </div>
            <div class="ssv-manage-row">
              <button class="ssv-btn ghost" data-action="un-manage" title="Manage saved usernames">Manage saved usernames</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);

      const backdrop = document.createElement('div');
      backdrop.className = 'ssv-backdrop';
      backdrop.setAttribute('data-id', 'manage-backdrop');
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.innerHTML = `
        <div class="ssv-modal" role="dialog" aria-modal="true" aria-label="Manage saved usernames">
          <div class="ssv-modal-header">
            <span>Manage saved usernames</span>
            <button class="ssv-btn" data-action="m-close">Close</button>
          </div>
          <div class="ssv-modal-body"><!-- rows injected here --></div>
          <div class="ssv-modal-footer">
            <button class="ssv-btn ssv-danger" data-action="m-clear-all">Delete all</button>
            <button class="ssv-btn" data-action="m-close">Done</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const card = wrap.querySelector('.ssv-card');
      const statusEl = wrap.querySelector('[data-id="status"]');
      const foundEl = wrap.querySelector('[data-id="found"]');
      const pendingEl = wrap.querySelector('[data-id="pending"]');
      const startBtn = wrap.querySelector('[data-action="start"]');

      const menu = card.querySelector('[data-id="un-menu"]');
      const savedBtn = card.querySelector('[data-id="un-saved-btn"]');
      const modal = backdrop.querySelector('.ssv-modal');

      function openManage() {
        renderSavedUI();
        backdrop.classList.add('open');
        backdrop.setAttribute('aria-hidden', 'false');
        closeMenu(menu);
      }
      function closeManage() {
        backdrop.classList.remove('open');
        backdrop.setAttribute('aria-hidden', 'true');
      }

      renderSavedUI();

      const saved = loadPos();
      if (saved) {
        card.style.position = 'fixed';
        requestAnimationFrame(() => {
          const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
          const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
          const r = card.getBoundingClientRect();
          const left = clamp(saved.left, 0, vw - r.width);
          const top  = clamp(saved.top,  0, vh - r.height);
          card.style.left = left + 'px';
          card.style.top  = top + 'px';
          card.style.right = 'auto';
          card.style.bottom = 'auto';
        });
      }

      const ui = {
        setTotal(n) { pendingEl.textContent = String(n); },
        setFound(n) { foundEl.textContent = String(n); },
        update(msg) { statusEl.textContent = msg; },
        tick() {
          const n = Math.max(0, (+pendingEl.textContent || 0) - 1);
          pendingEl.textContent = String(n);
        },
        warn(msg) { console.warn('[StorySaver DL]', msg); },
        done() { this.update('Done'); startBtn.disabled = false; }
      };

      startBtn.addEventListener('click', async () => {
        try {
          startBtn.disabled = true;
          ui.update('Scanning…');

          const username = getUsername();
          const urls = dedupeByKey(collectUrls());
          ui.setFound(urls.length);

          if (urls.length === 0) {
            ui.update('No CDN URLs found.');
            startBtn.disabled = false;
            return;
          }

          await downloadQueue(urls, username, ui);
        } catch (e) {
          ui.update('Error. See console.');
          console.warn('[StorySaver DL] Start error:', e);
          startBtn.disabled = false;
        }
      });

      card.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');

        if (btn) {
          const act = btn.getAttribute('data-action');

          if (act === 'un-add') {
            const input = card.querySelector('[data-id="un-input"]');
            addUsername(input.value);
            input.value = '';
            return;
          }

          if (act === 'un-clear') {
            if (confirm('Clear all saved usernames?')) clearUsernames();
            return;
          }

          if (act === 'un-menu') {
            positionMenuRelativeToButton(btn, menu);
            toggleMenu(btn, menu);
            return;
          }

          if (act === 'un-manage') {
            openManage();
            return;
          }
        }

        const opt = e.target.closest('.ssv-opt');
        if (opt) {
          const u = opt.getAttribute('data-user');
          const inp = await waitForFormInput();
          if (!inp) return;
          inp.value = u;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.focus(); inp.scrollIntoView({ block: 'center', behavior: 'smooth' });
          closeMenu(menu);
          return;
        }
      });

      backdrop.addEventListener('click', (e) => {
        if (!modal.contains(e.target)) {
          closeManage();
          return;
        }
        const btn = e.target.closest('button');
        if (!btn) return;
        const act = btn.getAttribute('data-action');
        if (act === 'm-close') {
          closeManage();
        } else if (act === 'm-clear-all') {
          if (confirm('Delete ALL saved usernames?')) clearUsernames();
        } else if (act === 'm-del') {
          const u = btn.getAttribute('data-user');
          removeUsername(u);
        }
      });

      const reflowMenu = () => {
        if (!menuOpen) return;
        positionMenuRelativeToButton(savedBtn, menu);
      };
      window.addEventListener('resize', reflowMenu, { passive: true });
      window.addEventListener('scroll', reflowMenu, { passive: true });

      document.addEventListener('click', (e) => {
        if (!menuOpen) return;
        if (!card.contains(e.target)) closeMenu(menu);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeMenu(menu);
          closeManage();
        }
      });

      (function drag() {
        let sx = 0, sy = 0, bx = 0, by = 0, down = false;
        const handle = card.querySelector('.ssv-handle');
        handle.addEventListener('mousedown', e => {
          down = true; sx = e.clientX; sy = e.clientY;
          const r = card.getBoundingClientRect(); bx = r.left; by = r.top;
          e.preventDefault(); e.stopPropagation();
        });
        document.addEventListener('mousemove', e => {
          if (!down) return;
          const nx = bx + (e.clientX - sx);
          const ny = by + (e.clientY - sy);
          card.style.position = 'fixed';
          card.style.left = nx + 'px';
          card.style.top = ny + 'px';
          card.style.right = 'auto';
          card.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
          if (!down) return;
          down = false;
          const rect = card.getBoundingClientRect();
          const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
          const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
          const left = clamp(rect.left, 0, vw - rect.width);
          const top  = clamp(rect.top,  0, vh - rect.height);
          card.style.left = left + 'px';
          card.style.top = top + 'px';
          savePos(left, top);
        });
        window.addEventListener('resize', () => {
          const rect = card.getBoundingClientRect();
          const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
          const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
          const left = clamp(rect.left, 0, vw - rect.width);
          const top  = clamp(rect.top,  0, vh - rect.height);
          card.style.left = left + 'px';
          card.style.top = top + 'px';
          savePos(left, top);
        });
      })();

      return ui;
    }

    const ui = buildUI();
    console.log('StorySaver downloader');
  }
})();
