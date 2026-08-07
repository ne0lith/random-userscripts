// ==UserScript==
// @name        Twitter Media Downloader
// @name:ja     Twitter Media Downloader
// @name:zh-cn  Twitter 媒体下载
// @name:zh-tw  Twitter 媒體下載
// @description    Save Video/Photo by One-Click.
// @description:ja ワンクリックで動画・画像を保存する。
// @description:zh-cn 一键保存视频/图片
// @description:zh-tw 一鍵保存視頻/圖片
// @version     1.44
// @author      AMANE
// @namespace   none
// @match       https://x.com/*
// @match       https://mobile.x.com/*
// @grant       GM_registerMenuCommand
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_download
// @grant       GM_xmlhttpRequest
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
    return part ? part.split('/').shift() : null;
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
      GM_registerMenuCommand((this.language[navigator.language] || this.language.en).settings, this.settings);
      lang = this.language[document.querySelector('html').lang] || this.language.en;
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
      let media = article.querySelector(media_selector.join(','));
      let status_anchor = article.querySelector('a[href*="/status/"]');
      let status_id = statusIdFromHref(status_anchor && status_anchor.href);
      // Lightbox: prefer the status id from the URL for the side panel article.
      if (inLightboxDialog) {
        if (status_id && status_id !== lightbox[1]) {
          article.dataset.detected = 'true';
          return;
        }
        status_id = lightbox[1];
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
      if (!status_id) status_id = lightbox && lightbox[1];
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
          responseType: 'json',
          onload: r => {
            let data = r.response;
            if (typeof data === 'string') {
              try { data = JSON.parse(data); } catch (e) { data = null; }
            }
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
    resolveTweetMedia: async function (status_id, index) {
      let out = (await GM_getValue('filename', filename)).split('\n').join('');
      try {
        return await this.resolveFromGraphql(status_id, index, out);
      } catch (e) {
        console.warn('[TMD] graphql resolve failed, trying syndication', status_id, e && e.message);
        return await this.resolveFromSyndication(status_id, index, out);
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
      let bulk_files_input = $element(bulk_files_row, 'input', null, await GM_getValue('bulk_zip_max_files', 80), 'tmd-settings-number');
      bulk_files_input.type = 'number';
      bulk_files_input.min = '1';

      let bulk_mb_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_mb_row, 'span', null, lang.dialog.bulk_zip_max_mb, 'tmd-settings-label');
      let bulk_mb_input = $element(bulk_mb_row, 'input', null, await GM_getValue('bulk_zip_max_mb', 400), 'tmd-settings-number');
      bulk_mb_input.type = 'number';
      bulk_mb_input.min = '1';

      let bulk_redownload_row = $element(bulk, 'label', null, null, 'tmd-settings-row');
      $element(bulk_redownload_row, 'span', null, lang.dialog.bulk_redownload, 'tmd-settings-label');
      let bulk_redownload_input = $element(bulk_redownload_row, 'input', null, 'checkbox', 'tmd-switch');
      bulk_redownload_input.checked = await GM_getValue('bulk_redownload', false);

      const syncBulkUi = () => {
        let zipOn = bulk_zip_input.checked;
        bulk_chunk_row.style.display = zipOn ? '' : 'none';
        bulk_files_row.style.display = zipOn && bulk_chunk_input.checked ? '' : 'none';
        bulk_mb_row.style.display = zipOn && bulk_chunk_input.checked ? '' : 'none';
        bulk_warn.style.display = zipOn && !bulk_chunk_input.checked ? '' : 'none';
      };
      bulk_zip_input.onchange = () => {
        GM_setValue('bulk_zip', bulk_zip_input.checked);
        syncBulkUi();
      };
      bulk_chunk_input.onchange = () => {
        GM_setValue('bulk_zip_chunk', bulk_chunk_input.checked);
        syncBulkUi();
      };
      bulk_redownload_input.onchange = () => {
        GM_setValue('bulk_redownload', bulk_redownload_input.checked);
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
        let maxFiles = parseInt(bulk_files_input.value, 10);
        let maxMb = parseInt(bulk_mb_input.value, 10);
        if (!isNaN(maxFiles) && maxFiles > 0) await GM_setValue('bulk_zip_max_files', maxFiles);
        if (!isNaN(maxMb) && maxMb > 0) await GM_setValue('bulk_zip_max_mb', maxMb);
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
      let bar, statusEl, startBtn, stopBtn, optsEl;
      let zipInput, chunkInput, redownloadInput, filesInput, mbInput, warnEl, chunkFields;
      let running = false;
      let abort = false;
      let lastPath = '';

      function setStatus(text) {
        if (statusEl) statusEl.textContent = text || '';
      }

      function setRunning(isRunning) {
        running = isRunning;
        if (startBtn) startBtn.disabled = isRunning;
        if (stopBtn) stopBtn.disabled = !isRunning;
        [zipInput, chunkInput, redownloadInput, filesInput, mbInput].forEach(el => {
          if (el) el.disabled = isRunning;
        });
      }

      function syncOptUi() {
        if (!zipInput) return;
        let zipOn = zipInput.checked;
        if (chunkInput) chunkInput.closest('.tmd-bulk-opt').style.display = zipOn ? '' : 'none';
        if (chunkFields) chunkFields.style.display = zipOn && chunkInput.checked ? '' : 'none';
        if (warnEl) warnEl.style.display = zipOn && !chunkInput.checked ? '' : 'none';
      }

      async function loadOptDefaults() {
        if (!zipInput || running) return;
        zipInput.checked = await GM_getValue('bulk_zip', true);
        chunkInput.checked = await GM_getValue('bulk_zip_chunk', true);
        redownloadInput.checked = await GM_getValue('bulk_redownload', false);
        filesInput.value = await GM_getValue('bulk_zip_max_files', 80);
        mbInput.value = await GM_getValue('bulk_zip_max_mb', 400);
        syncOptUi();
      }

      function readRunOptions() {
        let maxFiles = parseInt(filesInput && filesInput.value, 10);
        let maxMb = parseInt(mbInput && mbInput.value, 10);
        return {
          zip: !!(zipInput && zipInput.checked),
          chunk: !!(chunkInput && chunkInput.checked),
          redownload: !!(redownloadInput && redownloadInput.checked),
          maxFiles: !isNaN(maxFiles) && maxFiles > 0 ? maxFiles : 80,
          maxMb: !isNaN(maxMb) && maxMb > 0 ? maxMb : 400
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

      return {
        ensureBar: function () {
          let onMedia = isMediaPage();
          if (!onMedia) {
            if (bar) bar.style.display = 'none';
            lastPath = location.pathname;
            return;
          }
          if (!bar) {
            bar = document.createElement('div');
            bar.className = 'tmd-bulk-bar';
            bar.innerHTML =
              '<div class="tmd-bulk-bar-inner">' +
                '<div class="tmd-bulk-actions">' +
                  '<button type="button" class="tmd-btn tmd-bulk-start"></button>' +
                  '<button type="button" class="tmd-btn-ghost tmd-bulk-stop" disabled></button>' +
                  '<span class="tmd-bulk-status"></span>' +
                '</div>' +
                '<div class="tmd-bulk-opts">' +
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
            startBtn = bar.querySelector('.tmd-bulk-start');
            stopBtn = bar.querySelector('.tmd-bulk-stop');
            statusEl = bar.querySelector('.tmd-bulk-status');
            optsEl = bar.querySelector('.tmd-bulk-opts');
            zipInput = bar.querySelector('.tmd-bulk-zip');
            chunkInput = bar.querySelector('.tmd-bulk-chunk');
            redownloadInput = bar.querySelector('.tmd-bulk-redownload');
            filesInput = bar.querySelector('.tmd-bulk-max-files');
            mbInput = bar.querySelector('.tmd-bulk-max-mb');
            warnEl = bar.querySelector('.tmd-bulk-warn');
            chunkFields = bar.querySelector('.tmd-bulk-chunk-fields');
            startBtn.onclick = () => TMD.bulk.start();
            stopBtn.onclick = () => TMD.bulk.stop();
            zipInput.onchange = syncOptUi;
            chunkInput.onchange = syncOptUi;
          }
          startBtn.textContent = lang.bulk.start;
          stopBtn.textContent = lang.bulk.stop;
          bar.querySelector('.tmd-bulk-zip + span').textContent = lang.dialog.bulk_zip;
          bar.querySelector('.tmd-bulk-chunk + span').textContent = lang.dialog.bulk_zip_chunk;
          bar.querySelector('.tmd-bulk-redownload + span').textContent = lang.dialog.bulk_redownload;
          bar.querySelector('.tmd-bulk-max-files').previousElementSibling.textContent = lang.dialog.bulk_zip_max_files;
          bar.querySelector('.tmd-bulk-max-mb').previousElementSibling.textContent = lang.dialog.bulk_zip_max_mb;
          warnEl.textContent = lang.dialog.bulk_zip_unchunked_warn;
          bar.querySelector('.tmd-bulk-hint').textContent = lang.bulk.opts_hint;
          bar.style.display = '';
          if (!running && (lastPath !== location.pathname || !zipInput.dataset.ready)) {
            if (lastPath !== location.pathname) setStatus('');
            loadOptDefaults();
            zipInput.dataset.ready = '1';
          }
          lastPath = location.pathname;
        },
        toggleFromMenu: function () {
          if (!isMediaPage()) {
            alert(lang.bulk.need_media);
            return;
          }
          this.ensureBar();
          if (running) this.stop();
          else this.start();
        },
        stop: function () {
          abort = true;
          setStatus(lang.bulk.stopping);
        },
        start: async function () {
          if (running) return;
          if (!isMediaPage()) {
            alert(lang.bulk.need_media);
            return;
          }
          this.ensureBar();
          let opts = readRunOptions();
          if (opts.redownload && !confirm(lang.bulk.redownload_confirm)) return;
          abort = false;
          setRunning(true);
          try {
            setStatus(lang.bulk.scrolling.replace('{n}', '0'));
            let seen = new Set();
            let ids = [];
            window.scrollTo(0, 0);
            await sleep(400);
            let idleRounds = 0;
            const MAX_IDLE = 5;
            const MAX_IDS = 5000;
            while (!abort && ids.length < MAX_IDS) {
              let before = ids.length;
              scanIds(seen, ids);
              setStatus(lang.bulk.scrolling.replace('{n}', String(ids.length)));
              window.scrollBy(0, Math.max(400, window.innerHeight * 0.85));
              await sleep(1600);
              scanIds(seen, ids);
              if (ids.length === before) idleRounds += 1;
              else idleRounds = 0;
              let nearBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 240);
              if (idleRounds >= MAX_IDLE && nearBottom) break;
            }
            if (abort) {
              setStatus(lang.bulk.stopped.replace('{n}', String(ids.length)));
              return;
            }
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
          let maxFiles = opts.maxFiles || 80;
          let maxMb = opts.maxMb || 400;
          let maxBytes = maxMb * 1024 * 1024;
          let stamp = TMD.formatDate(new Date().toISOString(), 'YYYYMMDD-hhmmss', true);
          let user = mediaPageUser();
          let zip = new JSZip();
          let zipFiles = 0;
          let zipBytes = 0;
          let part = 1;
          let usedNames = new Set();
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
            let name = chunk
              ? user + '_media_' + stamp + '_part' + part + '.zip'
              : user + '_media_' + stamp + '.zip';
            setStatus(lang.bulk.zipping.replace('{n}', String(part)));
            let blob = await zip.generateAsync({type: 'blob'});
            await TMD.saveBlob(blob, name);
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
              .replace('{done}', String(done))
              .replace('{total}', String(targets.length))
              .replace('{failed}', String(failed)));
            try {
              let resolved = await TMD.resolveTweetMedia(status_id);
              let buffers = [];
              for (let f = 0; f < resolved.files.length; f++) {
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
              await TMD.markDownloaded(status_id);
              done += 1;
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
      let tasks = [], thread = 0, max_thread = 2, retry = 0, max_retry = 2, failed = 0, notifier, has_failed = false;
      return {
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
          if (retry === 3) max_thread = 1;
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
          bulk_section: 'Bulk media page', bulk_zip: 'Download as ZIP', bulk_zip_chunk: 'Split ZIP into chunks', bulk_zip_unchunked_warn: 'One large ZIP can freeze or crash the tab on big accounts.', bulk_zip_max_files: 'Max files per ZIP', bulk_zip_max_mb: 'Max MB per ZIP', bulk_redownload: 'Also re-download already completed'
        },
        bulk: {
          menu: 'Bulk download media page', start: 'Download all', stop: 'Stop', need_media: 'Open a profile Media tab first.',
          opts_hint: 'These options apply to this run only. Defaults come from Settings.',
          redownload_confirm: 'Re-download is on. Previously completed tweets will be fetched again. Continue?',
          scrolling: 'Scrolling… {n} found', nothing: 'Nothing to download', stopping: 'Stopping…',
          downloading: 'Downloading {done}/{total} (failed {failed})', zipping: 'Saving ZIP part {n}…',
          done: 'Done: {n} saved, {failed} failed', stopped: 'Stopped after {n}', failed: 'Failed'
        }
      },
      ja: {
        download: 'ダウンロード', completed: 'ダウンロード完了', settings: '設定',
        dialog: {
          title: 'ダウンロード設定', save: '保存', save_history: 'ダウンロード履歴を保存する', clear_history: '(クリア)', clear_confirm: 'ダウンロード履歴を削除する?', show_sensitive: 'センシティブな内容を常に表示する', pattern: 'ファイル名パターン',
          bulk_section: 'メディア一括', bulk_zip: 'ZIPでダウンロード', bulk_zip_chunk: 'ZIPを分割する', bulk_zip_unchunked_warn: '巨大な単一ZIPはタブをフリーズ/クラッシュさせることがあります。', bulk_zip_max_files: 'ZIPあたり最大ファイル数', bulk_zip_max_mb: 'ZIPあたり最大MB', bulk_redownload: '取得済みも再ダウンロード'
        },
        bulk: {
          menu: 'メディア一括ダウンロード', start: 'すべてダウンロード', stop: '停止', need_media: 'プロフィールのメディアタブを開いてください。',
          opts_hint: 'この実行のみ有効。初期値は設定から読み込みます。',
          redownload_confirm: '再ダウンロードが有効です。完了済みも再取得します。続行しますか?',
          scrolling: 'スクロール中… {n} 件', nothing: 'ダウンロード対象なし', stopping: '停止中…',
          downloading: 'ダウンロード中 {done}/{total} (失敗 {failed})', zipping: 'ZIP保存中 part {n}…',
          done: '完了: {n} 件、失敗 {failed}', stopped: '{n} 件で停止', failed: '失敗'
        }
      },
      zh: {
        download: '下载', completed: '下载完成', settings: '设置',
        dialog: {
          title: '下载设置', save: '保存', save_history: '保存下载记录', clear_history: '(清除)', clear_confirm: '确认要清除下载记录?', show_sensitive: '自动显示敏感的内容', pattern: '文件名格式',
          bulk_section: '媒体页批量', bulk_zip: '打包为 ZIP', bulk_zip_chunk: '分割 ZIP', bulk_zip_unchunked_warn: '单个超大 ZIP 可能导致标签页卡死或崩溃。', bulk_zip_max_files: '每个 ZIP 最大文件数', bulk_zip_max_mb: '每个 ZIP 最大 MB', bulk_redownload: '重新下载已完成的'
        },
        bulk: {
          menu: '批量下载媒体页', start: '全部下载', stop: '停止', need_media: '请先打开用户的媒体标签页。',
          opts_hint: '仅用于本次运行。默认值来自设置。',
          redownload_confirm: '已开启重新下载,将再次获取已完成的推文。继续?',
          scrolling: '滚动中… 已找到 {n}', nothing: '没有可下载的内容', stopping: '正在停止…',
          downloading: '下载中 {done}/{total}(失败 {failed})', zipping: '正在保存 ZIP 第 {n} 卷…',
          done: '完成:{n} 个,失败 {failed}', stopped: '已停止({n})', failed: '失败'
        }
      },
      'zh-Hant': {
        download: '下載', completed: '下載完成', settings: '設置',
        dialog: {
          title: '下載設置', save: '保存', save_history: '保存下載記錄', clear_history: '(清除)', clear_confirm: '確認要清除下載記錄?', show_sensitive: '自動顯示敏感的内容', pattern: '文件名規則',
          bulk_section: '媒體頁批量', bulk_zip: '打包為 ZIP', bulk_zip_chunk: '分割 ZIP', bulk_zip_unchunked_warn: '單一超大 ZIP 可能導致分頁凍結或崩潰。', bulk_zip_max_files: '每個 ZIP 最大檔案數', bulk_zip_max_mb: '每個 ZIP 最大 MB', bulk_redownload: '重新下載已完成的'
        },
        bulk: {
          menu: '批量下載媒體頁', start: '全部下載', stop: '停止', need_media: '請先開啟使用者的媒體分頁。',
          opts_hint: '僅用於本次執行。預設值來自設定。',
          redownload_confirm: '已開啟重新下載,將再次取得已完成的推文。繼續?',
          scrolling: '捲動中… 已找到 {n}', nothing: '沒有可下載的內容', stopping: '正在停止…',
          downloading: '下載中 {done}/{total}(失敗 {failed})', zipping: '正在儲存 ZIP 第 {n} 卷…',
          done: '完成:{n} 個,失敗 {failed}', stopped: '已停止({n})', failed: '失敗'
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
.tmd-bulk-opts {display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding-top: 8px; border-top: 1px solid #2f3336;}
.tmd-bulk-opt {display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: #e7e9ea; font-weight: 500; user-select: none;}
.tmd-bulk-opt input[type="checkbox"] {accent-color: #1d9bf0; width: 15px; height: 15px; margin: 0;}
.tmd-bulk-opt-num {gap: 8px;}
.tmd-bulk-opt-num .tmd-settings-number {width: 72px;}
.tmd-bulk-chunk-fields {display: inline-flex; flex-wrap: wrap; gap: 8px 14px; align-items: center;}
.tmd-bulk-warn {display: none; width: 100%; font-size: 12px; line-height: 1.35; color: #e7a238;}
.tmd-bulk-hint {width: 100%; font-size: 11px; line-height: 1.35; color: #71767b;}
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
