// ==UserScript==
// @name         Profile to XenForo Search
// @namespace    https://github.com/n30liberal/random-userscripts/
// @version      2.0
// @description  Add a button to search the profile URL on a XenForo forum
// @author       ne0liberal
// @match        https://onlyfans.com/*
// @match        https://www.instagram.com/*
// @match        https://twitter.com/*
// @updateURL    https://github.com/n30liberal/random-userscripts/raw/main/of-enhancer.user.js
// @downloadURL  https://github.com/n30liberal/random-userscripts/raw/main/of-enhancer.user.js
// ==/UserScript==

(function () {
    'use strict';

    const domainConfig = {
        'onlyfans.com': {
            colorScheme: {
                background: '#00aff0',
                color: '#feeff7',
            },
            profileRegex: /^https?:\/\/onlyfans\.com\/[a-zA-Z0-9_-]+$/,
            enabled: true,
        },
        'www.instagram.com': {
            colorScheme: {
                background: '#e4405f',
                color: '#ffffff',
            },
            profileRegex: /^https?:\/\/www\.instagram\.com\/(?!(explore|)[a-zA-Z0-9_\.]+\/?$)/,
            enabled: false,
        },
        'twitter.com': {
            colorScheme: {
                background: '#1da1f2',
                color: '#ffffff',
            },
            profileRegex: /^https?:\/\/twitter\.com\/(?!(home|settings|notifications|explore|messages)\/?$)([a-zA-Z0-9_]+)(?:\/(media|with_replies|highlights|likes))?\/?$/,
            enabled: true,
        },
    };

    function isProfilePage() {
        const domain = window.location.hostname;
        if (domain in domainConfig) {
            const profileRegex = domainConfig[domain].profileRegex;
            return profileRegex.test(window.location.href) && domainConfig[domain].enabled;
        }
        return false;
    }

    function constructXenForoSearchURL(query) {
        query = query.replace(/\/(media|with_replies|highlights|likes)/, '');

        const xenForoBaseURL = 'https://simpcity.su/search/';
        const encodedQuery = encodeURIComponent(query);
        return `${xenForoBaseURL}?q=${encodedQuery}&o=date`;
    }

    function addSearchButton() {
        const existingButton = document.getElementById('xenforo-search-button');
        if (existingButton) return;

        const domain = window.location.hostname;
        if (!(domain in domainConfig)) return;

        const button = document.createElement('div');
        button.id = 'xenforo-search-button';
        button.textContent = 'Search';
        button.style.position = 'fixed';
        button.style.top = '10px';
        button.style.left = '10px';
        button.style.width = '75px';
        button.style.height = '75px';
        button.style.background = domainConfig[domain].colorScheme.background;
        button.style.color = domainConfig[domain].colorScheme.color;
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

    function removeSearchButton() {
        const existingButton = document.getElementById('xenforo-search-button');
        if (existingButton) {
            existingButton.remove();
        }
    }

    const observer = new MutationObserver(function () {
        if (isProfilePage()) {
            addSearchButton();
        } else {
            removeSearchButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (isProfilePage()) {
        addSearchButton();
    }
})();
