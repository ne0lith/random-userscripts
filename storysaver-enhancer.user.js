// ==UserScript==
// @name         Instagram CDN URL Extractor and File Downloader via StorySaver
// @namespace    your-namespace
// @version      3.3
// @author       ne0liberal
// @description  Extracts CDN URLs from Instagram and saves files with the username as a prefix
// @match        https://www.storysaver.net/*
// @updateURL    https://github.com/n30liberal/random-userscripts/raw/main/storysaver-enhancer.user.js
// @downloadURL  https://github.com/n30liberal/random-userscripts/raw/main/storysaver-enhancer.user.js
// @grant        GM_xmlhttpRequest
// @connect      cdninstagram.com fbcdn.net instagram.frao1-1.fna.fbcdn.net fna.fbcdn.net scontent-mrs2-2.cdninstagram.com
// ==/UserScript==

(function() {
    'use strict';

    function saveFile(url, filename) {
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            responseType: "blob",
            onload: function(response) {
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

        // Extract CDN URLs with _nc_ht query param
        var links = document.getElementsByTagName("a");
        for (var i = 0; i < links.length; i++) {
            var link = links[i].href;
            if ((link.includes("cdninstagram.com") || link.includes("fbcdn.net")) && link.includes("&_nc_ht")) {
                cdnUrls.add(link);
            }
        }

        // Extract username
        var usernameElement = document.querySelector("a[href='#show'] p");
        if (usernameElement) {
            username = usernameElement.innerText.trim().toLowerCase();
        }

        // Save each file with the username as prefix
        var delay = 250; // Delay in milliseconds
        var index = 0;
        var downloadedFilenames = new Set(); // Track downloaded filenames

        // Load download history from localStorage
        var downloadHistoryStorySaver = JSON.parse(localStorage.getItem("downloadHistoryStorySaver")) || {};



        var from_domains = new Set();
        cdnUrls.forEach(function(url) {
            var domain = url.split("/")[2];
            from_domains.add(domain);
        });

        from_domains.forEach(function(domain) {
            console.log("Downloading from: ", domain);
        });
        console.log("Username: ", username);
        console.log("Downloading: ", cdnUrls.size, " files");
        console.log("Be sure to whitelist or add to @connect these domains in tampermonkey, or the script will not work!");

        cdnUrls.forEach(function(url) {
            var filename = url.split("/").pop().split("?")[0];
            filename = username + "-" + filename;

            // Check if the file has already been downloaded
            if (!downloadedFilenames.has(filename) && !downloadHistoryStorySaver[filename]) {
                setTimeout(function() {
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
