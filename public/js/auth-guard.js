(function () {
    "use strict";

    const LOGIN_PATH = "/pages/login.html";
    const LOGIN_REGEX = /\/pages\/login\.html$/i;
    const LAST_UID_KEY = "senso:lastAuthUid";

    function isLoginPage() {
        return LOGIN_REGEX.test(window.location.pathname);
    }

    function buildNextPath() {
        return window.location.pathname + window.location.search + window.location.hash;
    }

    function redirectToLogin() {
        if (isLoginPage()) return;
        const next = encodeURIComponent(buildNextPath());
        window.location.replace(`${LOGIN_PATH}?next=${next}`);
    }

    function hasFirebaseConfig() {
        const cfg = window.SENSO_FIREBASE_CONFIG;
        return !!(
            window.firebase &&
            cfg &&
            cfg.apiKey &&
            cfg.projectId &&
            !cfg.apiKey.startsWith("COLOQUE_")
        );
    }

    function inferUserName(user) {
        const displayName = String(user?.displayName || "").trim();
        if (displayName) return displayName;

        const email = String(user?.email || "").trim();
        if (email.includes("@")) {
            return email.split("@")[0];
        }

        return "";
    }

    function syncUserIdentity(user) {
        if (!user?.uid || !window.firebase?.firestore) return Promise.resolve(null);

        const nome = inferUserName(user);
        const payload = {
            uid: user.uid,
            email: String(user.email || ""),
            nome,
            updatedAt: new Date().toISOString()
        };

        const userRef = window.firebase
            .firestore()
            .collection("users")
            .doc(user.uid);

        return userRef
            .get()
            .then(snapshot => {
                if (!snapshot.exists) {
                    return userRef
                        .set({
                            ...payload,
                            autorizado: false
                        })
                        .then(() => ({ ...payload, autorizado: false }));
                }

                return userRef
                    .set(payload, { merge: true })
                    .then(() => ({
                        ...snapshot.data(),
                        ...payload
                    }));
            })
            .catch(() => {
                // Evita quebrar fluxo de auth por erro de sincronizacao.
                return null;
            });
    }

    function redirectToPendingAccess() {
        if (isLoginPage()) return;
        window.location.replace(`${LOGIN_PATH}?access=pending`);
    }

    window.SensoAuth = window.SensoAuth || {
        ready: false,
        user: null,
        uid: null
    };

    if (!hasFirebaseConfig()) {
        console.warn("Firebase nao configurado. Preencha public/js/firebase-config.js.");
        if (!isLoginPage()) redirectToLogin();
        return;
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(window.SENSO_FIREBASE_CONFIG);
    }

    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {
        // Se falhar, o fluxo continua com a persistencia padrao.
    });

    firebase.auth().onAuthStateChanged(user => {
        window.SensoAuth.ready = true;
        window.SensoAuth.user = user || null;
        window.SensoAuth.uid = user ? user.uid : null;

        if (!user) {
            try {
                localStorage.removeItem(LAST_UID_KEY);
            } catch (_err) {
                // Ignora erro de storage.
            }
            redirectToLogin();
            return;
        }

        try {
            localStorage.setItem(LAST_UID_KEY, user.uid);
        } catch (_err) {
            // Ignora erro de storage.
        }

        syncUserIdentity(user).then(userData => {
            if (userData?.autorizado === false) {
                firebase.auth().signOut().finally(redirectToPendingAccess);
                return;
            }

            if (isLoginPage()) {
                const params = new URLSearchParams(window.location.search);
                const next = params.get("next");
                const safeNext = next && next.startsWith("/") ? next : "/index.html";
                window.location.replace(safeNext);
                return;
            }

            window.dispatchEvent(new CustomEvent("senso-auth-ready", { detail: { uid: user.uid } }));
        });
    });

    window.sensoRequireAuth = function () {
        const user = firebase.auth().currentUser;
        if (user) return user;
        redirectToLogin();
        return null;
    };

    window.sensoSignOut = function () {
        return firebase.auth().signOut();
    };
})();
