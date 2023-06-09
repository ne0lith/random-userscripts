// ==UserScript==
// @name         Redirect to og:image URL
// @namespace    https://jpg.pet/
// @author       ne0liberal
// @version      1.7
// @description  Redirects the page to the URL specified in the og:image meta tag, excluding login and upload URLs
// @match        https://*.jpg.pet/*
// @match        https://*.pixl.li/*
// @match        https://*.jpg.church/*
// @match        https://*.ibb.co/*
// @updateURL    https://github.com/n30liberal/random-userscripts/raw/main/jpg-enhancer.user.js
// @downloadURL  https://github.com/n30liberal/random-userscripts/raw/main/jpg-enhancer.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Check if the source URL or og:image content contains certain keywords
    function shouldRedirect() {
        const sourceUrl = window.location.href;
        const ogImageMeta = document.querySelector('meta[property="og:image"]');
        const imageUrl = ogImageMeta ? ogImageMeta.getAttribute('content') : null;

        const keywords = ['login', 'upload', 'system'];

        for (let i = 0; i < keywords.length; i++) {
            if (sourceUrl.toLowerCase().includes(keywords[i]) || (imageUrl && imageUrl.toLowerCase().includes(keywords[i]))) {
                return false;
            }
        }

        return true;
    }

    // Find the og:image meta tag
    const ogImageMeta = document.querySelector('meta[property="og:image"]');
    if (ogImageMeta && shouldRedirect()) {
        const imageUrl = ogImageMeta.getAttribute('content');
        if (imageUrl) {
            // Redirect to the image URL
            window.location.href = imageUrl;
        }
    }
})();
