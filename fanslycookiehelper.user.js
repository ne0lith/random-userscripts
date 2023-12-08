// ==UserScript==
// @name        Fansly Cookie Helper
// @namespace   https://fansly.com
// @include     https://fansly.com/*
// @namespace https://github.com/ne0lith/random-userscripts/
// @updateURL https://github.com/ne0lith/random-userscripts/raw/main/fanslycookiehelper.user.js
// @downloadURL https://github.com/ne0lith/random-userscripts/raw/main/fanslycookiehelper.user.js
// @version     1.0
// @grant       none
// ==/UserScript==

const config = {
    auth: {
        email: "your_email",
        password: "your_password",
    }
};

function copyDict() {
    const token = JSON.parse(localStorage.session_active_session).token;
    const userAgent = navigator.userAgent;

    const dict = {
        auth: Object.assign({
            username: "default",
            authorization: token,
            user_agent: userAgent,
            hashed: false,
            support_2fa: false,
            active: true,
        }, config.auth)
    };

    navigator.clipboard.writeText(JSON.stringify(dict, null, 2));
}

// this is creating a really ugly button at 0,0 on the page. (top left corner)
const button = document.createElement("button");
button.textContent = "Copy Credentials";
button.style.position = "absolute";
button.style.top = "0";
button.style.left = "0";
button.style.display = "block";
button.style.zIndex = "9999";
button.addEventListener("click", copyDict);
document.body.appendChild(button);
