// ==UserScript==
// @name         Instagram CDN URL Extractor & Safe Downloader (StorySaver) — Minimal
// @namespace    your-namespace
// @version      7.0
// @author       ne0liberal
// @description  Extract CDN URLs on StorySaver and download with retries and real success tracking—without blocking site usage
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
        let usedGMDownload = false;
        if (typeof GM_download === 'function') {
          try {
            const started = GM_download({
              url,
              name: filename,
              onprogress: (e) => onProgress && onProgress(e),
              ontimeout: () => reject(new Error('timeout')),
              onerror: (e) => reject(new Error((e && e.error) || 'GM_download error')),
              onload: () => resolve(true),
            });
            if (started) usedGMDownload = true;
          } catch (e) { /* fall through */ }
        }
        if (usedGMDownload) return;

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
              setTimeout(() => {
                URL.revokeObjectURL(a.href);
                a.remove();
              }, 2500);

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
      .ssv-helper { position: fixed; bottom: 16px; right: 16px; z-index: 2147483646; font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; pointer-events: none; }
      .ssv-card { background: #0b5cff !important; color: #fff !important; padding: 10px 12px !important; border-radius: 8px !important; box-shadow: 0 4px 14px rgba(0,0,0,0.25) !important; width: 260px !important; pointer-events: auto !important; box-sizing: border-box !important; }
      .ssv-row { display: flex !important; gap: 6px !important; align-items: center !important; margin-top: 6px !important; flex-wrap: nowrap !important; justify-content: space-between !important; }
      .ssv-left { display:flex; align-items:center; gap:6px; min-width:0; }
      .ssv-right { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
      .ssv-btn { cursor: pointer !important; padding: 6px 8px !important; border: 1px solid rgba(0,0,0,0.15) !important; border-radius: 6px !important; background: #ffffff !important; color: #0b5cff !important; font-weight: 700 !important; line-height: 1 !important; white-space: nowrap !important; }
      .ssv-btn:disabled { opacity: 0.55 !important; cursor: default !important; }
      .ssv-btn:focus { outline: 2px solid rgba(255,255,255,0.9) !important; outline-offset: 1px !important; }
      .ssv-pill { font-weight: 700 !important; }
      .ssv-small { opacity: 0.95 !important; font-size: 11px !important; }
    `);

    function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

    function loadPos() {
      try {
        const pos = JSON.parse(localStorage.getItem(POS_KEY));
        if (!pos) return null;
        const { left, top } = pos;
        if (typeof left !== 'number' || typeof top !== 'number') return null;
        return { left, top };
      } catch { return null; }
    }
    function savePos(left, top) {
      localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
    }

    function buildUI() {
      const wrap = document.createElement('div');
      wrap.className = 'ssv-helper';
      wrap.innerHTML = `
        <div class="ssv-card" role="region" aria-label="StorySaver Downloader" tabindex="-1">
          <div class="ssv-row">
            <div class="ssv-left">
              <div class="ssv-pill ssv-handle">StorySaver Downloader</div>
            </div>
            <div class="ssv-right">
              <button class="ssv-btn" data-action="start" title="Scan & Download">Start</button>
            </div>
          </div>
          <div class="ssv-row">
            <span class="ssv-small" data-id="status">Idle</span>
          </div>
          <div class="ssv-row">
            <span class="ssv-small">Found: <span class="ssv-small" data-id="found">0</span></span>
            <span class="ssv-small">Pending: <span class="ssv-small" data-id="pending">0</span></span>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);

      const card = wrap.querySelector('.ssv-card');
      const statusEl = wrap.querySelector('[data-id="status"]');
      const foundEl = wrap.querySelector('[data-id="found"]');
      const pendingEl = wrap.querySelector('[data-id="pending"]');
      const startBtn = wrap.querySelector('[data-action="start"]');

      const saved = loadPos();
      if (saved) {
        card.style.position = 'fixed';
        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        const rect = { w: 260, h: 120 }; // rough default size
        const left = clamp(saved.left, 0, vw - rect.w);
        const top  = clamp(saved.top,  0, vh - rect.h);
        card.style.left = left + 'px';
        card.style.top  = top + 'px';
        card.style.right = 'auto';
        card.style.bottom = 'auto';
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
          const urls = collectUrls();
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
          card.style.top  = top + 'px';
          savePos(left, top);
        });
        window.addEventListener('resize', () => {
          const rect = card.getBoundingClientRect();
          const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
          const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
          const left = clamp(rect.left, 0, vw - rect.width);
          const top  = clamp(rect.top,  0, vh - rect.height);
          card.style.left = left + 'px';
          card.style.top  = top + 'px';
          savePos(left, top);
        });
      })();

      return ui;
    }

    const ui = buildUI();
    console.log('StorySaver downloader loaded');
  }
})();
