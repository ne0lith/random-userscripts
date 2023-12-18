// ==UserScript==
// @name         URL Extractor
// @version      1.0
// @description  Extracts URLs with specified substrings.
// @author       neolith
// @match        https://simpcity.su/threads/*
// @updateURL    https://github.com/ne0lith/random-userscripts/raw/main/sc_extractor.user.js
// @downloadURL  https://github.com/ne0lith/random-userscripts/raw/main/sc_extractor.user.js
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    var substringsToSearch = ['bunkr', 'cyberfile', 'coomer', 'mega'];

    function extractAndCopyUrls() {
        var urls = [];

        function scrollToBottom() {
            var currentPosition = window.scrollY;
            var targetPosition = document.body.scrollHeight;
            var distance = targetPosition - currentPosition;
            var step = distance / 50;

            var interval = setInterval(function () {
                window.scrollBy(0, step);
                currentPosition += step;

                if (currentPosition >= targetPosition) {
                    clearInterval(interval);

                    setTimeout(scrollToTop, 1000);
                }
            }, 50);
        }

        function scrollToTop() {
            window.scrollTo(0, 0);

            setTimeout(function () {
                var links = document.querySelectorAll('a');

                links.forEach(function (link) {
                    if (substringsToSearch.some(substring => link.href.includes(substring))) {
                        urls.push(link.href);
                    }
                });

                GM_setClipboard(urls.join('\n'), 'text');

                if (urls.length > 0) {
                    alert(urls.length + ' urls with specified substrings have been copied to clipboard:\n\n' + urls.join('\n'));
                } else {
                    console.log('No urls with specified substrings found');
                }
            }, 1000);
        }

        scrollToBottom();
    }

    var box = document.createElement('div');
    box.style.position = 'fixed';
    box.style.top = '100px';
    box.style.left = '10px';
    box.style.width = '50px';
    box.style.height = '50px';
    box.style.background = 'red';
    box.style.cursor = 'pointer';
    box.style.zIndex = '9999';
    box.title = 'Click to extract URLs with specified substrings';

    document.body.appendChild(box);

    box.addEventListener('click', extractAndCopyUrls);
})();
