// ==UserScript==
// @name         Profile to XenForo Search
// @namespace    https://github.com/n30liberal/random-userscripts/
// @version      1.0
// @description  Add a button to search the profile URL on a XenForo forum
// @author       ne0liberal
// @match        https://onlyfans.com/*
// @updateURL    https://github.com/n30liberal/random-userscripts/raw/main/of-enhancer.user.js
// @downloadURL  https://github.com/n30liberal/random-userscripts/raw/main/of-enhancer.user.js
// ==/UserScript==

(function () {
    'use strict';

    function isProfilePage() {
        const profileRegex = /^https?:\/\/onlyfans\.com\/[a-zA-Z0-9_-]+$/;
        return profileRegex.test(window.location.href);
    }

    function constructXenForoSearchURL(query) {
        const xenForoBaseURL = 'https://simpcity.su/search/';
        const encodedQuery = encodeURIComponent(query);
        return `${xenForoBaseURL}?q=${encodedQuery}&o=date`;
    }

    function addRedSquareButton() {
        const existingButton = document.getElementById('xenforo-search-button');
        if (existingButton) return;

        const button = document.createElement('div');
        button.id = 'xenforo-search-button';
        button.textContent = 'Search';
        button.style.position = 'fixed';
        button.style.top = '10px';
        button.style.left = '10px';
        button.style.width = '75px';
        button.style.height = '75px';
        button.style.background = '#00aff0';
        button.style.color = '#feeff7';
        button.style.fontWeight = 'bold';
        button.style.fontSize = '13px';
        button.style.textAlign = 'center';
        button.style.lineHeight = '75px';
        button.style.cursor = 'pointer';
        button.style.zIndex = '9999';
        button.style.borderRadius = '25%';
        button.addEventListener('click', function () {
            const profileURL = window.location.href;
            const searchURL = constructXenForoSearchURL(profileURL);
            window.open(searchURL, '_blank');
        });
        document.body.appendChild(button);
    }

    function removeRedSquareButton() {
        const existingButton = document.getElementById('xenforo-search-button');
        if (existingButton) {
            existingButton.remove();
        }
    }

    const observer = new MutationObserver(function () {
        if (isProfilePage()) {
            addRedSquareButton();
        } else {
            removeRedSquareButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (isProfilePage()) {
        addRedSquareButton();
    }
})();
