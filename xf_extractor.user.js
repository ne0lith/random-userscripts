// ==UserScript==
// @name         URL Extractor
// @version      1.7
// @description  Extracts URLs with specified substrings.
// @author       neolith
// @match        https://simpcity.su/threads/*
// @updateURL    https://github.com/ne0lith/random-userscripts/raw/main/xf_extractor.user.js
// @downloadURL  https://github.com/ne0lith/random-userscripts/raw/main/xf_extractor.user.js
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    var defaultSubstrings = ['bunkr', 'cyberfile', 'coomer', 'mega'];

    var deepScrape = true;
    if (deepScrape) {
        defaultSubstrings = defaultSubstrings.concat(['gofile', 'pixeldrain', 'cyberdrop']);
      }

    var blacklistedHosts = ['simpcity.su', 'ucam.xxx', 'adsession.com', 'qrlsx.com', 'pornfaze.com', 'theporndude.com', 'security.org'];
    var substringsToSearch = [...defaultSubstrings];

    function isBlacklistedHost(url) {
        return blacklistedHosts.some(host => url.includes(host));
    }

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
                if (
                    substringsToSearch.some(substring => link.href.includes(substring)) &&
                    !isBlacklistedHost(link.href)
                ) {
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

    var containerDiv = document.createElement('div');
    containerDiv.style.position = 'fixed';
    containerDiv.style.top = '218px';
    containerDiv.style.left = '30px';
    containerDiv.style.width = '280px';
    containerDiv.style.height = '70px';
    containerDiv.style.background = '#272727';
    containerDiv.style.zIndex = '9998';
    containerDiv.style.borderRadius = '10px';
    containerDiv.style.border = '1px solid #414141';

    var label = document.createElement('label');
    label.textContent = 'Domains to extract:';
    label.style.position = 'absolute';
    label.style.top = '7px';
    label.style.left = '11px';
    label.style.zIndex = '9999';
    label.style.color = '#d3d3d3';
    label.style.fontWeight = "600"

    var inputBox = document.createElement('input');
    inputBox.type = 'text';
    inputBox.style.position = 'absolute';
    inputBox.style.top = '33px';
    inputBox.style.left = '10px';
    inputBox.style.width = '200px';
    inputBox.placeholder = 'Add substrings (comma-separated)';
    inputBox.style.zIndex = '9999';
    inputBox.style.borderRadius = '3px';
    inputBox.value = defaultSubstrings.join(', ')

    var exportButton = document.createElement('div');
    exportButton.style.position = 'absolute';
    exportButton.style.top = '10px';
    exportButton.style.left = '220px';
    exportButton.style.width = '50px';
    exportButton.style.height = '50px';
    exportButton.style.background = '#d3d3d3';
    exportButton.style.cursor = 'pointer';
    exportButton.style.zIndex = '9999';
    exportButton.style.borderRadius = '10px';

    var buttonText = document.createElement('span');
    buttonText.textContent = '▼';
    buttonText.style.fontSize = '15px';
    buttonText.style.color = '#272727';
    buttonText.style.display = 'flex';
    buttonText.style.alignItems = 'center';
    buttonText.style.justifyContent = 'center';
    buttonText.style.height = '100%';
    buttonText.style.width = '100%';

    exportButton.appendChild(buttonText);
    containerDiv.appendChild(label);
    containerDiv.appendChild(inputBox);
    containerDiv.appendChild(exportButton);

    document.body.appendChild(containerDiv);

    exportButton.addEventListener('click', function () {
        substringsToSearch = inputBox.value.split(',').map(substring => substring.trim()).filter(Boolean);
        extractAndCopyUrls();
    });
})();
