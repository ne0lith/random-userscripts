// ==UserScript==
// @name         Instagram CDN URL Extractor and File Downloader via StorySaver
// @namespace    your-namespace
// @version      5.0
// @author       ne0liberal
// @description  Extracts CDN URLs from Instagram and saves files with the username as a prefix
// @match        https://www.storysaver.net/*
// @updateURL    https://github.com/ne0lith/random-userscripts/raw/main/storysaver-enhancer.user.js
// @downloadURL  https://github.com/ne0lith/random-userscripts/raw/main/storysaver-enhancer.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      scontent-ams2-1.cdninstagram.com
// @connect      scontent-fra3-1.cdninstagram.com
// @connect      scontent-fra3-2.cdninstagram.com
// @connect      scontent-fra5-1.cdninstagram.com
// @connect      scontent-gru2-2.cdninstagram.com
// @connect      scontent-mrs2-2.cdninstagram.com
// @connect      scontent-mia3-2.cdninstagram.com
// ==/UserScript==

(function () {
    'use strict';

    function saveFile(url, filename) {
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            responseType: "blob",
            onload: function (response) {
                var a = document.createElement("a");
                a.href = window.URL.createObjectURL(response.response);
                a.download = filename;
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        });
    }

    function extractAndSaveFiles() {
        var cdnUrls = new Set();
        var username = '';

        // Extract CDN URLs with _nc_ht= query param
        var links = document.getElementsByTagName("a");
        for (var i = 0; i < links.length; i++) {
            var link = links[i].href;
            if (link.includes("&_nc_ht=")) {
                cdnUrls.add(link);
            }
        }

        // Extract username
        var usernameElement = document.querySelector("a[href='#show'] p");
        if (usernameElement) {
            username = usernameElement.innerText.trim().toLowerCase();
        }

        // Extract story count
        var storyCount = 0;
        var storyCountElement = document.querySelector("div.storycount");
        if (storyCountElement) {
            var storyCountText = storyCountElement.innerText.trim();
            storyCount = parseInt(storyCountText.split(" ")[0]);
        }

        // Save each file with the username as prefix
        var delay = 150; // Delay in milliseconds
        var index = 0;
        var downloadedFilenames = new Set(); // Track downloaded filenames

        // Load download history from localStorage
        // MAJOR ISSUE WITH USING HISTORY TO TRACK DOWNLOADED FILES
        // IF YOU DIDNT HAVE THE CDN URL IN YOUR @CONNECT TAGS, IT WILL NOT DOWNLOAD
        // BUT STILL MARK IT AS DOWNLOADED IN THE HISTORY
        // so to try try the download, just append X to the downloadHistoryStorySaver getItem key
        // so it will use a new history
        var downloadHistoryStorySaver = JSON.parse(localStorage.getItem("downloadHistoryStorySaver")) || {};


        var from_domains = new Set();
        cdnUrls.forEach(function (url) {
            var domain = url.split("/")[2];
            from_domains.add(domain);
        });

        from_domains.forEach(function (domain) {
            console.log("Downloading from:", domain);
        });
        console.log("Username:", username);
        console.log("Downloading:", storyCount, "files");
        console.log("If you are seeing console errors after this,");
        console.log("be sure to add these domains to the @connect tag in this userscript, and the User domain whitelist.");

        cdnUrls.forEach(function (url) {
            var filename = url.split("/").pop().split("?")[0];
            filename = username + "-" + filename;

            if (!downloadedFilenames.has(filename) && !downloadHistoryStorySaver[filename]) {
                setTimeout(function () {
                    saveFile(url, filename);

                    // Update download history
                    downloadHistoryStorySaver[filename] = true;
                    localStorage.setItem("downloadHistoryStorySaver", JSON.stringify(downloadHistoryStorySaver));

                    console.log("Downloaded:", filename); // Log the downloaded filename

                }, delay * index);

                downloadedFilenames.add(filename); // Add filename to the set of downloaded filenames
                index++;
            }
        });
    }

    // Add a box in the top left corner to trigger the extraction and saving
    var box = document.createElement("div");
    box.style.position = "fixed";
    box.style.top = "0";
    box.style.left = "0";
    box.style.width = "100px";
    box.style.height = "100px";
    box.style.background = "blue";
    box.style.zIndex = "9999";
    box.addEventListener("click", extractAndSaveFiles);
    document.body.appendChild(box);

    console.log("Script loaded"); // Log that the script has loaded

})();
