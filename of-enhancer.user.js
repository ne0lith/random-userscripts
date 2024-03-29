// ==UserScript==
// @name         Profile to XenForo Search
// @namespace    https://github.com/n30liberal/random-userscripts/
// @version      4.0
// @description  Add a button to search the profile URL on a XenForo forum
// @author       ne0liberal
// @match        https://onlyfans.com/*
// @match        https://www.instagram.com/*
// @match        https://twitter.com/*
// @match        https://fansly.com/*
// @match        https://www.tiktok.com/*
// @match        https://www.reddit.com/*
// @updateURL    https://github.com/ne0lith/random-userscripts/raw/main/of-enhancer.user.js
// @downloadURL  https://github.com/ne0lith/random-userscripts/raw/main/of-enhancer.user.js
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
        'fansly.com': {
            colorScheme: {
                background: '#2699F6',
                color: '#ffffff',
            },
            profileRegex: /^https?:\/\/fansly\.com\/[a-zA-Z0-9_-]+\/posts$/,
            enabled: true,
        },
        'twitter.com': {
            colorScheme: {
                background: '#1da1f2',
                color: '#ffffff',
            },
            profileRegex: /^https?:\/\/twitter\.com\/(?!(home|settings|notifications|explore|messages)\/?$)([a-zA-Z0-9_]+)(?:\/(media|with_replies|highlights|likes))?\/?$/,
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
        'www.tiktok.com': {
            colorScheme: {
                background: '#69c9d0',
                color: '#ffffff',
            },
            profileRegex: /https?:\/\/www\.tiktok\.com\/@/,
            enabled: true,
        },
        'www.reddit.com': {
            colorScheme: {
                background: '#ff4500',
                color: '#ffffff',
            },
            profileRegex: /^https?:\/\/www\.reddit\.com\/(?!(?:r\/(?:all|popular|mod)\/?$|[^/]*\/?$))(r\/[a-zA-Z0-9_]+|u(?:ser)?\/[a-zA-Z0-9_]+)\/?(?:\?.*)?$/,
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

    function sanitizeQuery(query) {
        query = query.replace(/https?:\/\/(?:www\.)?reddit\.com\/(r|u(?:ser)?|user)\/([a-zA-Z0-9_]+)\/?.*$/, 'https://www.reddit.com/$1/$2/');
        query = query.replace(/(https?:\/\/(?:www\.)?tiktok\.com\/@)([a-zA-Z0-9_]+)(?:\/|(\?|$).*)?$/, '$1$2');

        if (query.includes('twitter.com')) {
            query = query.replace(/\/?(media|with_replies|highlights|likes)?\/?$/, '');
        }

        if (query.includes('fansly.com')) {
            query = query.replace(/\/?posts$/, '');
        }

        return query;
    }

    function constructSearchURL(query) {
        const cleanedQuery = sanitizeQuery(query);
        const xenForoBaseURL = 'https://simpcity.su/search/';
        const encodedQuery = encodeURIComponent(cleanedQuery);
        return `${xenForoBaseURL}?q=${encodedQuery}&o=relevance`;
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
            const searchURL = constructSearchURL(profileURL);
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
