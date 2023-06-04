// ==UserScript==
// @name         Redirect to og:image URL.
// @namespace    https://jpg.pet/
// @author ne0liberal
// @version      1.1
// @description  Redirects the page to the URL specified in the og:image meta tag
// @match        https://jpg.pet/*
// @updateURL https://github.com/n30liberal/random-userscripts/raw/main/jpg-enhancer.user.js
// @downloadURL https://github.com/n30liberal/random-userscripts/raw/main/jpg-enhancer.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Find the og:image meta tag
    const ogImageMeta = document.querySelector('meta[property="og:image"]');
    if (ogImageMeta) {
        const imageUrl = ogImageMeta.getAttribute('content');
        if (imageUrl) {
            // Redirect to the image URL
            window.location.href = imageUrl;
        }
    }
})();
