(function (global) {
    "use strict";

    const DEFAULT_PLAN = Object.freeze({
        plano: "basico",
        status: "ativo",
        validade: null,
        tipoPagamento: "mensal"
    });

    const state = {
        ready: false,
        loading: false,
        uid: null,
        error: null,
        loadPromise: null,
        unsubscribe: null,
        data: { ...DEFAULT_PLAN }
    };

    function hasFirestore() {
        return !!(global.firebase && global.firebase.firestore);
    }

    function getUid() {
        if (global.SensoAuth?.uid) return global.SensoAuth.uid;

        try {
            return global.firebase?.auth?.()?.currentUser?.uid || null;
        } catch (_err) {
            return null;
        }
    }

    function normalizePlan(input) {
        const data = input && typeof input === "object" ? input : {};
        const plano = data.plano === "pro" ? "pro" : "basico";
        const status = data.status === "bloqueado" ? "bloqueado" : "ativo";
        const tipoPagamento = data.tipoPagamento === "avista" ? "avista" : "mensal";

        return {
            plano,
            status,
            validade: data.validade ?? null,
            tipoPagamento
        };
    }

    function setState(uid, data, error) {
        state.ready = true;
        state.loading = false;
        state.uid = uid || null;
        state.error = error || null;
        state.loadPromise = null;
        state.data = normalizePlan(data);

        global.dispatchEvent(new CustomEvent("senso-plan-ready", {
            detail: {
                uid: state.uid,
                plan: { ...state.data }
            }
        }));
    }

    async function ensureUserPlan(uid) {
        if (!uid || !hasFirestore()) {
            setState(uid, DEFAULT_PLAN);
            return state.data;
        }

        if (state.loading && state.uid === uid && state.loadPromise) {
            return state.loadPromise;
        }

        state.loading = true;
        state.uid = uid;

        const docRef = global.firebase.firestore().collection("users").doc(uid);
        startPlanListener(uid, docRef);

        state.loadPromise = docRef.get()
            .then(snapshot => {
                const current = snapshot.exists ? (snapshot.data() || {}) : {};
                setState(uid, { ...DEFAULT_PLAN, ...current });
                return state.data;
            })
            .catch(err => {
                console.warn("Nao foi possivel carregar o plano do usuario.", err);
                setState(uid, DEFAULT_PLAN, err);
                return state.data;
            });

        return state.loadPromise;
    }

    function startPlanListener(uid, docRef) {
        if (state.unsubscribe && state.uid === uid) return;

        if (state.unsubscribe) {
            state.unsubscribe();
            state.unsubscribe = null;
        }

        state.unsubscribe = docRef.onSnapshot(snapshot => {
            const current = snapshot.exists ? (snapshot.data() || {}) : {};
            setState(uid, { ...DEFAULT_PLAN, ...current });
        }, err => {
            console.warn("Nao foi possivel acompanhar o plano em tempo real.", err);
        });
    }

    function canUse(featureName) {
        if (state.data.status === "bloqueado") return false;

        const proFeatures = global.SENSO_PRO_FEATURES || [];
        if (proFeatures.includes(featureName)) {
            return state.data.plano === "pro";
        }

        return true;
    }

    global.SensoPlans = {
        defaults: DEFAULT_PLAN,
        state,
        ensureUserPlan,
        getCurrentPlan: () => ({ ...state.data }),
        isBasic: () => state.data.plano === "basico",
        isPro: () => state.data.plano === "pro",
        isActive: () => state.data.status === "ativo",
        isBlocked: () => state.data.status === "bloqueado",
        canUse
    };

    global.addEventListener("senso-auth-ready", event => {
        ensureUserPlan(event?.detail?.uid || getUid());
    });

    const initialUid = getUid();
    if (initialUid) {
        ensureUserPlan(initialUid);
    }
})(window);
