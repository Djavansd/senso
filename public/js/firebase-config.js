window.SENSO_FIREBASE_CONFIG = {
    apiKey: "AIzaSyC0mWMJxacOrI5AMH2CJo9lUuK8QkhcYlk",
    authDomain: "senso-6d92a.firebaseapp.com",
    projectId: "senso-6d92a",
    storageBucket: "senso-6d92a.firebasestorage.app",
    messagingSenderId: "1010700673179",
    appId: "1:1010700673179:web:44350a3381a55cbda2a63e"
};

window.SENSO_APP_CHECK_SITE_KEY = "6LfYWkItAAAAAHfxjyeo-xzwm9CGcjIDypaTAItG";

(function configureLocalFirebase(global) {
    "use strict";

    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    const isLocal = localHosts.has(global.location?.hostname || "");
    global.SENSO_USING_FIREBASE_EMULATORS = isLocal;

    const connected = { auth: false, firestore: false, functions: false };
    let appCheckActivated = false;

    global.sensoActivateAppCheck = function () {
        if (isLocal || appCheckActivated || !global.firebase?.apps?.length || typeof global.firebase.appCheck !== "function") {
            return false;
        }

        const siteKey = String(global.SENSO_APP_CHECK_SITE_KEY || "").trim();
        if (!siteKey) return false;

        try {
            global.firebase.appCheck().activate(
                new global.firebase.appCheck.ReCaptchaEnterpriseProvider(siteKey),
                true
            );
            appCheckActivated = true;
            return true;
        } catch (error) {
            console.error("Não foi possível ativar a proteção App Check.", error);
            return false;
        }
    };

    global.sensoConnectFirebaseEmulators = function () {
        if (!isLocal || !global.firebase?.apps?.length) return false;

        try {
            if (!connected.auth && typeof global.firebase.auth === "function") {
                global.firebase.auth().useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
                connected.auth = true;
            }
        } catch (error) {
            if (error?.code !== "auth/emulator-config-failed") console.warn("Auth Emulator não conectado.", error);
        }

        try {
            if (!connected.firestore && typeof global.firebase.firestore === "function") {
                global.firebase.firestore().useEmulator("127.0.0.1", 8080);
                connected.firestore = true;
            }
        } catch (error) {
            if (error?.code !== "failed-precondition") console.warn("Firestore Emulator não conectado.", error);
        }

        try {
            if (!connected.functions && typeof global.firebase.functions === "function") {
                global.firebase.functions("southamerica-east1").useEmulator("127.0.0.1", 5001);
                connected.functions = true;
            }
        } catch (error) {
            console.warn("Functions Emulator não conectado.", error);
        }

        return connected.auth || connected.firestore || connected.functions;
    };

    if (isLocal && global.SENSO_SHOW_EMULATOR_BADGE === true) {
        const showBadge = () => {
            if (document.getElementById("senso-emulator-badge")) return;
            const badge = document.createElement("div");
            badge.id = "senso-emulator-badge";
            badge.textContent = "MODO TESTE LOCAL • Firebase Emulator";
            badge.style.cssText = "position:fixed;z-index:2147483647;left:50%;bottom:10px;transform:translateX(-50%);padding:7px 12px;border-radius:999px;background:#7c2d12;color:#fff;font:700 11px/1.2 Arial,sans-serif;box-shadow:0 5px 15px #0004;pointer-events:none";
            document.body.appendChild(badge);
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBadge, { once: true });
        else showBadge();
    }
})(window);
