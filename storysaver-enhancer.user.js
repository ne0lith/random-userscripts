// ==UserScript==
// @name         Instagram CDN URL Extractor and File Downloader via StorySaver
// @namespace    your-namespace
// @version      1.8
// @author ne0liberal
// @description  Extracts CDN URLs from Instagram and saves files with the username as a prefix
// @match        https://www.storysaver.net/*
// @updateURL https://github.com/n30liberal/random-userscripts/raw/main/storysaver-enhancer.user.js
// @downloadURL https://github.com/n30liberal/random-userscripts/raw/main/storysaver-enhancer.user.js
// @grant        GM_xmlhttpRequest
// @connect cdninstagram.com
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
            if (link.includes("cdninstagram.com") && link.includes("&_nc_ht=")) {
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
        var downloadHistory = JSON.parse(localStorage.getItem("downloadHistory")) || {};

        cdnUrls.forEach(function(url) {
            var filename = url.split("/").pop().split("?")[0];
            filename = username + "-" + filename;

            // Check if the file has already been downloaded
            if (!downloadedFilenames.has(filename) && !downloadHistory[filename]) {
                setTimeout(function() {
                    saveFile(url, filename);

                    // Update download history
                    downloadHistory[filename] = true;
                    localStorage.setItem("downloadHistory", JSON.stringify(downloadHistory));

                    // Check if all downloads are finished
                    if (downloadedFilenames.size === cdnUrls.size - 1) {
                        var totalDownloads = cdnUrls.size - 1;
                        var message = "Downloads Finished (" + totalDownloads + "/" + totalDownloads + ")";
                        alert(message);
                    }
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
    box.style.background = "red";
    box.style.zIndex = "9999";
    box.addEventListener("click", extractAndSaveFiles);
    document.body.appendChild(box);
})();
