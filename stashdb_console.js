var SAVE_BUTTON_TEXT = "Save";
var SKIP_TEXT = "Skip";
var DURATION_REGEX = /Duration matches (\d+)\/(\d+) fingerprints/;
var CONTAINER_SELECTOR = ".mt-3.search-item";
var BUTTON_SELECTOR = CONTAINER_SELECTOR + " button.btn.btn-primary";
var PARENT_DIV_SELECTOR = CONTAINER_SELECTOR;

function shouldClickButton(button, parentDiv) {
    // our criteria are as follows:
    // the scene must not have a skip/create button for performers/studios/etc
    // and the duration fingerprint matches must be 100%
    // if all that is true, then we click the save button!
    // eventually i want to have a toggle if the duration match fingerprint
    // is within 95-100% instead of strictly 100%
    // alot of content is about right at that range anyway, ime.
    var isSkip = parentDiv.innerText.includes(SKIP_TEXT);
    var durationMatches = parentDiv.innerText.match(DURATION_REGEX);
    var isDurationMatch = durationMatches !== null && durationMatches[1] === durationMatches[2];
    return button.innerText === SAVE_BUTTON_TEXT && isDurationMatch && !isSkip;
}

function countButtons() {
    var saveButtons = document.querySelectorAll(BUTTON_SELECTOR);
    var count = 0;
    saveButtons.forEach(function (button, index) {
        var parentDiv = button.closest(PARENT_DIV_SELECTOR);
        if (shouldClickButton(button, parentDiv)) {
            count++;
        }
    });
    return count;
}

function clickButtons() {
    var buttonsClicked = 0;
    var saveButtons = document.querySelectorAll(BUTTON_SELECTOR);
    saveButtons.forEach(function (button, index) {
        var parentDiv = button.closest(PARENT_DIV_SELECTOR);
        if (shouldClickButton(button, parentDiv)) {
            setTimeout(function () {
                var href = parentDiv.querySelector('a').getAttribute('href');
                var sceneNumber = href.match(/\/scenes\/(\d+)/)[1];
                console.log("Updating Scene: " + sceneNumber);
                button.click();
                buttonsClicked++;
            }, buttonsClicked * 150);
        }
    });
}

var numButtons = countButtons();
if (numButtons > 0) {
    console.log("Found " + numButtons + " scenes to update.");
    clickButtons();
} else {
    console.log("No scenes to update that match our criteria.");
}
