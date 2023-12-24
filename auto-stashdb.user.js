// ==UserScript==
// @name         AutoStashDB
// @version      1.4.2
// @description  AutoStashDB Scene(s)
// @author       You
// @match        http://localhost:9999/*
// @grant        none
// @updateURL    https://github.com/ne0lith/random-userscripts/raw/main/auto-stashdb.user.js
// @downloadURL  https://github.com/ne0lith/random-userscripts/raw/main/auto-stashdb.user.js
// ==/UserScript==

(function() {
    'use strict';

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function automateStashDB() {
        // Click the "Edit" button
        document.querySelector('a[data-rb-event-key="scene-edit-panel"]').click();
        console.log("Clicking Edit")
        await sleep(500); // BRIEF sleep

        // Press the "Scrape with..." button
        document.getElementById('scene-scrape').click();
        console.log("Clicking Scrape With")
        await sleep(500); // BRIEF sleep

        // Click on the dropdown option with the text "stashdb.org"
        var dropdownOptions = document.querySelectorAll('.dropdown-menu.show a.dropdown-item');
        for (var option of dropdownOptions) {
            if (option.textContent.trim() === 'stashdb.org') {
                option.click();
                console.log("Clicking StashDB")
                break;
            }
        }
        await sleep(2500); // Longer sleep for external server

        // Find and select all + tags (studios, performers, tags, etc)
        var plusButtons = document.querySelectorAll('button.minimal.ml-2.btn.btn-primary svg[data-prefix="fas"][data-icon="plus"]');
        if (plusButtons.length > 0) {
            try {
                const totalButtons = plusButtons.length;
                console.log(`Total new entries found: ${totalButtons}`);
                await Promise.all(Array.from(plusButtons).map(async (button, index) => {
                    try {
                        button.closest('button').click();
                        console.log("Clicking + Button");
                        if (index < totalButtons - 1) {
                            await sleep(2000); // For all buttons except the last one, use the standard sleep
                        } else {
                            console.log("Waiting a bit longer for the last tag")
                            await sleep(5000); // For the last button, add an extra sleep
                        }
                    } catch (error) {
                        console.error('Error clicking + button:', error);
                        await sleep(2000); // DECENT sleep, waiting on the server
                    }
                }));
            } catch (error) {
                console.error('Error clicking buttons:', error);
                await sleep(2000); // DECENT sleep, waiting on the server
            }
        }

        // Click the "Apply" button
        document.querySelector('button.ml-2.btn.btn-primary').click();
        console.log("Clicking Apply")
        await sleep(300); // BRIEF sleep

        // Click the "Save" button
        document.querySelector('button.edit-button.btn.btn-primary').click();
        console.log("Clicking Save")
    }

    // TODO:
    // We need to hide anything that may be under this button
    const button = document.createElement('button');
    button.textContent = 'Automate StashDB';
    button.style.position = 'fixed';
    button.style.top = '3px';
    button.style.right = '120px';
    button.style.padding = '10px';
    button.style.backgroundColor = '#394b59';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.cursor = 'pointer';
    button.style.zIndex = '9999';
    button.addEventListener('click', automateStashDB);

    document.body.appendChild(button);
})();
