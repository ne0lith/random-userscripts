// ==UserScript==
// @name         Redirect to og:image URL (excluding login URLs)
// @namespace    https://jpg.pet/
// @author       ne0liberal
// @version      1.5
// @description  Redirects the page to the URL specified in the og:image meta tag, excluding login URLs
// @match        https://*.jpg.pet/*
// @match        https://*.pixl.li/*
// @match        https://*.jpg.church/*
// @updateURL    https://github.com/n30liberal/random-userscripts/raw/main/jpg-enhancer.user.js
// @downloadURL  https://github.com/n30liberal/random-userscripts/raw/main/jpg-enhancer.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Check if the source URL contains the word "login"
    function shouldRedirect() {
        const sourceUrl = window.location.href;
        return !/login/i.test(sourceUrl);
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
