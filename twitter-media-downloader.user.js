// ==UserScript==
// @name        Twitter Media Downloader
// @description Save Video/Photo by One-Click.
// @version     1.55
// @author      AMANE
// @namespace   none
// @match       https://x.com/*
// @match       https://mobile.x.com/*
// @grant       GM_registerMenuCommand
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_download
// @grant       GM_xmlhttpRequest
// @connect     cdn.syndication.twimg.com
// @connect     video.twimg.com
// @connect     pbs.twimg.com
// @connect     twimg.com
// @require     https://cdnjs.cloudflare.com/ajax/libs/jszip/3.9.1/jszip.min.js
// @compatible  Chrome
// @compatible  Firefox
// @compatible  Helium
// @license     MIT
// @downloadURL https://github.com/ne0lith/random-userscripts/raw/main/twitter-media-downloader.user.js
// @updateURL https://github.com/ne0lith/random-userscripts/raw/main/twitter-media-downloader.user.js
// ==/UserScript==

const filename = 'twitter_{user-name}(@{user-id})_{date-time}_{status-id}_{file-type}';

const TMD = (function () {
  let lang, host, history, historySet, show_sensitive, is_tweetdeck;
  let detectPending = [];
  let detectScheduled = false;
  const INVALID_CHARS = {
    '\\': '\uFF3C', '\/': '\uFF0F', '\|': '\uFF5C', '<': '\uFF1C', '>': '\uFF1E',
    ':': '\uFF1A', '*': '\uFF0A', '?': '\uFF1F', '"': '\uFF02',
    '\u200b': '', '\u200c': '', '\u200d': '', '\u2060': '', '\ufeff': '', '\uD83D\uDD1E': ''
  };

  function statusIdFromHref(href) {
    if (!href) return null;
    let part = href.split('/status/').pop();
    return part ? part.split(/[/?#]/).shift() : null;
  }

  // Prefer the tweet's own permalink, never a nested quote / analytics link.
  function statusIdFromArticle(article) {
    if (!article) return null;
    let time = article.querySelector('a[href*="/status/"] time') || article.querySelector('time');
    if (time) {
      let timeLink = time.closest('a[href*="/status/"]');
      let id = statusIdFromHref(timeLink && timeLink.href);
      if (id) return id;
    }
    let anchors = article.querySelectorAll('a[href*="/status/"]');
    for (let i = 0; i < anchors.length; i++) {
      let a = anchors[i];
      if (a.closest('[data-testid="quoteTweet"]')) continue;
      let href = a.getAttribute('href') || '';
      if (/\/status\/\d+\/(analytics|likes|retweets|quotes|photo|video)/.test(href)) {
        let id = statusIdFromHref(href);
        if (id) return id;
        continue;
      }
      if (!/\/status\/\d+\/?$/.test(href.split('?')[0])) continue;
      let id = statusIdFromHref(a.href);
      if (id) return id;
    }
    return null;
  }

  function sanitize(text) {
    return String(text || '').replace(/([\\/|<>*?:"]|[\u200b-\u200d\u2060\ufeff]|\uD83D\uDD1E)/g, v => INVALID_CHARS[v] || '');
  }

  function syncHistorySet() {
    historySet = new Set(Array.isArray(history) ? history : []);
  }

  function historyHas(status_id) {
    return historySet && historySet.has(status_id);
  }

  function historyAdd(status_id) {
    if (!historyHas(status_id)) {
      history.push(status_id);
      historySet.add(status_id);
    }
  }

  function overlayButtonHtml(svg) {
    return '<div><div><svg viewBox="0 0 24 24" style="width: 18px; height: 18px;">' + svg + '</svg></div></div>';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  const LIMIT_DEFAULTS = {
    download_max_threads: 2,
    download_max_retries: 2,
    download_throttle_after: 3,
    bulk_hard_cap: 5000,
    bulk_zip_max_files: 80,
    bulk_zip_max_mb: 400,
    bulk_scrape_limit: 50
  };

  async function getPositiveInt(key, fallback) {
    let v = parseInt(await GM_getValue(key, fallback), 10);
    return !isNaN(v) && v > 0 ? v : fallback;
  }

  function syndicationToken(id) {
    return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  }

  function isMediaPage() {
    return /^\/[^/]+\/media\/?$/.test(location.pathname);
  }

  function mediaPageUser() {
    let m = location.pathname.match(/^\/([^/]+)\/media\/?$/);
    return m ? m[1] : 'user';
  }

  return {
    init: async function () {
      await this.downloader.refreshLimits();
      lang = this.language.en;
      GM_registerMenuCommand(lang.settings, this.settings);
      host = location.hostname;
      is_tweetdeck = host.indexOf('tweetdeck') >= 0;
      let obsolete = this.storage_obsolete();
      if (obsolete.length) {
        await this.storage(obsolete);
        this.storage_obsolete(true);
      }
      history = await this.storage();
      syncHistorySet();
      show_sensitive = GM_getValue('show_sensitive', false);
      document.head.insertAdjacentHTML('beforeend', '<style>' + this.css + (show_sensitive ? this.css_ss : '') + '</style>');
      let self = this;
      let observer = new MutationObserver(ms => {
        ms.forEach(m => m.addedNodes.forEach(node => {
          if (!node || node.nodeType !== 1) return;
          detectPending.push(node);
        }));
        if (!detectScheduled) {
          detectScheduled = true;
          requestAnimationFrame(() => {
            detectScheduled = false;
            let nodes = detectPending;
            detectPending = [];
            nodes.forEach(node => self.detect(node));
            self.bulk.ensureBar();
          });
        }
      });
      observer.observe(document.body, {childList: true, subtree: true});
      this.bulk.ensureBar();
      GM_registerMenuCommand(lang.bulk.menu, () => this.bulk.toggleFromMenu());
    },
    detect: function(node) {
      if (!node || node.nodeType !== 1) return;
      let article = node.tagName === 'ARTICLE' && node || node.tagName === 'DIV' && (node.querySelector('article') || node.closest('article'));
      if (article) this.addButtonTo(article);
      let listitems = [];
      if (node.tagName === 'LI' && node.getAttribute('role') === 'listitem') {
        listitems.push(node);
      } else {
        let closest = node.closest('li[role="listitem"]');
        if (closest) listitems.push(closest);
      }
      node.querySelectorAll('li[role="listitem"]').forEach(li => {
        if (listitems.indexOf(li) < 0) listitems.push(li);
      });
      if (listitems.length) this.addButtonToMedia(listitems);
    },
    addButtonTo: function (article) {
      if (article.dataset.detected) return;
      let lightbox = location.pathname.match(/\/status\/(\d+)\/(photo|video)\/(\d+)/);
      let pathStatus = location.pathname.match(/\/status\/(\d+)/);
      let inLightboxDialog = !!(lightbox && article.closest('[role="dialog"], [aria-modal="true"]'));
      let media_selector = [
        'a[href*="/photo/1"]',
        'div[role="progressbar"]',
        'button[data-testid="playButton"]',
        'a[href="/settings/content_you_see"]', //hidden content
        'div.media-image-container', // for tweetdeck
        'div.media-preview-container', // for tweetdeck
        'div[aria-labelledby]>div:first-child>div[role="button"][tabindex="0"]', //for audio (experimental)
        '[data-testid="tweetPhoto"]',
        '[data-testid="videoPlayer"]',
        '[data-testid="videoComponent"]'
      ];
      // Ignore media that only lives inside a quoted tweet (deleted quote, etc.).
      let mediaNodes = article.querySelectorAll(media_selector.join(','));
      let media = null;
      for (let i = 0; i < mediaNodes.length; i++) {
        if (!mediaNodes[i].closest('[data-testid="quoteTweet"]')) {
          media = mediaNodes[i];
          break;
        }
      }
      let status_id = statusIdFromArticle(article);
      // On /status/{id} (and lightbox), never use a nested quote's id for the focused tweet.
      if (pathStatus) {
        if (inLightboxDialog) {
          if (status_id && status_id !== pathStatus[1]) {
            article.dataset.detected = 'true';
            return;
          }
          status_id = pathStatus[1];
        } else if (status_id === pathStatus[1] || !status_id) {
          status_id = pathStatus[1];
        }
      }
      let btn_group = article.querySelector('div[role="group"]:last-of-type, ul.tweet-actions, ul.tweet-detail-actions');
      // Photo/video lightbox: player is often outside the article; actions/share still live here.
      if (!media && lightbox && status_id === lightbox[1]) {
        media = btn_group || article.querySelector('div[role="group"]');
      }
      if (!media) {
        // Lightbox side panel may mount before actions exist; retry on later mutations.
        if (inLightboxDialog) return;
        article.dataset.detected = 'true';
        return;
      }
      if (!status_id) status_id = pathStatus && pathStatus[1];
      if (!status_id) {
        if (inLightboxDialog) return;
        article.dataset.detected = 'true';
        return;
      }
      if (!btn_group) {
        if (inLightboxDialog) return;
        return;
      }
      let btn_share = Array.from(btn_group.querySelectorAll(':scope>div>div, li.tweet-action-item>a, li.tweet-detail-action-item>a')).pop();
      if (!btn_share) {
        if (inLightboxDialog) return;
        return;
      }
      btn_share = btn_share.parentNode;
      let btn_down = btn_share.cloneNode(true);
      let btn_el = btn_down.querySelector('button');
      if (btn_el) btn_el.removeAttribute('disabled');
      if (is_tweetdeck) {
        btn_down.firstElementChild.innerHTML = '<svg viewBox="0 0 24 24" style="width: 18px; height: 18px;">' + this.svg + '</svg>';
        btn_down.firstElementChild.removeAttribute('rel');
        btn_down.classList.replace('pull-left', 'pull-right');
      } else {
        let svg = btn_down.querySelector('svg');
        if (svg) svg.innerHTML = this.svg;
      }
      let is_exist = historyHas(status_id);
      this.status(btn_down, 'tmd-down');
      this.status(btn_down, is_exist ? 'completed' : 'download', is_exist ? lang.completed : lang.download);
      btn_group.insertBefore(btn_down, btn_share.nextSibling);
      btn_down.onclick = () => this.click(btn_down, status_id, is_exist);
      article.dataset.detected = 'true';
      if (show_sensitive) {
        let btn_show = article.querySelector('div[aria-labelledby] div[role="button"][tabindex="0"]:not([data-testid]) > div[dir] > span > span');
        if (btn_show) btn_show.click();
      }
      let imgs = article.querySelectorAll('a[href*="/photo/"]');
      if (imgs.length > 1) {
        imgs.forEach(img => {
          let index = img.href.split('/status/').pop().split('/').pop();
          let btn_img = document.createElement('div');
          btn_img.innerHTML = overlayButtonHtml(this.svg);
          btn_img.classList.add('tmd-down', 'tmd-img');
          this.status(btn_img, 'download');
          img.parentNode.appendChild(btn_img);
          btn_img.onclick = e => {
            e.preventDefault();
            this.click(btn_img, status_id, is_exist, index);
          };
        });
      }
    },
    addButtonToMedia: function(listitems) {
      listitems.forEach(li => {
        try {
          if (li.dataset.detected) return;
          let status_link = li.querySelector('a[href*="/status/"]');
          if (!status_link) return;
          let status_id = statusIdFromHref(status_link.href);
          if (!status_id) return;
          let is_exist = historyHas(status_id);
          let btn_down = document.createElement('div');
          btn_down.innerHTML = overlayButtonHtml(this.svg);
          btn_down.classList.add('tmd-down', 'tmd-media');
          this.status(btn_down, is_exist ? 'completed' : 'download', is_exist ? lang.completed : lang.download);
          if (getComputedStyle(li).position === 'static') li.style.position = 'relative';
          li.appendChild(btn_down);
          btn_down.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            this.click(btn_down, status_id, is_exist);
          };
          li.dataset.detected = 'true';
        } catch (e) {
          console.warn('[TMD] addButtonToMedia', e);
        }
      });
    },
    markDownloaded: async function (status_id) {
      let save_history = await GM_getValue('save_history', true);
      if (save_history && !historyHas(status_id)) {
        historyAdd(status_id);
        await this.storage(status_id);
      }
    },
    buildMediaFiles: function (medias, info, out, index) {
      if (index) medias = [medias[index - 1]].filter(Boolean);
      if (!medias.length) throw new Error('MEDIA_NOT_FOUND');
      let files = [];
      medias.forEach((media, i) => {
        let variants = media.video_info && media.video_info.variants;
        let video = variants && variants.filter(n => n.content_type === 'video/mp4').sort((a, b) => b.bitrate - a.bitrate)[0];
        let url = media.type === 'photo' ? media.media_url_https + ':orig' : video && video.url;
        if (!url) return;
        let file = url.split('/').pop().split(/[:?]/).shift();
        let fileInfo = Object.assign({}, info, {
          url: url,
          file: file,
          'file-name': file.split('.').shift(),
          'file-ext': file.split('.').pop(),
          'file-type': String(media.type || 'video').replace('animated_', '')
        });
        let name = (out.replace(/\.?{file-ext}/, '') + ((medias.length > 1 || index) && !out.match('{file-name}') ? '-' + (index ? index - 1 : i) : '') + '.{file-ext}').replace(/{([^{}:]+)(:[^{}]+)?}/g, (match, key) => fileInfo[key]);
        files.push({url: url, name: name});
      });
      if (!files.length) throw new Error('MEDIA_NOT_FOUND');
      return files;
    },
    resolveFromGraphql: async function (status_id, index, out) {
      let json = await this.fetchJson(status_id);
      if (!json || !json.legacy || !json.core || !json.core.user_results || !json.core.user_results.result || !json.core.user_results.result.legacy) {
        throw new Error('TWEET_UNAVAILABLE');
      }
      let tweet = json.legacy;
      let user = json.core.user_results.result.legacy;
      let datetime = out.match(/{date-time(-local)?:[^{}]+}/) ? out.match(/{date-time(?:-local)?:([^{}]+)}/)[1].replace(/[\\/|<>*?:"]/g, v => INVALID_CHARS[v] || '') : 'YYYYMMDD-hhmmss';
      let info = {};
      info['status-id'] = status_id;
      info['user-name'] = sanitize(user.name);
      info['user-id'] = user.screen_name;
      info['date-time'] = this.formatDate(tweet.created_at, datetime);
      info['date-time-local'] = this.formatDate(tweet.created_at, datetime, true);
      info['full-text'] = sanitize((tweet.full_text || '').split('\n').join(' ').replace(/\s*https:\/\/t\.co\/\w+/g, ''));
      let medias = tweet.extended_entities && tweet.extended_entities.media;
      if (!medias) {
        try {
          let binding = json.card && json.card.legacy && json.card.legacy.binding_values && json.card.legacy.binding_values[0];
          if (binding && binding.value && binding.value.string_value) {
            medias = Object.values(JSON.parse(binding.value.string_value).media_entities);
          }
        } catch (e) {
          medias = null;
        }
      }
      if (!Array.isArray(medias) || medias.length === 0) throw new Error('MEDIA_NOT_FOUND');
      let files = this.buildMediaFiles(medias, info, out, index);
      return {status_id: status_id, user_id: user.screen_name, files: files};
    },
    fetchSyndication: function (status_id) {
      let token = syndicationToken(status_id);
      let url = 'https://cdn.syndication.twimg.com/tweet-result?id=' + encodeURIComponent(status_id) +
        '&lang=en&token=' + encodeURIComponent(token);
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          // text + manual parse is more reliable than responseType:json across TM/Violentmonkey
          responseType: 'text',
          anonymous: true,
          onload: r => {
            if (r.status < 200 || r.status >= 300) {
              reject(new Error('TWEET_UNAVAILABLE'));
              return;
            }
            let raw = r.responseText != null ? r.responseText : r.response;
            let data = null;
            try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { data = null; }
            if (!data || typeof data !== 'object' || !Object.keys(data).length) {
              reject(new Error('TWEET_UNAVAILABLE'));
              return;
            }
            if (data.__typename === 'TweetTombstone' || data.__typename === 'TweetUnavailable') {
              reject(new Error('TWEET_UNAVAILABLE'));
              return;
            }
            resolve(data);
          },
          onerror: () => reject(new Error('TWEET_UNAVAILABLE')),
          ontimeout: () => reject(new Error('TWEET_UNAVAILABLE'))
        });
      });
    },
    resolveFromSyndication: async function (status_id, index, out) {
      let data = await this.fetchSyndication(status_id);
      let user = data.user || {};
      let datetime = out.match(/{date-time(-local)?:[^{}]+}/) ? out.match(/{date-time(?:-local)?:([^{}]+)}/)[1].replace(/[\\/|<>*?:"]/g, v => INVALID_CHARS[v] || '') : 'YYYYMMDD-hhmmss';
      let created = data.created_at || new Date().toISOString();
      let info = {};
      info['status-id'] = status_id;
      info['user-name'] = sanitize(user.name || 'unknown');
      info['user-id'] = user.screen_name || 'unknown';
      info['date-time'] = this.formatDate(created, datetime);
      info['date-time-local'] = this.formatDate(created, datetime, true);
      info['full-text'] = sanitize(String(data.text || '').split('\n').join(' ').replace(/\s*https:\/\/t\.co\/\w+/g, ''));
      let medias = Array.isArray(data.mediaDetails) ? data.mediaDetails.slice() : [];
      if (!medias.length && data.video && Array.isArray(data.video.variants)) {
        let variants = data.video.variants.map(v => ({
          content_type: v.type || v.content_type,
          url: v.src || v.url,
          bitrate: v.bitrate
        }));
        medias = [{type: 'video', video_info: {variants: variants}}];
      }
      if (!medias.length && Array.isArray(data.photos) && data.photos.length) {
        medias = data.photos.map(p => ({
          type: 'photo',
          media_url_https: p.url || p.media_url_https
        }));
      }
      if (!medias.length) throw new Error('MEDIA_NOT_FOUND');
      let files = this.buildMediaFiles(medias, info, out, index);
      return {status_id: status_id, user_id: info['user-id'], files: files};
    },
    collectPageMediaUrls: function (status_id) {
      let found = new Set();
      let re = /https?:\/\/video\.twimg\.com\/[^"'\\\s>]+\.mp4[^"'\\\s>]*/gi;
      let push = (u) => {
        if (!u || u.indexOf('blob:') === 0) return;
        let m = String(u).match(re);
        if (m) m.forEach(x => found.add(x.replace(/&amp;/g, '&')));
        else if (/video\.twimg\.com\/.+\.mp4/i.test(u)) found.add(String(u).replace(/&amp;/g, '&'));
      };
      try {
        performance.getEntriesByType('resource').forEach(e => push(e.name));
      } catch (e) {}
      document.querySelectorAll('video source[src], video[src], a[href*="video.twimg.com"]').forEach(el => {
        push(el.src || el.href || el.getAttribute('src') || el.getAttribute('href'));
      });
      // X often leaves media metadata in script/JSON blobs even when GraphQL tombstones the tweet.
      document.querySelectorAll('script').forEach(s => {
        let t = s.textContent || '';
        if (t.indexOf('video.twimg.com') < 0) return;
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(t))) found.add(m[0].replace(/&amp;/g, '&'));
      });
      return Array.from(found);
    },
    resolveFromPage: async function (status_id, index, out) {
      let urls = this.collectPageMediaUrls(status_id);
      if (!urls.length) throw new Error('TWEET_UNAVAILABLE');
      // Prefer higher-res variants when path includes size hints (…/avc1/WxH/…).
      urls.sort((a, b) => {
        let sa = (a.match(/\/(\d+)x(\d+)\//) || [0, 0, 0]).slice(1).reduce((n, v) => n * Number(v), 1);
        let sb = (b.match(/\/(\d+)x(\d+)\//) || [0, 0, 0]).slice(1).reduce((n, v) => n * Number(v), 1);
        return sb - sa;
      });
      let best = urls[0];
      let pathUser = (location.pathname.match(/^\/([^/]+)\//) || [])[1] || 'unknown';
      let datetime = out.match(/{date-time(-local)?:[^{}]+}/) ? out.match(/{date-time(?:-local)?:([^{}]+)}/)[1].replace(/[\\/|<>*?:"]/g, v => INVALID_CHARS[v] || '') : 'YYYYMMDD-hhmmss';
      let now = new Date().toISOString();
      let info = {
        'status-id': status_id,
        'user-name': sanitize(pathUser),
        'user-id': pathUser,
        'date-time': this.formatDate(now, datetime),
        'date-time-local': this.formatDate(now, datetime, true),
        'full-text': ''
      };
      let medias = [{type: 'video', video_info: {variants: [{content_type: 'video/mp4', url: best, bitrate: 1}]}}];
      let files = this.buildMediaFiles(medias, info, out, index);
      return {status_id: status_id, user_id: pathUser, files: files};
    },
    resolveTweetMedia: async function (status_id, index) {
      let out = (await GM_getValue('filename', filename)).split('\n').join('');
      try {
        return await this.resolveFromGraphql(status_id, index, out);
      } catch (e1) {
        console.warn('[TMD] graphql resolve failed, trying syndication', status_id, e1 && e1.message);
        try {
          return await this.resolveFromSyndication(status_id, index, out);
        } catch (e2) {
          console.warn('[TMD] syndication resolve failed, trying page media', status_id, e2 && e2.message);
          return await this.resolveFromPage(status_id, index, out);
        }
      }
    },
    click: async function (btn, status_id, is_exist, index) {
      if (btn.classList.contains('loading')) return;
      this.status(btn, 'loading');
      try {
        let resolved = await this.resolveTweetMedia(status_id, index);
        let tasks = resolved.files.length;
        let tasks_result = [];
        resolved.files.forEach((file, i) => {
          this.downloader.add({
            url: file.url,
            name: file.name,
            onload: () => {
              tasks -= 1;
              tasks_result.push(((resolved.files.length > 1 || index) ? (index ? index : i + 1) + ': ' : '') + lang.completed);
              this.status(btn, null, tasks_result.sort().join('\n'));
              if (tasks === 0) {
                this.status(btn, 'completed', lang.completed);
                if (!is_exist) this.markDownloaded(status_id);
              }
            },
            onerror: result => {
              tasks = -1;
              tasks_result.push((resolved.files.length > 1 ? i + 1 + ': ' : '') + (result && result.details && result.details.current || 'ERROR'));
              this.status(btn, 'failed', tasks_result.sort().join('\n'));
            }
          });
        });
      } catch (e) {
        console.warn('[TMD] click', e);
        this.status(btn, 'failed', e && e.message ? e.message : 'ERROR');
      }
    },
    status: function (btn, css, title, style) {
      if (css) {
        btn.classList.remove('download', 'completed', 'loading', 'failed');
        btn.classList.add(css);
      }
      if (title) btn.title = title;
      if (style) btn.style.cssText = style;
    },
    settings: async function () {
      const $element = (parent, tag, style, content, css) => {
        let el = document.createElement(tag);
        if (style) el.style.cssText = style;
        if (typeof content !== 'undefined') {
          if (tag === 'input') {
            if (content === 'checkbox') el.type = content;
            else el.value = content;
          } else if (tag === 'textarea') {
            el.value = content;
          } else el.innerHTML = content;
        }
        if (css) css.split(' ').forEach(c => el.classList.add(c));
        parent.appendChild(el);
        return el;
      };
      let wapper = $element(document.body, 'div', null, null, 'tmd-settings-backdrop');
      let wapper_close;
      wapper.onmousedown = e => {
        wapper_close = e.target === wapper;
      };
      wapper.onmouseup = e => {
        if (wapper_close && e.target === wapper) wapper.remove();
      };
      let dialog = $element(wapper, 'div', null, null, 'tmd-settings');
      let header = $element(dialog, 'div', null, null, 'tmd-settings-header');
      let title = $element(header, 'h3', null, lang.dialog.title, 'tmd-settings-title');
      let btn_save = $element(header, 'button', null, lang.dialog.save, 'tmd-btn');
      btn_save.type = 'button';

      let options = $element(dialog, 'div', null, null, 'tmd-settings-section');
      let save_history_row = $element(options, 'label', null, null, 'tmd-settings-row');
      let save_history_text = $element(save_history_row, 'span', null, lang.dialog.save_history, 'tmd-settings-label');
      let save_history_actions = $element(save_history_row, 'span', null, null, 'tmd-settings-actions');
      let clear_history = $element(save_history_actions, 'button', null, lang.dialog.clear_history.replace(/^\(|\)$/g, '') || lang.dialog.clear_history, 'tmd-btn-ghost');
      clear_history.type = 'button';
      let save_history_input = $element(save_history_actions, 'input', null, 'checkbox', 'tmd-switch');
      save_history_input.checked = await GM_getValue('save_history', true);
      save_history_input.onchange = () => {
        GM_setValue('save_history', save_history_input.checked);
      };
      clear_history.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm(lang.dialog.clear_confirm)) {
          history = [];
          syncHistorySet();
          GM_setValue('download_history', []);
        }
      };

      let show_sensitive_row = $element(options, 'label', null, null, 'tmd-settings-row');
      $element(show_sensitive_row, 'span', null, lang.dialog.show_sensitive, 'tmd-settings-label');
      let show_sensitive_input = $element(show_sensitive_row, 'input', null, 'checkbox', 'tmd-switch');
      show_sensitive_input.checked = await GM_getValue('show_sensitive', false);
      show_sensitive_input.onchange = () => {
        show_sensitive = show_sensitive_input.checked;
        GM_setValue('show_sensitive', show_sensitive);
      };

      let limits = $element(dialog, 'div', null, null, 'tmd-settings-section');
      $element(limits, 'div', null, lang.dialog.limits_section, 'tmd-settings-field-label');

      let threads_row = $element(limits, 'label', null, null, 'tmd-settings-row');
      $element(threads_row, 'span', null, lang.dialog.download_max_threads, 'tmd-settings-label');
      let threads_input = $element(threads_row, 'input', null, await getPositiveInt('download_max_threads', LIMIT_DEFAULTS.download_max_threads), 'tmd-settings-number');
      threads_input.type = 'number';
      threads_input.min = '1';

      let retries_row = $element(limits, 'label', null, null, 'tmd-settings-row');
      $element(retries_row, 'span', null, lang.dialog.download_max_retries, 'tmd-settings-label');
      let retries_input = $element(retries_row, 'input', null, await getPositiveInt('download_max_retries', LIMIT_DEFAULTS.download_max_retries), 'tmd-settings-number');
      retries_input.type = 'number';
      retries_input.min = '1';

      let throttle_row = $element(limits, 'label', null, null, 'tmd-settings-row');
      $element(throttle_row, 'span', null, lang.dialog.download_throttle_after, 'tmd-settings-label');
      let throttle_input = $element(throttle_row, 'input', null, await getPositiveInt('download_throttle_after', LIMIT_DEFAULTS.download_throttle_after), 'tmd-settings-number');
      throttle_input.type = 'number';
      throttle_input.min = '1';
      throttle_input.title = lang.dialog.download_throttle_after_hint || '';

      let hard_cap_row = $element(limits, 'label', null, null, 'tmd-settings-row');
      $element(hard_cap_row, 'span', null, lang.dialog.bulk_hard_cap, 'tmd-settings-label');
      let hard_cap_input = $element(hard_cap_row, 'input', null, await getPositiveInt('bulk_hard_cap', LIMIT_DEFAULTS.bulk_hard_cap), 'tmd-settings-number');
      hard_cap_input.type = 'number';
      hard_cap_input.min = '1';

      let bulk = $element(dialog, 'div', null, null, 'tmd-settings-section');
      $element(bulk, 'div', null, lang.dialog.bulk_section, 'tmd-settings-field-label');

      let bulk_zip_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_zip_row, 'span', null, lang.dialog.bulk_zip, 'tmd-settings-label');
      let bulk_zip_input = $element(bulk_zip_row, 'input', null, 'checkbox', 'tmd-switch');
      bulk_zip_input.checked = await GM_getValue('bulk_zip', true);

      let bulk_chunk_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_chunk_row, 'span', null, lang.dialog.bulk_zip_chunk, 'tmd-settings-label');
      let bulk_chunk_input = $element(bulk_chunk_row, 'input', null, 'checkbox', 'tmd-switch');
      bulk_chunk_input.checked = await GM_getValue('bulk_zip_chunk', true);

      let bulk_warn = $element(bulk, 'div', null, lang.dialog.bulk_zip_unchunked_warn, 'tmd-settings-warn');

      let bulk_files_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_files_row, 'span', null, lang.dialog.bulk_zip_max_files, 'tmd-settings-label');
      let bulk_files_input = $element(bulk_files_row, 'input', null, await getPositiveInt('bulk_zip_max_files', LIMIT_DEFAULTS.bulk_zip_max_files), 'tmd-settings-number');
      bulk_files_input.type = 'number';
      bulk_files_input.min = '1';

      let bulk_mb_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_mb_row, 'span', null, lang.dialog.bulk_zip_max_mb, 'tmd-settings-label');
      let bulk_mb_input = $element(bulk_mb_row, 'input', null, await getPositiveInt('bulk_zip_max_mb', LIMIT_DEFAULTS.bulk_zip_max_mb), 'tmd-settings-number');
      bulk_mb_input.type = 'number';
      bulk_mb_input.min = '1';

      let bulk_limit_enable_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_limit_enable_row, 'span', null, lang.dialog.bulk_scrape_limit_enabled, 'tmd-settings-label');
      let bulk_limit_enable_input = $element(bulk_limit_enable_row, 'input', null, 'checkbox', 'tmd-switch');
      bulk_limit_enable_input.checked = await GM_getValue('bulk_scrape_limit_enabled', false);

      let bulk_limit_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_limit_row, 'span', null, lang.dialog.bulk_scrape_limit, 'tmd-settings-label');
      let bulk_limit_input = $element(bulk_limit_row, 'input', null, await getPositiveInt('bulk_scrape_limit', LIMIT_DEFAULTS.bulk_scrape_limit), 'tmd-settings-number');
      bulk_limit_input.type = 'number';
      bulk_limit_input.min = '1';

      let bulk_redownload_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_redownload_row, 'span', null, lang.dialog.bulk_redownload, 'tmd-settings-label');
      let bulk_redownload_input = $element(bulk_redownload_row, 'input', null, 'checkbox', 'tmd-switch');
      bulk_redownload_input.checked = await GM_getValue('bulk_redownload', false);

      let bulk_manual_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_manual_row, 'span', null, lang.dialog.bulk_manual_scroll, 'tmd-settings-label');
      let bulk_manual_input = $element(bulk_manual_row, 'input', null, 'checkbox', 'tmd-switch');
      bulk_manual_input.checked = await GM_getValue('bulk_manual_scroll', false);

      const syncBulkUi = () => {
        let zipOn = bulk_zip_input.checked;
        bulk_chunk_row.style.display = zipOn ? '' : 'none';
        bulk_files_row.style.display = zipOn && bulk_chunk_input.checked ? '' : 'none';
        bulk_mb_row.style.display = zipOn && bulk_chunk_input.checked ? '' : 'none';
        bulk_warn.style.display = zipOn && !bulk_chunk_input.checked ? '' : 'none';
        bulk_limit_row.style.display = bulk_limit_enable_input.checked ? '' : 'none';
      };
      bulk_zip_input.onchange = () => {
        GM_setValue('bulk_zip', bulk_zip_input.checked);
        syncBulkUi();
      };
      bulk_chunk_input.onchange = () => {
        GM_setValue('bulk_zip_chunk', bulk_chunk_input.checked);
        syncBulkUi();
      };
      bulk_limit_enable_input.onchange = () => {
        GM_setValue('bulk_scrape_limit_enabled', bulk_limit_enable_input.checked);
        syncBulkUi();
      };
      bulk_redownload_input.onchange = () => {
        GM_setValue('bulk_redownload', bulk_redownload_input.checked);
      };
      bulk_manual_input.onchange = () => {
        GM_setValue('bulk_manual_scroll', bulk_manual_input.checked);
      };
      syncBulkUi();

      let filename_div = $element(dialog, 'div', null, null, 'tmd-settings-section');
      let filename_label = $element(filename_div, 'label', null, lang.dialog.pattern, 'tmd-settings-field-label');
      let filename_input = $element(filename_div, 'textarea', null, await GM_getValue('filename', filename), 'tmd-settings-textarea');
      filename_label.setAttribute('for', 'tmd-filename');
      filename_input.id = 'tmd-filename';
      let filename_tags = $element(filename_div, 'div', null, `
<button type="button" class="tmd-tag" title="user name">{user-name}</button>
<button type="button" class="tmd-tag" title="The user name after @ sign.">{user-id}</button>
<button type="button" class="tmd-tag" title="example: 1234567890987654321">{status-id}</button>
<button type="button" class="tmd-tag" title="{date-time} : Posted time in UTC.\n{date-time-local} : Your local time zone.\n\nDefault:\nYYYYMMDD-hhmmss => 20201231-235959\n\nExample of custom:\n{date-time:DD-MMM-YY hh.mm} => 31-DEC-21 23.59">{date-time}</button>
<button type="button" class="tmd-tag" title="Text content in tweet.">{full-text}</button>
<button type="button" class="tmd-tag" title="Type of &#34;video&#34; or &#34;photo&#34; or &#34;gif&#34;.">{file-type}</button>
<button type="button" class="tmd-tag" title="Original filename from URL.">{file-name}</button>
`, 'tmd-settings-tags');
      filename_input.selectionStart = filename_input.value.length;
      filename_tags.querySelectorAll('.tmd-tag').forEach(tag => {
        tag.onclick = () => {
          let ss = filename_input.selectionStart;
          let se = filename_input.selectionEnd;
          filename_input.value = filename_input.value.substring(0, ss) + tag.innerText + filename_input.value.substring(se);
          filename_input.selectionStart = ss + tag.innerText.length;
          filename_input.selectionEnd = ss + tag.innerText.length;
          filename_input.focus();
        };
      });
      btn_save.onclick = async () => {
        await GM_setValue('filename', filename_input.value);
        const savePositive = async (input, key) => {
          let v = parseInt(input.value, 10);
          if (!isNaN(v) && v > 0) await GM_setValue(key, v);
        };
        await savePositive(threads_input, 'download_max_threads');
        await savePositive(retries_input, 'download_max_retries');
        await savePositive(throttle_input, 'download_throttle_after');
        await savePositive(hard_cap_input, 'bulk_hard_cap');
        await savePositive(bulk_files_input, 'bulk_zip_max_files');
        await savePositive(bulk_mb_input, 'bulk_zip_max_mb');
        await GM_setValue('bulk_scrape_limit_enabled', bulk_limit_enable_input.checked);
        await savePositive(bulk_limit_input, 'bulk_scrape_limit');
        await GM_setValue('bulk_manual_scroll', bulk_manual_input.checked);
        await TMD.downloader.refreshLimits();
        wapper.remove();
      };
    },
    fetchJson: async function (status_id) {
      let base_url = `https://${host}/i/api/graphql/2ICDjqPd81tulZcYrtpTuQ/TweetResultByRestId`;
      let variables = {
        tweetId: status_id,
        with_rux_injections: false,
        includePromotedContent: true,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
        withV2Timeline: true
      };
      let features = {
        articles_preview_enabled: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        communities_web_enable_tweet_community_results_fetch: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        longform_notetweets_consumption_enabled: false,
        longform_notetweets_inline_media_enabled: true,
        longform_notetweets_rich_text_read_enabled: false,
        premium_content_api_read_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_edit_tweet_api_enabled: false,
        responsive_web_enhance_cards_enabled: false,
        responsive_web_graphql_exclude_directive_enabled: false,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: false,
        responsive_web_grok_analysis_button_from_backend: false,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: false,
        responsive_web_grok_image_annotation_enabled: false,
        responsive_web_grok_share_attachment_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_jetfuel_frame: false,
        responsive_web_media_download_video_enabled: false,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        rweb_video_screen_enabled: false,
        standardized_nudges_misinfo: true,
        tweet_awards_web_tipping_enabled: false,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        tweetypie_unmention_optimization_enabled: false,
        verified_phone_label_enabled: false,
        view_counts_everywhere_api_enabled: true
      };
      let url = `${base_url}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;
      let cookies = this.getCookie();
      let headers = {
        authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': cookies.lang,
        'x-csrf-token': cookies.ct0
      };
      if (cookies.ct0 && cookies.ct0.length === 32) headers['x-guest-token'] = cookies.gt;
      let tweet_detail = await fetch(url, {headers: headers}).then(result => result.json());
      let tweet_result = tweet_detail && tweet_detail.data && tweet_detail.data.tweetResult && tweet_detail.data.tweetResult.result;
      if (!tweet_result) throw new Error('TWEET_UNAVAILABLE');
      if (tweet_result.__typename === 'TweetUnavailable' || tweet_result.__typename === 'TweetTombstone') {
        throw new Error('TWEET_UNAVAILABLE');
      }
      let tweet = tweet_result.tweet || tweet_result;
      if (tweet && (tweet.__typename === 'TweetUnavailable' || tweet.__typename === 'TweetTombstone')) {
        throw new Error('TWEET_UNAVAILABLE');
      }
      return tweet;
    },
    getCookie: function (name) {
      let cookies = {};
      document.cookie.split(';').filter(n => n.indexOf('=') > 0).forEach(n => {
        n.replace(/^([^=]+)=(.+)$/, (match, name, value) => {
          cookies[name.trim()] = value.trim();
        });
      });
      return name ? cookies[name] : cookies;
    },
    storage: async function (value) {
      let data = await GM_getValue('download_history', []);
      if (!Array.isArray(data)) data = [];
      let data_length = data.length;
      if (value) {
        if (Array.isArray(value)) data = data.concat(value);
        else if (data.indexOf(value) < 0) data.push(value);
      } else return data;
      if (data.length > data_length) GM_setValue('download_history', data);
    },
    storage_obsolete: function (is_remove) {
      let data = JSON.parse(localStorage.getItem('history') || '[]');
      if (is_remove) localStorage.removeItem('history');
      else return data;
    },
    formatDate: function (i, o, tz) {
      let d = new Date(i);
      if (tz) d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      let m = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      let v = {
        YYYY: d.getUTCFullYear().toString(),
        YY: d.getUTCFullYear().toString(),
        MM: d.getUTCMonth() + 1,
        MMM: m[d.getUTCMonth()],
        DD: d.getUTCDate(),
        hh: d.getUTCHours(),
        mm: d.getUTCMinutes(),
        ss: d.getUTCSeconds(),
        h2: d.getUTCHours() % 12,
        ap: d.getUTCHours() < 12 ? 'AM' : 'PM'
      };
      return o.replace(/(YY(YY)?|MMM?|DD|hh|mm|ss|h2|ap)/g, n => ('0' + v[n]).slice(-n.length));
    },
    fetchBuffer: function (url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          responseType: 'arraybuffer',
          onload: r => {
            if (r.status >= 200 && r.status < 300) resolve(r.response);
            else reject(new Error('HTTP_' + r.status));
          },
          onerror: () => reject(new Error('NETWORK')),
          ontimeout: () => reject(new Error('TIMEOUT'))
        });
      });
    },
    saveBlob: function (blob, name) {
      return new Promise((resolve, reject) => {
        let url = URL.createObjectURL(blob);
        GM_download({
          url: url,
          name: name,
          onload: () => {
            URL.revokeObjectURL(url);
            resolve();
          },
          onerror: result => {
            URL.revokeObjectURL(url);
            reject(result || new Error('DOWNLOAD_FAILED'));
          },
          ontimeout: result => {
            URL.revokeObjectURL(url);
            reject(result || new Error('TIMEOUT'));
          }
        });
      });
    },
    bulk: (function () {
      let bar, fab, statusEl, fabStatusEl, startBtn, stopBtn, hideBtn, optsEl;
      let zipInput, chunkInput, redownloadInput, filesInput, mbInput, limitEnabledInput, limitInput, limitFields, warnEl, chunkFields, manualInput;
      let running = false;
      let abort = false;
      let collapsed = false;
      let lastPath = '';
      let phase = 'idle'; // idle | collect-manual | collect-auto | download
      let manualProceed = false;

      function setStatus(text) {
        if (statusEl) statusEl.textContent = text || '';
        if (fab) {
          let base = lang && lang.bulk ? lang.bulk.show_title : 'Show bulk download panel';
          fab.title = text ? (base + ' - ' + text) : base;
          fab.setAttribute('aria-label', fab.title);
        }
        if (fabStatusEl) {
          fabStatusEl.textContent = text ? '•' : '';
          fabStatusEl.style.display = text && running ? '' : 'none';
        }
      }

      function applyCollapsed() {
        if (!bar) return;
        if (!isMediaPage()) {
          bar.style.display = 'none';
          if (fab) fab.style.display = 'none';
          return;
        }
        if (collapsed) {
          bar.style.display = 'none';
          if (fab) fab.style.display = 'flex';
        } else {
          bar.style.display = '';
          if (fab) fab.style.display = 'none';
        }
      }

      function setCollapsed(value) {
        collapsed = !!value;
        GM_setValue('bulk_bar_collapsed', collapsed);
        applyCollapsed();
      }

      function updateStartLabel(foundCount) {
        if (!startBtn) return;
        if (phase === 'collect-manual') {
          startBtn.textContent = (lang.bulk.download_found || 'Download {n} found')
            .replace('{n}', String(foundCount != null ? foundCount : 0));
          return;
        }
        if (running) return;
        let manual = !!(manualInput && manualInput.checked);
        startBtn.textContent = manual ? (lang.bulk.watch || 'Watch while I scroll') : lang.bulk.start;
      }

      function setRunning(isRunning, mode) {
        running = isRunning;
        phase = isRunning ? (mode || 'download') : 'idle';
        let allowStart = mode === 'collect-manual';
        if (startBtn) startBtn.disabled = isRunning && !allowStart;
        if (stopBtn) stopBtn.disabled = !isRunning;
        if (hideBtn) hideBtn.disabled = false;
        [zipInput, chunkInput, redownloadInput, filesInput, mbInput, limitEnabledInput, limitInput, manualInput].forEach(el => {
          if (el) el.disabled = isRunning;
        });
        if (fab) fab.classList.toggle('tmd-bulk-fab-running', isRunning);
        if (!isRunning) updateStartLabel();
      }

      function syncOptUi() {
        if (!zipInput) return;
        let zipOn = zipInput.checked;
        if (chunkInput) chunkInput.closest('.tmd-bulk-opt').style.display = zipOn ? '' : 'none';
        if (chunkFields) chunkFields.style.display = zipOn && chunkInput.checked ? '' : 'none';
        if (warnEl) warnEl.style.display = zipOn && !chunkInput.checked ? '' : 'none';
        if (limitFields) limitFields.style.display = limitEnabledInput && limitEnabledInput.checked ? '' : 'none';
        if (optsEl) {
          let hint = optsEl.querySelector('.tmd-bulk-hint');
          if (hint) {
            hint.textContent = (manualInput && manualInput.checked)
              ? (lang.bulk.opts_hint_manual || lang.bulk.opts_hint)
              : lang.bulk.opts_hint;
          }
        }
        if (!running) updateStartLabel();
      }

      async function loadOptDefaults() {
        if (!zipInput || running) return;
        zipInput.checked = await GM_getValue('bulk_zip', true);
        chunkInput.checked = await GM_getValue('bulk_zip_chunk', true);
        redownloadInput.checked = await GM_getValue('bulk_redownload', false);
        filesInput.value = await getPositiveInt('bulk_zip_max_files', LIMIT_DEFAULTS.bulk_zip_max_files);
        mbInput.value = await getPositiveInt('bulk_zip_max_mb', LIMIT_DEFAULTS.bulk_zip_max_mb);
        limitEnabledInput.checked = await GM_getValue('bulk_scrape_limit_enabled', false);
        limitInput.value = await getPositiveInt('bulk_scrape_limit', LIMIT_DEFAULTS.bulk_scrape_limit);
        if (manualInput) manualInput.checked = await GM_getValue('bulk_manual_scroll', false);
        syncOptUi();
      }

      function readRunOptions() {
        let maxFiles = parseInt(filesInput && filesInput.value, 10);
        let maxMb = parseInt(mbInput && mbInput.value, 10);
        let limit = parseInt(limitInput && limitInput.value, 10);
        return {
          zip: !!(zipInput && zipInput.checked),
          chunk: !!(chunkInput && chunkInput.checked),
          redownload: !!(redownloadInput && redownloadInput.checked),
          maxFiles: !isNaN(maxFiles) && maxFiles > 0 ? maxFiles : LIMIT_DEFAULTS.bulk_zip_max_files,
          maxMb: !isNaN(maxMb) && maxMb > 0 ? maxMb : LIMIT_DEFAULTS.bulk_zip_max_mb,
          limitEnabled: !!(limitEnabledInput && limitEnabledInput.checked),
          limit: !isNaN(limit) && limit > 0 ? limit : LIMIT_DEFAULTS.bulk_scrape_limit,
          manual: !!(manualInput && manualInput.checked)
        };
      }

      function scanIds(seen, ids) {
        document.querySelectorAll('li[role="listitem"] a[href*="/status/"]').forEach(a => {
          let id = statusIdFromHref(a.href);
          if (id && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        });
      }

      function isWindowScroller(root) {
        return !root || root === document.documentElement || root === document.body || root === document.scrollingElement;
      }

      function getScrollRoot() {
        let best = document.scrollingElement || document.documentElement;
        let bestDelta = (best.scrollHeight || 0) - (best.clientHeight || 0);
        let consider = (el) => {
          if (!el) return;
          let delta = (el.scrollHeight || 0) - (el.clientHeight || 0);
          if (delta > bestDelta + 40) {
            best = el;
            bestDelta = delta;
          }
        };
        consider(document.querySelector('[data-testid="primaryColumn"]'));
        consider(document.querySelector('main[role="main"]'));
        consider(document.querySelector('main'));
        let item = document.querySelector('li[role="listitem"]');
        if (item) {
          let p = item.parentElement;
          while (p && p !== document.body) {
            let st = window.getComputedStyle(p);
            if ((st.overflowY === 'auto' || st.overflowY === 'scroll' || st.overflowY === 'overlay') &&
                p.scrollHeight > p.clientHeight + 80) {
              consider(p);
            }
            p = p.parentElement;
          }
        }
        return best;
      }

      function getScrollTop(root) {
        return isWindowScroller(root) ? (window.scrollY || window.pageYOffset || 0) : root.scrollTop;
      }

      function getClientHeight(root) {
        return isWindowScroller(root) ? window.innerHeight : root.clientHeight;
      }

      function getScrollHeight(root) {
        if (isWindowScroller(root)) {
          return Math.max(
            document.documentElement.scrollHeight || 0,
            document.body ? document.body.scrollHeight : 0,
            root.scrollHeight || 0
          );
        }
        return root.scrollHeight || 0;
      }

      function scrollToY(root, y) {
        if (isWindowScroller(root)) window.scrollTo(0, y);
        else root.scrollTo(0, y);
      }

      function scrollByY(root, y) {
        if (isWindowScroller(root)) window.scrollBy(0, y);
        else root.scrollBy(0, y);
      }

      function isNearBottom(root, pad) {
        pad = pad == null ? 400 : pad;
        return getScrollTop(root) + getClientHeight(root) >= getScrollHeight(root) - pad;
      }

      async function collectIdsAuto(limit, onProgress) {
        let seen = new Set();
        let ids = [];
        let root = getScrollRoot();
        scrollToY(root, 0);
        await sleep(300);
        let idleRounds = 0;
        let bottomStreak = 0;
        const MAX_IDLE = 28;
        const MAX_BOTTOM = 14;

        while (!abort && ids.length < limit) {
          root = getScrollRoot();
          let before = ids.length;
          let beforeH = getScrollHeight(root);
          scanIds(seen, ids);
          if (ids.length > limit) ids.length = limit;
          onProgress(ids.length);
          if (ids.length >= limit) break;

          let items = document.querySelectorAll('li[role="listitem"]');
          let last = items[items.length - 1];
          if (last) {
            try { last.scrollIntoView({ block: 'end', inline: 'nearest' }); } catch (e) { /* ignore */ }
          }
          scrollByY(root, Math.max(getClientHeight(root) * 1.6, 1600));

          let grew = false;
          for (let i = 0; i < 5 && !abort; i++) {
            await sleep(160);
            scanIds(seen, ids);
            if (ids.length > limit) ids.length = limit;
            if (ids.length > before || getScrollHeight(root) > beforeH + 40) {
              grew = true;
              break;
            }
          }
          onProgress(ids.length);
          if (ids.length >= limit) break;

          if (grew) {
            idleRounds = 0;
            bottomStreak = 0;
            continue;
          }

          idleRounds += 1;
          scrollToY(root, getScrollHeight(root));
          await sleep(450);
          scanIds(seen, ids);
          if (ids.length > limit) ids.length = limit;
          if (ids.length > before) {
            idleRounds = 0;
            bottomStreak = 0;
            onProgress(ids.length);
            continue;
          }
          scrollByY(root, 2400);
          await sleep(500);
          scanIds(seen, ids);
          if (ids.length > limit) ids.length = limit;
          onProgress(ids.length);
          if (ids.length > before) {
            idleRounds = 0;
            bottomStreak = 0;
            continue;
          }
          if (isNearBottom(root, 500)) bottomStreak += 1;
          else bottomStreak = 0;
          if (bottomStreak >= MAX_BOTTOM || idleRounds >= MAX_IDLE) break;
        }
        return ids;
      }

      async function collectIdsManual(limit, onProgress) {
        let seen = new Set();
        let ids = [];
        return await new Promise(resolve => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            obs.disconnect();
            clearInterval(iv);
            window.removeEventListener('scroll', onScroll, true);
            document.removeEventListener('scroll', onScroll, true);
            resolve(ids);
          };
          const tick = () => {
            scanIds(seen, ids);
            if (ids.length > limit) ids.length = limit;
            onProgress(ids.length);
            if (abort || manualProceed || ids.length >= limit) finish();
          };
          const onScroll = () => tick();
          const obs = new MutationObserver(() => tick());
          obs.observe(document.body, { childList: true, subtree: true });
          const iv = setInterval(tick, 300);
          window.addEventListener('scroll', onScroll, { passive: true, capture: true });
          document.addEventListener('scroll', onScroll, { passive: true, capture: true });
          tick();
        });
      }

      return {
        ensureBar: async function () {
          let onMedia = isMediaPage();
          if (!onMedia) {
            if (bar) bar.style.display = 'none';
            if (fab) fab.style.display = 'none';
            lastPath = location.pathname;
            return;
          }
          if (!bar) {
            collapsed = await GM_getValue('bulk_bar_collapsed', false);
            bar = document.createElement('div');
            bar.className = 'tmd-bulk-bar';
            bar.innerHTML =
              '<div class="tmd-bulk-bar-inner">' +
                '<div class="tmd-bulk-actions">' +
                  '<button type="button" class="tmd-btn tmd-bulk-start"></button>' +
                  '<button type="button" class="tmd-btn-ghost tmd-bulk-stop" disabled></button>' +
                  '<span class="tmd-bulk-status"></span>' +
                  '<button type="button" class="tmd-btn-ghost tmd-bulk-hide" title=""></button>' +
                '</div>' +
                '<div class="tmd-bulk-opts">' +
                  '<label class="tmd-bulk-opt"><input type="checkbox" class="tmd-bulk-manual"> <span></span></label>' +
                  '<label class="tmd-bulk-opt"><input type="checkbox" class="tmd-bulk-limit-enabled"> <span></span></label>' +
                  '<span class="tmd-bulk-limit-fields">' +
                    '<label class="tmd-bulk-opt tmd-bulk-opt-num"><span></span> <input type="number" min="1" class="tmd-settings-number tmd-bulk-limit"></label>' +
                  '</span>' +
                  '<label class="tmd-bulk-opt"><input type="checkbox" class="tmd-bulk-zip"> <span></span></label>' +
                  '<label class="tmd-bulk-opt"><input type="checkbox" class="tmd-bulk-chunk"> <span></span></label>' +
                  '<label class="tmd-bulk-opt"><input type="checkbox" class="tmd-bulk-redownload"> <span></span></label>' +
                  '<span class="tmd-bulk-chunk-fields">' +
                    '<label class="tmd-bulk-opt tmd-bulk-opt-num"><span></span> <input type="number" min="1" class="tmd-settings-number tmd-bulk-max-files"></label>' +
                    '<label class="tmd-bulk-opt tmd-bulk-opt-num"><span></span> <input type="number" min="1" class="tmd-settings-number tmd-bulk-max-mb"></label>' +
                  '</span>' +
                  '<div class="tmd-bulk-warn"></div>' +
                  '<div class="tmd-bulk-hint"></div>' +
                '</div>' +
              '</div>';
            document.body.appendChild(bar);
            fab = document.createElement('button');
            fab.type = 'button';
            fab.className = 'tmd-bulk-fab';
            fab.innerHTML =
              '<svg class="tmd-bulk-fab-icon" viewBox="0 0 24 24" aria-hidden="true">' +
                '<path d="M3,14 v5 q0,2 2,2 h14 q2,0 2,-2 v-5 M7,10 l4,4 q1,1 2,0 l4,-4 M12,3 v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
              '</svg>' +
              '<span class="tmd-bulk-fab-status" aria-hidden="true"></span>';
            document.body.appendChild(fab);
            startBtn = bar.querySelector('.tmd-bulk-start');
            stopBtn = bar.querySelector('.tmd-bulk-stop');
            hideBtn = bar.querySelector('.tmd-bulk-hide');
            statusEl = bar.querySelector('.tmd-bulk-status');
            fabStatusEl = fab.querySelector('.tmd-bulk-fab-status');
            optsEl = bar.querySelector('.tmd-bulk-opts');
            zipInput = bar.querySelector('.tmd-bulk-zip');
            chunkInput = bar.querySelector('.tmd-bulk-chunk');
            redownloadInput = bar.querySelector('.tmd-bulk-redownload');
            filesInput = bar.querySelector('.tmd-bulk-max-files');
            mbInput = bar.querySelector('.tmd-bulk-max-mb');
            limitEnabledInput = bar.querySelector('.tmd-bulk-limit-enabled');
            limitInput = bar.querySelector('.tmd-bulk-limit');
            limitFields = bar.querySelector('.tmd-bulk-limit-fields');
            warnEl = bar.querySelector('.tmd-bulk-warn');
            chunkFields = bar.querySelector('.tmd-bulk-chunk-fields');
            manualInput = bar.querySelector('.tmd-bulk-manual');
            startBtn.onclick = () => TMD.bulk.start();
            stopBtn.onclick = () => TMD.bulk.stop();
            hideBtn.onclick = () => setCollapsed(true);
            fab.onclick = () => {
              setCollapsed(false);
            };
            zipInput.onchange = syncOptUi;
            chunkInput.onchange = syncOptUi;
            limitEnabledInput.onchange = syncOptUi;
            manualInput.onchange = syncOptUi;
          }
          stopBtn.textContent = lang.bulk.stop;
          hideBtn.textContent = lang.bulk.hide;
          hideBtn.title = lang.bulk.hide_title;
          fab.title = lang.bulk.show_title;
          fab.setAttribute('aria-label', lang.bulk.show_title);
          bar.querySelector('.tmd-bulk-manual + span').textContent = lang.dialog.bulk_manual_scroll;
          bar.querySelector('.tmd-bulk-limit-enabled + span').textContent = lang.dialog.bulk_scrape_limit_enabled;
          bar.querySelector('.tmd-bulk-limit').previousElementSibling.textContent = lang.dialog.bulk_scrape_limit;
          bar.querySelector('.tmd-bulk-zip + span').textContent = lang.dialog.bulk_zip;
          bar.querySelector('.tmd-bulk-chunk + span').textContent = lang.dialog.bulk_zip_chunk;
          bar.querySelector('.tmd-bulk-redownload + span').textContent = lang.dialog.bulk_redownload;
          bar.querySelector('.tmd-bulk-max-files').previousElementSibling.textContent = lang.dialog.bulk_zip_max_files;
          bar.querySelector('.tmd-bulk-max-mb').previousElementSibling.textContent = lang.dialog.bulk_zip_max_mb;
          warnEl.textContent = lang.dialog.bulk_zip_unchunked_warn;
          if (!running && (lastPath !== location.pathname || !zipInput.dataset.ready)) {
            if (lastPath !== location.pathname) setStatus('');
            loadOptDefaults();
            zipInput.dataset.ready = '1';
          } else {
            syncOptUi();
          }
          lastPath = location.pathname;
          applyCollapsed();
        },
        toggleFromMenu: async function () {
          if (!isMediaPage()) {
            alert(lang.bulk.need_media);
            return;
          }
          await this.ensureBar();
          if (collapsed) {
            setCollapsed(false);
            return;
          }
          if (running) this.stop();
          else this.start();
        },
        stop: function () {
          abort = true;
          if (phase === 'collect-manual') manualProceed = false;
          setStatus(lang.bulk.stopping);
        },
        start: async function () {
          if (running && phase === 'collect-manual') {
            manualProceed = true;
            return;
          }
          if (running) return;
          if (!isMediaPage()) {
            alert(lang.bulk.need_media);
            return;
          }
          await this.ensureBar();
          setCollapsed(false);
          let opts = readRunOptions();
          if (opts.redownload && !confirm(lang.bulk.redownload_confirm)) return;
          abort = false;
          manualProceed = false;
          try {
            const HARD_CAP = await getPositiveInt('bulk_hard_cap', LIMIT_DEFAULTS.bulk_hard_cap);
            let limitEnabled = !!opts.limitEnabled;
            let limit = limitEnabled
              ? Math.min(opts.limit || LIMIT_DEFAULTS.bulk_scrape_limit, HARD_CAP)
              : HARD_CAP;
            let collectStatus = (n) => {
              if (opts.manual) {
                return limitEnabled
                  ? lang.bulk.watching.replace('{n}', String(n)).replace('{limit}', String(limit))
                  : lang.bulk.watching_unlimited.replace('{n}', String(n));
              }
              return limitEnabled
                ? lang.bulk.scrolling.replace('{n}', String(n)).replace('{limit}', String(limit))
                : lang.bulk.scrolling_unlimited.replace('{n}', String(n));
            };
            setRunning(true, opts.manual ? 'collect-manual' : 'collect-auto');
            setStatus(collectStatus(0));
            if (opts.manual) updateStartLabel(0);

            let ids = opts.manual
              ? await collectIdsManual(limit, (n) => {
                  setStatus(collectStatus(n));
                  updateStartLabel(n);
                })
              : await collectIdsAuto(limit, (n) => setStatus(collectStatus(n)));

            if (abort) {
              setStatus(lang.bulk.stopped.replace('{n}', String(ids.length)));
              return;
            }
            setRunning(true, 'download');
            let targets = opts.redownload ? ids.slice() : ids.filter(id => !historyHas(id));
            if (!targets.length) {
              setStatus(lang.bulk.nothing);
              return;
            }
            if (opts.zip) await this.downloadZip(targets, opts);
            else await this.downloadLoose(targets);
          } catch (e) {
            console.warn('[TMD] bulk', e);
            setStatus((lang.bulk.failed || 'Failed') + ': ' + (e && e.message ? e.message : 'ERROR'));
          } finally {
            manualProceed = false;
            setRunning(false);
            abort = false;
          }
        },
        downloadLoose: async function (targets) {
          let done = 0;
          let failed = 0;
          for (let i = 0; i < targets.length; i++) {
            if (abort) break;
            let status_id = targets[i];
            setStatus(lang.bulk.downloading
              .replace('{done}', String(done))
              .replace('{total}', String(targets.length))
              .replace('{failed}', String(failed)));
            try {
              let resolved = await TMD.resolveTweetMedia(status_id);
              let ok = await new Promise(resolve => {
                let left = resolved.files.length;
                let success = true;
                resolved.files.forEach(file => {
                  TMD.downloader.add({
                    url: file.url,
                    name: file.name,
                    onload: () => {
                      left -= 1;
                      if (left === 0) resolve(success);
                    },
                    onerror: () => {
                      success = false;
                      left -= 1;
                      if (left === 0) resolve(false);
                    }
                  });
                });
              });
              if (ok) {
                await TMD.markDownloaded(status_id);
                done += 1;
              } else {
                failed += 1;
              }
            } catch (e) {
              failed += 1;
              console.warn('[TMD] bulk loose', status_id, e);
            }
          }
          setStatus((abort ? lang.bulk.stopped : lang.bulk.done)
            .replace('{n}', String(done))
            .replace('{failed}', String(failed)));
        },
        downloadZip: async function (targets, opts) {
          if (typeof JSZip === 'undefined') throw new Error('JSZIP_MISSING');
          opts = opts || readRunOptions();
          let chunk = !!opts.chunk;
          let maxFiles = opts.maxFiles || LIMIT_DEFAULTS.bulk_zip_max_files;
          let maxMb = opts.maxMb || LIMIT_DEFAULTS.bulk_zip_max_mb;
          let maxBytes = maxMb * 1024 * 1024;
          let stamp = TMD.formatDate(new Date().toISOString(), 'YYYYMMDD-hhmmss', true);
          let user = mediaPageUser();
          let zip = new JSZip();
          let zipFiles = 0;
          let zipBytes = 0;
          let part = 1;
          let usedNames = new Set();
          let pendingIds = [];
          let packed = 0;
          let done = 0;
          let failed = 0;

          const uniqueName = (name) => {
            let base = String(name || 'file').replace(/^\/+/, '');
            if (!usedNames.has(base)) {
              usedNames.add(base);
              return base;
            }
            let m = base.match(/^(.*?)(\.[^.]+)?$/);
            let stem = m[1];
            let ext = m[2] || '';
            let n = 2;
            let candidate = stem + '-' + n + ext;
            while (usedNames.has(candidate)) {
              n += 1;
              candidate = stem + '-' + n + ext;
            }
            usedNames.add(candidate);
            return candidate;
          };

          const flushZip = async () => {
            if (zipFiles === 0) return;
            let toMark = pendingIds.slice();
            let name = chunk
              ? user + '_media_' + stamp + '_part' + part + '.zip'
              : user + '_media_' + stamp + '.zip';
            let partNum = String(part);
            let fileCount = String(zipFiles);
            setStatus(lang.bulk.zipping
              .replace('{n}', partNum)
              .replace('{pct}', '0')
              .replace('{files}', fileCount));
            let lastPct = -1;
            let blob = await zip.generateAsync({type: 'blob', streamFiles: true}, meta => {
              let pct = meta && typeof meta.percent === 'number' ? Math.floor(meta.percent) : 0;
              if (pct === lastPct) return;
              lastPct = pct;
              setStatus(lang.bulk.zipping
                .replace('{n}', partNum)
                .replace('{pct}', String(pct))
                .replace('{files}', fileCount));
            });
            setStatus(lang.bulk.zip_saving.replace('{n}', partNum));
            await TMD.saveBlob(blob, name);
            for (let j = 0; j < toMark.length; j++) {
              await TMD.markDownloaded(toMark[j]);
            }
            done += toMark.length;
            pendingIds = [];
            part += 1;
            zip = new JSZip();
            zipFiles = 0;
            zipBytes = 0;
            usedNames = new Set();
          };

          for (let i = 0; i < targets.length; i++) {
            if (abort) break;
            let status_id = targets[i];
            setStatus(lang.bulk.downloading
              .replace('{done}', String(packed))
              .replace('{total}', String(targets.length))
              .replace('{failed}', String(failed)));
            try {
              setStatus(lang.bulk.resolving
                .replace('{done}', String(packed))
                .replace('{total}', String(targets.length))
                .replace('{id}', status_id));
              let resolved = await TMD.resolveTweetMedia(status_id);
              let buffers = [];
              for (let f = 0; f < resolved.files.length; f++) {
                setStatus(lang.bulk.fetching
                  .replace('{done}', String(packed))
                  .replace('{total}', String(targets.length))
                  .replace('{file}', String(f + 1))
                  .replace('{files}', String(resolved.files.length))
                  .replace('{failed}', String(failed)));
                let buf = await TMD.fetchBuffer(resolved.files[f].url);
                buffers.push({
                  origName: resolved.files[f].name,
                  data: buf,
                  size: buf.byteLength || 0
                });
              }
              let addSize = buffers.reduce((s, b) => s + b.size, 0);
              if (chunk && zipFiles > 0 && (zipFiles + buffers.length > maxFiles || zipBytes + addSize > maxBytes)) {
                await flushZip();
              }
              buffers.forEach(b => {
                zip.file(uniqueName(b.origName), b.data);
                zipFiles += 1;
                zipBytes += b.size;
              });
              pendingIds.push(status_id);
              packed += 1;
              if (chunk && (zipFiles >= maxFiles || zipBytes >= maxBytes)) {
                await flushZip();
              }
            } catch (e) {
              failed += 1;
              console.warn('[TMD] bulk zip', status_id, e);
            }
          }
          if (zipFiles > 0) await flushZip();
          setStatus((abort ? lang.bulk.stopped : lang.bulk.done)
            .replace('{n}', String(done))
            .replace('{failed}', String(failed)));
        }
      };
    })(),
    downloader: (function () {
      let tasks = [], thread = 0;
      let max_thread = LIMIT_DEFAULTS.download_max_threads;
      let configured_max_thread = LIMIT_DEFAULTS.download_max_threads;
      let retry = 0;
      let max_retry = LIMIT_DEFAULTS.download_max_retries;
      let throttle_after = LIMIT_DEFAULTS.download_throttle_after;
      let failed = 0, notifier, has_failed = false;
      return {
        refreshLimits: async function () {
          configured_max_thread = await getPositiveInt('download_max_threads', LIMIT_DEFAULTS.download_max_threads);
          max_retry = await getPositiveInt('download_max_retries', LIMIT_DEFAULTS.download_max_retries);
          throttle_after = await getPositiveInt('download_throttle_after', LIMIT_DEFAULTS.download_throttle_after);
          max_thread = retry >= throttle_after ? 1 : configured_max_thread;
        },
        add: function (task) {
          tasks.push(task);
          if (thread < max_thread) {
            thread += 1;
            this.next();
          } else this.update();
        },
        next: async function () {
          let task = tasks.shift();
          await this.start(task);
          if (tasks.length > 0 && thread <= max_thread) this.next();
          else thread -= 1;
          this.update();
        },
        start: function (task) {
          this.update();
          return new Promise(resolve => {
            GM_download({
              url: task.url,
              name: task.name,
              onload: result => {
                task.onload();
                resolve();
              },
              onerror: result => {
                this.retry(task, result);
                resolve();
              },
              ontimeout: result => {
                this.retry(task, result);
                resolve();
              }
            });
          });
        },
        retry: function (task, result) {
          retry += 1;
          if (retry === throttle_after) max_thread = 1;
          if (task.retry && task.retry >= max_retry ||
              result.details && result.details.current === 'USER_CANCELED') {
            task.onerror(result);
            failed += 1;
          } else {
            if (max_thread === 1) task.retry = (task.retry || 0) + 1;
            this.add(task);
          }
        },
        update: function() {
          if (!notifier) {
            notifier = document.createElement('div');
            notifier.title = 'Twitter Media Downloader';
            notifier.classList.add('tmd-notifier');
            notifier.innerHTML = '<label>0</label>|<label>0</label>';
            document.body.appendChild(notifier);
          }
          if (failed > 0 && !has_failed) {
            has_failed = true;
            notifier.innerHTML += '|';
            let clear = document.createElement('label');
            notifier.appendChild(clear);
            clear.onclick = () => {
              notifier.innerHTML = '<label>0</label>|<label>0</label>';
              failed = 0;
              has_failed = false;
              this.update();
            };
          }
          notifier.firstChild.innerText = thread;
          notifier.firstChild.nextElementSibling.innerText = tasks.length;
          if (failed > 0) notifier.lastChild.innerText = failed;
          if (thread > 0 || tasks.length > 0 || failed > 0) notifier.classList.add('running');
          else notifier.classList.remove('running');
        }
      };
    })(),
    language: {
      en: {
        download: 'Download', completed: 'Download Completed', settings: 'Settings',
        dialog: {
          title: 'Download Settings', save: 'Save', save_history: 'Remember download history', clear_history: '(Clear)', clear_confirm: 'Clear download history?', show_sensitive: 'Always show sensitive content', pattern: 'File Name Pattern',
          limits_section: 'Download limits', download_max_threads: 'Concurrent downloads', download_max_retries: 'Retries per file', download_throttle_after: 'Slow down after N errors', download_throttle_after_hint: 'After this many download errors, concurrency drops to 1.', bulk_hard_cap: 'Max items per bulk run',
          bulk_section: 'Bulk media page', bulk_zip: 'Download as ZIP', bulk_zip_chunk: 'Split ZIP into chunks', bulk_zip_unchunked_warn: 'One large ZIP can freeze or crash the tab on big accounts.', bulk_zip_max_files: 'Max files per ZIP', bulk_zip_max_mb: 'Max MB per ZIP', bulk_scrape_limit_enabled: 'Limit scrape count', bulk_scrape_limit: 'Scrape limit', bulk_redownload: 'Also re-download already completed', bulk_manual_scroll: 'I\'ll scroll myself'
        },
        bulk: {
          menu: 'Bulk download media page', start: 'Download all', watch: 'Watch while I scroll', download_found: 'Download {n} found', stop: 'Stop', need_media: 'Open a profile Media tab first.',
          hide: 'Hide', hide_title: 'Hide bulk panel', show: 'Bulk download', show_title: 'Show bulk download panel',
          opts_hint: 'These options apply to this run only. Defaults come from Settings.',
          opts_hint_manual: 'Scroll until you reach the bottom (or your limit). The count updates live - then click Download N found.',
          redownload_confirm: 'Re-download is on. Previously completed tweets will be fetched again. Continue?',
          scrolling: 'Scrolling… {n}/{limit} found', scrolling_unlimited: 'Scrolling… {n} found',
          watching: 'Scroll freely… {n}/{limit} found - click Download when ready', watching_unlimited: 'Scroll freely… {n} found - click Download when ready',
          nothing: 'Nothing to download', stopping: 'Stopping…',
          downloading: 'Downloading {done}/{total} (failed {failed})',
          resolving: 'Resolving {done}/{total}… ({id})',
          fetching: 'Fetching media {done}/{total} - file {file}/{files} (failed {failed})',
          zipping: 'Building ZIP part {n}… {pct}% ({files} files)',
          zip_saving: 'Writing ZIP part {n} to disk…',
          done: 'Done: {n} saved, {failed} failed', stopped: 'Stopped after {n}', failed: 'Failed'
        }
      }
    },
    css: `
.tmd-down {margin-left: 12px; order: 99;}
.tmd-down:hover > div > div > div > div {color: rgba(29, 161, 242, 1.0);}
.tmd-down:hover > div > div > div > div > div {background-color: rgba(29, 161, 242, 0.1);}
.tmd-down:active > div > div > div > div > div {background-color: rgba(29, 161, 242, 0.2);}
.tmd-down:hover svg {color: rgba(29, 161, 242, 1.0);}
.tmd-down:hover div:first-child:not(:last-child) {background-color: rgba(29, 161, 242, 0.1);}
.tmd-down:active div:first-child:not(:last-child) {background-color: rgba(29, 161, 242, 0.2);}
.tmd-down.tmd-media {position: absolute; right: 0; top: 0; z-index: 10; pointer-events: auto;}
.tmd-down.tmd-media > div {display: flex; border-radius: 99px; margin: 2px;}
.tmd-down.tmd-media > div > div {display: flex; margin: 6px; color: #fff;}
.tmd-down.tmd-media:hover > div {background-color: rgba(255,255,255, 0.6);}
.tmd-down.tmd-media:hover > div > div {color: rgba(29, 161, 242, 1.0);}
.tmd-down.tmd-media:not(:hover) > div > div {filter: drop-shadow(0 0 1px #000);}
.tmd-down g {display: none;}
.tmd-down.download g.download, .tmd-down.completed g.completed, .tmd-down.loading g.loading,.tmd-down.failed g.failed {display: unset;}
.tmd-down.loading svg {animation: spin 1s linear infinite;}
@keyframes spin {0% {transform: rotate(0deg);} 100% {transform: rotate(360deg);}}
.tmd-btn {appearance: none; border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; background: #1d9bf0; color: #fff; font: 600 14px/1.2 system-ui, -apple-system, sans-serif; padding: 8px 18px; border-radius: 999px;}
.tmd-btn:hover {background: #1a8cd8;}
.tmd-btn:disabled {opacity: 0.5; cursor: default;}
.tmd-btn-ghost {appearance: none; border: 0; cursor: pointer; background: transparent; color: #1d9bf0; font: 500 13px/1.2 system-ui, -apple-system, sans-serif; padding: 4px 8px; border-radius: 6px;}
.tmd-btn-ghost:hover {background: rgba(29,155,240,0.12);}
.tmd-btn-ghost:disabled {opacity: 0.4; cursor: default;}
.tmd-tag {appearance: none; cursor: pointer; display: inline-flex; align-items: center; background: #202327; color: #e7e9ea; padding: 5px 10px; border-radius: 999px; border: 1px solid #2f3336; font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 0;}
.tmd-tag:hover {border-color: #1d9bf0; color: #1d9bf0; background: rgba(29,155,240,0.08);}
.tmd-settings-backdrop {position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,0.65); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #e7e9ea;}
.tmd-settings {width: min(560px, 100%); max-height: min(90vh, 720px); overflow: auto; background: #16181c; border: 1px solid #2f3336; border-radius: 16px; box-shadow: 0 24px 80px rgba(0,0,0,0.55); color: #e7e9ea;}
.tmd-settings-header {display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid #2f3336; position: sticky; top: 0; background: #16181c; z-index: 1;}
.tmd-settings-title {margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: #e7e9ea;}
.tmd-settings-section {margin: 16px 20px; padding: 4px 0; border: 1px solid #2f3336; border-radius: 12px; background: #0f1419;}
.tmd-settings-row {display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; cursor: pointer;}
.tmd-settings-row + .tmd-settings-row {border-top: 1px solid #2f3336;}
.tmd-settings-label {font-size: 15px; font-weight: 500; color: #e7e9ea;}
.tmd-settings-actions {display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;}
.tmd-settings-field-label {display: block; padding: 14px 16px 8px; font-size: 13px; font-weight: 600; color: #71767b; text-transform: uppercase; letter-spacing: 0.04em;}
.tmd-settings-warn {display: none; padding: 0 16px 12px; font-size: 13px; line-height: 1.4; color: #e7a238;}
.tmd-settings-number {width: 88px; box-sizing: border-box; border: 1px solid #2f3336; border-radius: 8px; background: #000; color: #e7e9ea; font: 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 6px 8px; outline: none;}
.tmd-settings-number:focus {border-color: #1d9bf0;}
.tmd-settings-textarea {display: block; width: calc(100% - 32px); margin: 0 16px 12px; box-sizing: border-box; min-height: 96px; resize: vertical; border: 1px solid #2f3336; border-radius: 10px; background: #000; color: #e7e9ea; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 12px 14px; outline: none;}
.tmd-settings-textarea:focus {border-color: #1d9bf0; box-shadow: 0 0 0 1px #1d9bf0;}
.tmd-settings-tags {display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 16px;}
.tmd-switch {appearance: none; width: 42px; height: 24px; margin: 0; border-radius: 999px; background: #333639; border: 0; position: relative; cursor: pointer; transition: background 0.15s ease; flex-shrink: 0;}
.tmd-switch::after {content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.15s ease;}
.tmd-switch:checked {background: #1d9bf0;}
.tmd-switch:checked::after {transform: translateX(18px);}
.tmd-switch:focus-visible {outline: 2px solid #1d9bf0; outline-offset: 2px;}
.tmd-bulk-bar {position: fixed; top: 0; left: 0; right: 0; z-index: 9990; pointer-events: none; padding: 10px 12px; background: linear-gradient(to bottom, rgba(0,0,0,0.72), transparent 80%);}
.tmd-bulk-bar-inner {pointer-events: auto; display: flex; flex-direction: column; gap: 10px; max-width: 920px; margin: 0 auto; padding: 12px 14px; background: #16181c; border: 1px solid #2f3336; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.45); color: #e7e9ea; font: 500 13px/1.3 system-ui, -apple-system, sans-serif;}
.tmd-bulk-actions {display: flex; align-items: center; gap: 10px;}
.tmd-bulk-status {flex: 1; min-width: 0; color: #71767b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;}
.tmd-bulk-hide {flex-shrink: 0; color: #71767b !important;}
.tmd-bulk-hide:hover {color: #e7e9ea !important;}
.tmd-bulk-opts {display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding-top: 8px; border-top: 1px solid #2f3336;}
.tmd-bulk-opt {display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: #e7e9ea; font-weight: 500; user-select: none;}
.tmd-bulk-opt input[type="checkbox"] {accent-color: #1d9bf0; width: 15px; height: 15px; margin: 0;}
.tmd-bulk-opt-num {gap: 8px;}
.tmd-bulk-opt-num .tmd-settings-number {width: 72px;}
.tmd-bulk-chunk-fields, .tmd-bulk-limit-fields {display: inline-flex; flex-wrap: wrap; gap: 8px 14px; align-items: center;}
.tmd-bulk-warn {display: none; width: 100%; font-size: 12px; line-height: 1.35; color: #e7a238;}
.tmd-bulk-hint {width: 100%; font-size: 11px; line-height: 1.35; color: #71767b;}
/* Stack above X's bottom-right FABs (chat + companion), matching their circular size/spacing. */
.tmd-bulk-fab {position: fixed; right: 20px; bottom: calc(20px + 52px + 16px + 52px + 16px); z-index: 9991; display: none; align-items: center; justify-content: center; width: 52px; height: 52px; margin: 0; padding: 0; border: 0; border-radius: 9999px; background: #1d9bf0; color: #fff; box-shadow: rgba(0,0,0,0.08) 0px 8px 28px, rgba(0,0,0,0.2) 0 0 1px; cursor: pointer; transition: background 0.15s ease, transform 0.15s ease; overflow: visible;}
.tmd-bulk-fab:hover {background: #1a8cd8;}
.tmd-bulk-fab:active {transform: scale(0.96);}
.tmd-bulk-fab-icon {width: 22px; height: 22px; display: block;}
.tmd-bulk-fab-status {display: none; position: absolute; top: 2px; right: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 2px #1d9bf0;}
.tmd-bulk-fab-running {background: #1d9bf0;}
.tmd-bulk-fab-running .tmd-bulk-fab-icon {animation: spin 1s linear infinite;}
.tmd-bulk-fab-running .tmd-bulk-fab-status {display: block;}
@media (max-width: 700px) {
  .tmd-bulk-fab {right: 16px; bottom: calc(16px + 48px + 12px + 48px + 12px); width: 48px; height: 48px;}
  .tmd-bulk-fab-icon {width: 20px; height: 20px;}
}
.tmd-notifier {display: none; position: fixed; left: 16px; bottom: 16px; color: #e7e9ea; background: #16181c; border: 1px solid #2f3336; border-radius: 12px; padding: 6px 4px; box-shadow: 0 8px 32px rgba(0,0,0,0.45);}
.tmd-notifier.running {display: flex; align-items: center;}
.tmd-notifier label {display: inline-flex; align-items: center; margin: 0 8px; color: #e7e9ea;}
.tmd-notifier label:before {content: " "; width: 32px; height: 16px; background-position: center; background-repeat: no-repeat;}
.tmd-notifier label:nth-child(1):before {background-image:url("data:image/svg+xml;charset=utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22><path d=%22M3,14 v5 q0,2 2,2 h14 q2,0 2,-2 v-5 M7,10 l4,4 q1,1 2,0 l4,-4 M12,3 v11%22 fill=%22none%22 stroke=%22%23e7e9ea%22 stroke-width=%222%22 stroke-linecap=%22round%22 /></svg>");}
.tmd-notifier label:nth-child(2):before {background-image:url("data:image/svg+xml;charset=utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22><path d=%22M12,2 a1,1 0 0 1 0,20 a1,1 0 0 1 0,-20 M12,5 v7 h6%22 fill=%22none%22 stroke=%22%2371767b%22 stroke-width=%222%22 stroke-linejoin=%22round%22 stroke-linecap=%22round%22 /></svg>");}
.tmd-notifier label:nth-child(3):before {background-image:url("data:image/svg+xml;charset=utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22><path d=%22M12,0 a2,2 0 0 0 0,24 a2,2 0 0 0 0,-24%22 fill=%22%23f66%22 stroke=%22none%22 /><path d=%22M14.5,5 a1,1 0 0 0 -5,0 l0.5,9 a1,1 0 0 0 4,0 z M12,17 a2,2 0 0 0 0,5 a2,2 0 0 0 0,-5%22 fill=%22%23fff%22 stroke=%22none%22 /></svg>");}
.tmd-down.tmd-img {position: absolute; right: 0; bottom: 0; display: none !important;}
.tmd-down.tmd-img > div {display: flex; border-radius: 99px; margin: 2px; background-color: rgba(255,255,255, 0.6);}
.tmd-down.tmd-img > div > div {display: flex; margin: 6px; color: #fff !important;}
.tmd-down.tmd-img:not(:hover) > div > div {filter: drop-shadow(0 0 1px #000);}
.tmd-down.tmd-img:hover > div > div {color: rgba(29, 161, 242, 1.0);}
:hover > .tmd-down.tmd-img, .tmd-img.loading, .tmd-img.completed, .tmd-img.failed {display: block !important;}
.tweet-detail-action-item {width: 20% !important;}
`,
    css_ss: `
/* show sensitive in media tab */
li[role="listitem"]>div>div>div>div:not(:last-child) {filter: none;}
li[role="listitem"]>div>div>div>div+div:last-child {display: none;}
`,
    svg: `
<g class="download"><path d="M3,14 v5 q0,2 2,2 h14 q2,0 2,-2 v-5 M7,10 l4,4 q1,1 2,0 l4,-4 M12,3 v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></g>
<g class="completed"><path d="M3,14 v5 q0,2 2,2 h14 q2,0 2,-2 v-5 M7,10 l3,4 q1,1 2,0 l8,-11" fill="none" stroke="#1DA1F2" stroke-width="2" stroke-linecap="round" /></g>
<g class="loading"><circle cx="12" cy="12" r="10" fill="none" stroke="#1DA1F2" stroke-width="4" opacity="0.4" /><path d="M12,2 a10,10 0 0 1 10,10" fill="none" stroke="#1DA1F2" stroke-width="4" stroke-linecap="round" /></g>
<g class="failed"><circle cx="12" cy="12" r="11" fill="#f33" stroke="currentColor" stroke-width="2" opacity="0.8" /><path d="M14,5 a1,1 0 0 0 -4,0 l0.5,9.5 a1.5,1.5 0 0 0 3,0 z M12,17 a2,2 0 0 0 0,4 a2,2 0 0 0 0,-4" fill="#fff" stroke="none" /></g>
`
  };
})();

TMD.init();
