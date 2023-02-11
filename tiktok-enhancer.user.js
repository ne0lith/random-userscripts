// ==UserScript==
// @name        TikTok Profile Enhancer
// @namespace   https://www.tiktok.com/
// @include     https://www.tiktok.com/@*
// @author ne0liberal
// @updateURL https://github.com/n30liberal/random-userscripts/raw/main/tiktok-enhancer.user.js
// @downloadURL https://github.com/n30liberal/random-userscripts/raw/main/tiktok-enhancer.user.js
// @version     1.0.5
// @grant       none
// ==/UserScript==

// USAGE:
// 1. Open a TikTok profile.
// 2. To prevent slow scrolling to the bottom, avoid scrolling down the page.
// If you have already scrolled, refresh the page.
// This is due to a bug in the jumpToBottom function.
// The reason for this bug is still unknown, but it may be related to the occasional upward jiggle required for TikTok to load more videos.
// 3. Start the script by pressing "Ctrl + Alt + A".
// - To stop the script, simply press "Alt + A". The links that were loaded prior to stopping the script will be copied.
// 4. Wait for the script to complete its operation.

javascript: (function () {
    function main() {

        const sleepTimeout = 750;
        let shouldStop = false;

        document.addEventListener("keydown", (event) => {
            if (event.code === "KeyA" && event.altKey) {
                shouldStop = true;
            }
        });

        function notify(message, username) {
            const h2 = document.querySelector('h2[data-e2e="user-title"]');
            const h1 = document.querySelector('h1[data-e2e="user-subtitle"]');
            h2.innerHTML = message;
            h1.innerHTML = `from @${username}.`;
        }

        function filterLinks(tiktokUsername) {
            const linkFilter = `${tiktokUsername}/video`;
            const links = Array.from(document.querySelectorAll('a'));
            return links.reduce((foundLinks, link) => {
                if (link.href.includes(linkFilter)) {
                    foundLinks.push(link.href);
                }
                if (link === links[links.length - 1]) {
                    foundLinks.push("");
                }
                return foundLinks;
            }, []);
        }

        function linksToClipboard(tiktokUsername) {
            const foundLinks = filterLinks(tiktokUsername);
            navigator.clipboard.writeText(foundLinks.join("\n"));
            window.scrollTo(0, 0);
            notify(`${foundLinks.length - 1} links copied`, tiktokUsername);
        }

        function jumpToBottom(tiktokUsername) {
            window.scrollTo(0, document.body.scrollHeight);
            let intervalCount = 0;
            const intervalId = setInterval(function () {
                if (shouldStop) {
                    clearInterval(intervalId);
                    linksToClipboard(tiktokUsername);
                    return;
                }
                const currentScrollHeight = document.body.scrollHeight;
                window.scrollTo(0, currentScrollHeight);
                if (intervalCount % 500 === 0) {
                    window.scrollTo(0, window.scrollY - 5);
                }
                if (window.innerHeight + window.scrollY >= currentScrollHeight) {
                    setTimeout(function () {
                        const updatedScrollHeight = document.body.scrollHeight;
                        if (currentScrollHeight === updatedScrollHeight) {
                            setTimeout(function () {
                                const doubleCheckScrollHeight = document.body.scrollHeight;
                                if (updatedScrollHeight === doubleCheckScrollHeight) {
                                    clearInterval(intervalId);
                                    linksToClipboard(tiktokUsername);
                                }
                            }, sleepTimeout);
                        }
                    }, sleepTimeout);
                }
                intervalCount++;
            }, 10);
        }

        if (window.location.href.includes("tiktok.com/@")) {
            const tiktokUsername = window.location.href.split("@")[1].split("/")[0].split("?")[0];
            jumpToBottom(tiktokUsername);
        } else {
            alert("This script only works on TikTok profiles.");
        }
    }

    console.log(`TikTok Profile Enhancer loaded. Version: ${GM_info.script.version}`);
    document.addEventListener("keydown", (event) => {
        if (event.code === "KeyA" && event.altKey && event.ctrlKey) {
            main();
        }
    });

})();
