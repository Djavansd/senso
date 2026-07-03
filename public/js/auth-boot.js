(function () {
    "use strict";
    document.documentElement.classList.add("senso-auth-loading");
    const style = document.createElement("style");
    style.id = "senso-auth-loading-style";
    style.textContent = "html.senso-auth-loading body{visibility:hidden!important}";
    document.head.appendChild(style);
})();
