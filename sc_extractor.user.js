// ==UserScript==
// @name         URL Extractor
// @version      1.5
// @description  Extracts URLs with specified substrings.
// @author       neolith
// @match        https://simpcity.su/threads/*
// @updateURL    https://github.com/ne0lith/random-userscripts/raw/main/sc_extractor.user.js
// @downloadURL  https://github.com/ne0lith/random-userscripts/raw/main/sc_extractor.user.js
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    var defaultSubstrings = ['bunkr', 'cyberfile', 'coomer', 'mega'];
    var substringsToSearch = [...defaultSubstrings];

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

                    scrollToTop();
                }
            }, 50);
        }

        function scrollToTop() {
            window.scrollTo(0, 0);

            setTimeout(extractUrls, 1000);
        }

        function extractUrls() {
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
        }

        scrollToBottom();
    }

    var label = document.createElement('label');
    label.textContent = 'Domains to extract:';
    label.style.position = 'fixed';
    label.style.top = '97px';
    label.style.left = '70px';
    label.style.zIndex = '9999';

    var inputBox = document.createElement('input');
    inputBox.type = 'text';
    inputBox.style.position = 'fixed';
    inputBox.style.top = '123px';
    inputBox.style.left = '70px';
    inputBox.style.width = '200px';
    inputBox.placeholder = 'Add substrings (comma-separated)';
    inputBox.style.zIndex = '9999';
    inputBox.value = defaultSubstrings.join(', ');

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

    document.body.appendChild(label);
    document.body.appendChild(inputBox);
    document.body.appendChild(box);

    box.addEventListener('click', function () {
        substringsToSearch = inputBox.value.split(',').map(substring => substring.trim()).filter(Boolean);
        extractAndCopyUrls();
    });
})();
