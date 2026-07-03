(function () {
    "use strict";

    const LOGIN_REGEX = /\/pages\/login(?:\.html)?\/?$/i;
    const PENDING_REGEX = /\/pages\/acesso-pendente(?:\.html)?\/?$/i;
    const ADMIN_REGEX = /\/pages\/gestao-interna-4m8x2(?:\.html)?\/?$/i;
    const SECURITY_REGEX = /\/pages\/seguranca-conta(?:\.html)?\/?$/i;
    const LAST_UID_KEY = "senso:lastAuthUid";

    function isLoginPage() { return LOGIN_REGEX.test(location.pathname); }
    function isPendingPage() { return PENDING_REGEX.test(location.pathname); }
    function isAdminPage() { return ADMIN_REGEX.test(location.pathname); }
    function isSecurityPage() { return SECURITY_REGEX.test(location.pathname); }
    function relativePage(file) { return location.pathname.includes("/pages/") ? file : `pages/${file}`; }

    function redirectToLogin() {
        if (isLoginPage()) return;
        const next = encodeURIComponent(location.pathname + location.search + location.hash);
        location.replace(`${relativePage("login.html")}?next=${next}`);
    }

    function redirectToPending(status) {
        if (isPendingPage()) return;
        location.replace(`${relativePage("acesso-pendente.html")}?status=${encodeURIComponent(status || "aguardando")}`);
    }

    function denyAdminAccess() {
        location.replace(relativePage("../index.html").replace("pages/../", ""));
    }

    function hasFirebaseConfig() {
        const cfg = window.SENSO_FIREBASE_CONFIG;
        return !!(window.firebase && cfg?.apiKey && cfg?.projectId && !cfg.apiKey.startsWith("COLOQUE_"));
    }

    function inferUserName(user) {
        const displayName = String(user?.displayName || "").trim();
        if (displayName) return displayName;
        const email = String(user?.email || "").trim();
        return email.includes("@") ? email.split("@")[0] : "";
    }

    async function syncUserIdentity(user) {
        if (!user?.uid || !firebase.firestore) return null;

        const ref = firebase.firestore().collection("users").doc(user.uid);
        const snapshot = await ref.get({ source: "server" });
        const identity = {
            uid: user.uid,
            email: String(user.email || ""),
            nome: inferUserName(user)
        };

        if (!snapshot.exists) {
            const created = {
                ...identity,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                autorizado: false,
                admin: false,
                status: "aguardando",
                plano: "gratis",
                tipoPagamento: "mensal",
                validade: null,
                dataCadastro: firebase.firestore.FieldValue.serverTimestamp()
            };
            await ref.set(created);
            return { ...created, updatedAt: new Date(), dataCadastro: new Date() };
        }

        const current = snapshot.data() || {};
        const identityChanged = current.uid !== identity.uid
            || current.email !== identity.email
            || current.nome !== identity.nome;
        if (identityChanged) {
            await ref.set({
                ...identity,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
        return { ...current, ...identity };
    }

    function accessStatus(data) {
        if (data?.status === "bloqueado") return "bloqueado";
        if (data?.autorizado === false) return "aguardando";
        return "ativo";
    }

    function exposeAdminNavigation(isAdmin) {
        document.querySelectorAll("[data-senso-admin-link]").forEach(element => {
            element.hidden = !isAdmin;
            element.style.display = isAdmin ? "" : "none";
        });
    }

    function revealAuthorizedPage() {
        document.documentElement.classList.remove("senso-auth-loading");
        document.getElementById("senso-auth-loading-style")?.remove();
    }

    function watchPendingAccess(uid) {
        if (!isPendingPage() || !uid) return;

        firebase.firestore().collection("users").doc(uid).onSnapshot(snapshot => {
            if (!snapshot.exists) return;
            const currentStatus = accessStatus(snapshot.data());

            window.dispatchEvent(new CustomEvent("senso-access-status", {
                detail: { status: currentStatus }
            }));

            if (currentStatus === "ativo") {
                location.replace("../index.html");
            }
        }, error => {
            console.error("Falha ao acompanhar aprovação da conta.", error);
        });
    }

    window.SensoAuth = window.SensoAuth || { ready: false, user: null, uid: null, profile: null, isAdmin: false };

    if (!hasFirebaseConfig()) {
        console.warn("Firebase nao configurado.");
        if (!isLoginPage()) redirectToLogin();
        return;
    }

    if (!firebase.apps.length) firebase.initializeApp(window.SENSO_FIREBASE_CONFIG);
    window.sensoConnectFirebaseEmulators?.();
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

    firebase.auth().onAuthStateChanged(async user => {
        window.SensoAuth.ready = true;
        window.SensoAuth.user = user || null;
        window.SensoAuth.uid = user?.uid || null;
        window.SensoAuth.profile = null;
        window.SensoAuth.isAdmin = false;

        if (!user) {
            try { localStorage.removeItem(LAST_UID_KEY); } catch (_err) {}
            redirectToLogin();
            return;
        }

        try { localStorage.setItem(LAST_UID_KEY, user.uid); } catch (_err) {}

        try {
            const profile = await syncUserIdentity(user);
            const status = accessStatus(profile);
            const isAdmin = profile?.admin === true;
            const mfaEnrolled = (user.multiFactor?.enrolledFactors || []).length > 0;
            const tokenResult = await user.getIdTokenResult();
            const mfaAuthenticated = !!tokenResult.claims?.firebase?.sign_in_second_factor;
            window.SensoAuth.profile = profile;
            window.SensoAuth.isAdmin = isAdmin;
            exposeAdminNavigation(isAdmin);
            watchPendingAccess(user.uid);

            if (status !== "ativo" && !isPendingPage()) {
                redirectToPending(status);
                return;
            }
            if (status === "ativo" && isPendingPage()) {
                location.replace("../index.html");
                return;
            }
            if ((isAdminPage() || isSecurityPage()) && !isAdmin) {
                denyAdminAccess();
                return;
            }
            if (isAdminPage() && (!mfaEnrolled || !mfaAuthenticated)) {
                location.replace("seguranca-conta.html");
                return;
            }
            if (isLoginPage()) {
                const next = new URLSearchParams(location.search).get("next");
                location.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "../index.html");
                return;
            }

            revealAuthorizedPage();

            window.dispatchEvent(new CustomEvent("senso-auth-ready", {
                detail: {
                    uid: user.uid,
                    profile,
                    isAdmin,
                    mfaEnrolled,
                    mfaAuthenticated
                }
            }));
        } catch (error) {
            console.error("Falha ao validar autorizacao no servidor.", error);
            if (!isLoginPage()) redirectToLogin();
        }
    });

    window.sensoRequireAuth = () => firebase.auth().currentUser || (redirectToLogin(), null);
    window.sensoSignOut = () => firebase.auth().signOut();
})();
