// ==UserScript==
// @name         Instagram CDN URL Extractor & Safe Downloader (StorySaver)
// @namespace    your-namespace
// @version      10.3
// @author       ne0liberal
// @description  Download IG stories via storysaver
// @match        https://www.storysaver.net/*
// @updateURL    https://github.com/n30liberal/random-userscripts/raw/main/storysaver-enhancer.user.js
// @downloadURL  https://github.com/n30liberal/random-userscripts/raw/main/storysaver-enhancer.user.js
// @resource     ssvCSS https://raw.githubusercontent.com/n30liberal/random-userscripts/main/storysaver-enhancer.css
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @connect      *.cdninstagram.com
// ==/UserScript==

(function () {
  'use strict';

  // --- Deep-link support: https://www.storysaver.net/?username=WHATEVER[&go=1]
  (function bootstrapDeepLink() {
    try {
      const u = new URL(location.href);
      const raw = (u.searchParams.get('user') || u.searchParams.get('username') || '').trim();
      const autoGo = (u.searchParams.get('go') || '').trim(); // "1" to auto-submit
      if (raw) {
        const cleaned = raw.replace(/^@+/, '').trim();
        sessionStorage.setItem('ssv:prefill', cleaned);
        if (autoGo) sessionStorage.setItem('ssv:auto', '1');
      }
    } catch (e) {
      console.warn('[StorySaver DL] deep-link bootstrap error:', e);
    }
  })();

  function safe(fn) { try { return fn(); } catch (e) { console.warn('[StorySaver DL] init error:', e); } }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => safe(init));
  } else {
    safe(init);
  }

  function init() {
    function GM_GetValueSafe(key, def) {
      try { return GM_getValue(key, def); } catch { return def; }
    }
    function GM_SetValueSafe(key, val) {
      try { GM_setValue(key, val); } catch {}
    }

    const storedTheme = (GM_GetValueSafe('ssvSiteTheme', 'dark') || 'dark').toLowerCase();
    const theme = (storedTheme === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-ssv-theme', theme);
    document.body.classList.add('ssv-skin');

    // Inject external CSS from @resource
    try {
      const css = (typeof GM_getResourceText === 'function') ? GM_getResourceText('ssvCSS') : '';
      if (css) GM_addStyle(css);
    } catch (e) {
      console.warn('[StorySaver DL] CSS resource load failed:', e);
    }

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
          ui.update(`@${username} — Downloading ${i + 1}/${toDownload.length} (try ${attempt})`);
          try {
            await downloadOne(url, fname, () => {});
            success = true;
            history[keyFromUrl(url)] = true;
            saveHistory(username, history);
            addToCount(username, 1);
            setLast(username, Date.now());
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

      ui.done(`@${username} — Done`);
    }

    const POS_KEY = 'ssv-card-pos';

    function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
    function loadPos() { try { const pos = JSON.parse(localStorage.getItem(POS_KEY)); if (!pos) return null; const { left, top } = pos; if (typeof left !== 'number' || typeof top !== 'number') return null; return { left, top }; } catch { return null; } }
    function savePos(left, top) { localStorage.setItem(POS_KEY, JSON.stringify({ left, top })); }

    const UN_KEY = 'ssvUsernames:v1';
    function loadUsernames() { try { return JSON.parse(GM_GetValueSafe(UN_KEY, '[]')) || []; } catch { return []; } }
    function saveUsernames(list) { try { GM_SetValueSafe(UN_KEY, JSON.stringify(list || [])); } catch {} }

    const COUNT_KEY = 'ssvDownloadCounts:v1';
    function loadCounts() { try { return JSON.parse(GM_GetValueSafe(COUNT_KEY, '{}')) || {}; } catch { return {}; } }
    function saveCounts(obj) { try { GM_SetValueSafe(COUNT_KEY, JSON.stringify(obj || {})); } catch {} }
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

    const LAST_KEY = 'ssvLastDownloadedAt:v1';
    function loadLasts() { try { return JSON.parse(GM_GetValueSafe(LAST_KEY, '{}')) || {}; } catch { return {}; } }
    function saveLasts(obj) { try { GM_SetValueSafe(LAST_KEY, JSON.stringify(obj || {})); } catch {} }
    function getLast(u) {
      u = (u || '').trim().toLowerCase();
      const m = loadLasts()[u];
      return (typeof m === 'number' && isFinite(m)) ? m : null;
    }
    function setLast(u, epochMs) {
      u = (u || '').trim().toLowerCase();
      if (!u) return;
      const m = loadLasts();
      m[u] = +epochMs;
      saveLasts(m);
    }
    function deleteLast(u) {
      u = (u || '').trim().toLowerCase();
      if (!u) return;
      const m = loadLasts();
      if (u in m) { delete m[u]; saveLasts(m); }
    }
    function clearAllLasts() { saveLasts({}); }

    function formatLast(epochMs) {
      if (!epochMs) return '—';
      const d = new Date(epochMs);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      let h = d.getHours();
      const m = String(d.getMinutes() + '').padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      return `${yyyy}-${mm}-${dd} ${h}:${m} ${ampm}`;
    }

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
      deleteLast(norm);
      renderSavedUI();
    }
    function clearUsernames() {
      saveUsernames([]);
      clearAllCounts();
      clearAllLasts();
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
            const last = formatLast(getLast(u));
            return `
              <div class="ssv-row-item">
                <div class="ssv-row-name" title="${u}">${u}</div>
                <div style="display:flex; gap:6px; align-items:center;">
                  <span class="ssv-badge ssv-small" title="Total successful downloads for this username">
                    Total: <span class="ssv-mono" style="margin-left:4px">${total}</span>
                  </span>
                  <span class="ssv-badge ssv-small" title="Last time a download completed for this username">
                    Last: <span class="ssv-mono" style="margin-left:4px">${last}</span>
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
              <label class="ssv-switch" title="Toggle site dark mode" aria-label="Dark mode">
                <input type="checkbox" data-action="site-dark-toggle" />
              </label>
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
      const darkToggle = wrap.querySelector('input[data-action="site-dark-toggle"]');

      const menu = card.querySelector('[data-id="un-menu"]');
      const savedBtn = card.querySelector('[data-id="un-saved-btn"]');
      const modal = backdrop.querySelector('.ssv-modal');

      const initialTheme = (document.documentElement.getAttribute('data-ssv-theme') || 'dark').toLowerCase();
      darkToggle.checked = (initialTheme === 'dark');

      darkToggle.addEventListener('change', () => {
        const mode = darkToggle.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-ssv-theme', mode);
        GM_SetValueSafe('ssvSiteTheme', mode);
      });

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
        done(msg) { this.update(msg || 'Done'); startBtn.disabled = false; }
      };

      startBtn.addEventListener('click', async () => {
        try {
          startBtn.disabled = true;

          const username = getUsername();
          ui.update(`@${username} — Scanning…`);

          const urls = dedupeByKey(collectUrls());
          ui.setFound(urls.length);

          if (urls.length === 0) {
            ui.update(`@${username} — No CDN URLs found.`);
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
        if (opt && opt.hasAttribute('data-user')) {
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
        if (!card.contains(e.target)) {
          closeMenu(menu);
        }
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

    // --- Prefill username from deep-link (sessionStorage), optionally auto-submit
    (async function prefillFromDeepLink() {
      try {
        const name = (sessionStorage.getItem('ssv:prefill') || '').trim();
        const auto = sessionStorage.getItem('ssv:auto');
        if (!name) return;

        // one-shot
        sessionStorage.removeItem('ssv:prefill');
        sessionStorage.removeItem('ssv:auto');

        const inp = await waitForFormInput(15000);
        if (!inp) return;

        inp.value = name;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.focus();

        addUsername(name);

        if (auto === '1') {
          const form = inp.form || inp.closest('form');
          if (form) {
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
          }
        }
      } catch (e) {
        console.warn('[StorySaver DL] prefill error:', e);
      }
    })();

    console.log('StorySaver downloader');

    (async function setupAutocomplete() {
      const inp = await waitForFormInput(20000);
      if (!inp) return;

      const menu = document.createElement('div');
      menu.className = 'ssv-ac';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', 'Saved usernames suggestions');
      document.body.appendChild(menu);

      let open = false;
      let items = [];
      let activeIndex = -1;

      function getNames() {
        return loadUsernames();
      }

      function positionMenu() {
        if (!open) return;
        const r = inp.getBoundingClientRect();
        menu.style.left = r.left + 'px';
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.width = r.width + 'px';
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        const spaceBelow = vh - r.bottom - 10;
        const spaceAbove = r.top - 10;
        menu.style.maxHeight = (spaceBelow < 160 && spaceAbove > spaceBelow) ? Math.min(260, spaceAbove) + 'px' : '260px';
        if (spaceBelow < 160 && spaceAbove > spaceBelow) {
          menu.style.top = (r.top - menu.offsetHeight - 4) + 'px';
        }
      }

      function close() {
        open = false;
        activeIndex = -1;
        menu.classList.remove('open');
        menu.innerHTML = '';
        inp.removeAttribute('aria-activedescendant');
      }

      function ensureOpen() {
        if (!open) {
          open = true;
          menu.classList.add('open');
          positionMenu();
        }
      }

      function render(list, query) {
        items = list;
        activeIndex = list.length ? 0 : -1;
        if (!list.length) {
          menu.innerHTML = `<div class="ssv-ac-empty">No matches</div>`;
          return;
        }
        const q = (query || '').toLowerCase();
        menu.innerHTML = list.map((u, i) => {
          const idx = u.indexOf(q);
          let label = u;
          if (q && idx >= 0) {
            label = u.slice(0, idx) + '<strong>' + u.slice(idx, idx + q.length) + '</strong>' + u.slice(idx + q.length);
          }
          return `<div class="ssv-ac-item${i===0?' active':''}" role="option" id="ssv-ac-${i}" data-user="${u}" title="${u}">${label}</div>`;
        }).join('');
        if (activeIndex >= 0) {
          inp.setAttribute('aria-activedescendant', `ssv-ac-${activeIndex}`);
        }
      }

      function filter(query, amount) {
        const names = getNames();
        if (!names.length) return [];
        const q = (query || '').toLowerCase();
        if (!q) return amount ? names.slice(0, amount) : names;
        const starts = [];
        const contains = [];
        for (const n of names) {
          const idx = n.toLowerCase().indexOf(q);
          if (idx === 0) starts.push(n);
          else if (idx > 0) contains.push(n);
        }
        const out = [...starts, ...contains];
        return amount ? out.slice(0, amount) : out;
      }

      function complete(value) {
        inp.value = value;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.focus();
        inp.setSelectionRange(value.length, value.length);
      }

      function setActive(i) {
        if (!items.length) return;
        const max = items.length - 1;
        activeIndex = Math.max(0, Math.min(max, i));
        const els = menu.querySelectorAll('.ssv-ac-item');
        els.forEach((el, idx) => {
          if (el.classList) {
            if (idx === activeIndex) el.classList.add('active');
            else el.classList.remove('active');
          }
        });
        inp.setAttribute('aria-activedescendant', `ssv-ac-${activeIndex}`);
        const activeEl = menu.querySelector(`#ssv-ac-${activeIndex}`);
        if (activeEl) {
          const mbr = menu.getBoundingClientRect();
          const abr = activeEl.getBoundingClientRect();
          if (abr.top < mbr.top) menu.scrollTop -= (mbr.top - abr.top);
          else if (abr.bottom > mbr.bottom) menu.scrollTop += (abr.bottom - mbr.bottom);
        }
      }

      inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('role', 'combobox');
      inp.setAttribute('aria-autocomplete', 'list');
      inp.setAttribute('aria-expanded', 'false');

      const update = () => {
        const q = inp.value.trim();
        const list = filter(q);
        if (!list.length) {
          close();
          inp.setAttribute('aria-expanded', 'false');
          return;
        }
        ensureOpen();
        render(list, q.toLowerCase());
        positionMenu();
        inp.setAttribute('aria-expanded', 'true');
      };

      let t = 0;
      const debouncedUpdate = () => {
        clearTimeout(t);
        t = setTimeout(update, 60);
      };

      inp.addEventListener('input', debouncedUpdate, { passive: true });
      inp.addEventListener('focus', () => {
        debouncedUpdate();
      }, { passive: true });

      inp.addEventListener('blur', () => {
        setTimeout(() => {
          if (!menu.matches(':hover')) close();
        }, 120);
      }, { passive: true });

      inp.addEventListener('keydown', (e) => {
        if (!open) {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && getNames().length) {
            ensureOpen(); update();
            e.preventDefault();
          }
          return;
        }
        if (e.key === 'ArrowDown') {
          setActive(activeIndex + 1);
          e.preventDefault();
        } else if (e.key === 'ArrowUp') {
          setActive(activeIndex - 1);
          e.preventDefault();
        } else if (e.key === 'Enter') {
          if (activeIndex >= 0 && items[activeIndex]) {
            complete(items[activeIndex]);
            close();
          }
        } else if (e.key === 'Tab') {
          if (activeIndex >= 0 && items[activeIndex]) {
            complete(items[activeIndex]);
            close();
          }
        } else if (e.key === 'Escape') {
          close();
          e.preventDefault();
        }
      });

      menu.addEventListener('mousemove', (e) => {
        const el = e.target.closest('.ssv-ac-item');
        if (!el) return;
        const idx = Number(el.id.replace('ssv-ac-', ''));
        if (Number.isFinite(idx)) setActive(idx);
      }, { passive: true });

      menu.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });

      menu.addEventListener('click', (e) => {
        const el = e.target.closest('.ssv-ac-item');
        if (!el) return;
        const u = el.getAttribute('data-user');
        if (u) {
          complete(u);
          close();
        }
      });

      const reflow = () => {
        if (!open) return;
        positionMenu();
      };
      window.addEventListener('scroll', reflow, { passive: true });
      window.addEventListener('resize', reflow, { passive: true });
      new ResizeObserver(reflow).observe(document.documentElement);
    })();

  }
})();
