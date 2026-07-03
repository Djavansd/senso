(function (global) {
    "use strict";

    const DEFAULT_PLAN = Object.freeze({
        plano: "gratis",
        status: "ativo",
        validade: null,
        tipoPagamento: "mensal",
        precoContratado: null,
        dataContratacao: null,
        tipoPlano: null
    });
    const PAYMENT_GRACE_DAYS = 5;
    const FREE_LIMITS = Object.freeze({
        clientes: 5,
        orcamentos: 10,
        servicos: Infinity
    });
    const BASIC_MONTHLY_LIMITS = Object.freeze({
        clientes: 50,
        orcamentos: 150,
        servicos: Infinity
    });

    const state = {
        ready: false,
        loading: false,
        uid: null,
        listenerUid: null,
        error: null,
        loadPromise: null,
        unsubscribe: null,
        data: { ...DEFAULT_PLAN }
    };
    let paymentRedirectStarted = false;

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

    function normalizeTipoPagamento(value) {
        const texto = String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, "")
            .toLowerCase();

        return texto === "avista" ? "avista" : "mensal";
    }

    function normalizeText(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/gi, "")
            .toLowerCase();
    }

    function normalizePlanId(data) {
        const candidates = [
            data.plano,
            data.plan,
            data.tipoPlano,
            data.nomePlano,
            data.subscriptionPlan
        ].map(normalizeText).filter(Boolean);

        const hasPaidPlan = candidates.some(value => (
                ["pro", "premium", "profissional", "professional", "pago", "paid", "ativo"].includes(value)
                || value.includes("premium")
                || value === "planopro"
        ));

        if (
            hasPaidPlan
            || data.pro === true
            || data.premium === true
            || data.assinaturaAtiva === true
        ) {
            return "pro";
        }

        if (candidates.some(value => ["basico", "basic", "starter"].includes(value))) {
            return "basico";
        }

        return "gratis";
    }

    function normalizePlan(input) {
        const data = input && typeof input === "object" ? input : {};
        const plano = normalizePlanId(data);
        const status = data.status === "bloqueado" ? "bloqueado" : "ativo";
        const tipoPagamento = normalizeTipoPagamento(data.tipoPagamento);

        return {
            plano,
            status,
            validade: data.validade ?? null,
            tipoPagamento,
            precoContratado: data.precoContratado ?? null,
            dataContratacao: data.dataContratacao ?? null,
            tipoPlano: data.tipoPlano ?? null
        };
    }

    function normalizeDate(value) {
        if (!value) return null;

        let date;
        if (typeof value?.toDate === "function") {
            date = value.toDate();
        } else if (value instanceof Date) {
            date = new Date(value);
        } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            date = new Date(`${value}T00:00:00`);
        } else {
            date = new Date(value);
        }

        if (Number.isNaN(date.getTime())) return null;
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function getToday() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
    }

    function getDaysDiff(fromDate, toDate) {
        return Math.round((toDate - fromDate) / 86400000);
    }

    function getPaymentStatus(plan) {
        const current = normalizePlan(plan || state.data);
        const dueDate = normalizeDate(current.validade);
        const today = getToday();
        const isMonthlyPlan = current.tipoPagamento === "mensal" && (
            current.plano === "basico" ||
            current.plano === "pro"
        );

        if (!isMonthlyPlan || !dueDate) {
            return {
                applies: false,
                dueDate,
                daysUntilDue: null,
                daysOverdue: 0,
                shouldWarn: false,
                shouldBlock: current.status === "bloqueado",
                isAutoBlocked: false
            };
        }

        const daysUntilDue = getDaysDiff(today, dueDate);
        const daysOverdue = Math.max(0, getDaysDiff(dueDate, today));
        const isAutoBlocked = daysOverdue > PAYMENT_GRACE_DAYS;

        return {
            applies: true,
            dueDate,
            daysUntilDue,
            daysOverdue,
            shouldWarn: daysUntilDue <= 3 || daysOverdue > 0,
            shouldBlock: current.status === "bloqueado" || isAutoBlocked,
            isAutoBlocked
        };
    }

    function getPaymentPagePath() {
        return "/pages/pagamento-app.html";
    }

    function isPaymentPage() {
        const path = global.location.pathname
            .replace(/\\/g, "/")
            .replace(/\/+$/, "")
            .toLowerCase();

        return path.endsWith("/pages/pagamento-app.html")
            || path.endsWith("/pagamento-app.html")
            || path.endsWith("/pagamento-app")
            || path.includes("/pages/pagamento-app");
    }

    function enforcePaymentAccess(plan) {
        const paymentStatus = getPaymentStatus(plan);
        if (!paymentStatus.shouldBlock || isPaymentPage() || paymentRedirectStarted) return;

        const targetPath = getPaymentPagePath();
        const currentPath = global.location.pathname.replace(/\\/g, "/").toLowerCase();
        if (currentPath === targetPath.toLowerCase()) return;

        paymentRedirectStarted = true;
        global.location.replace(`${targetPath}?blocked=payment`);
    }

    function setState(uid, data, error) {
        state.ready = true;
        state.loading = false;
        state.uid = uid || null;
        state.error = error || null;
        state.loadPromise = null;
        state.data = normalizePlan(data);
        const paymentStatus = getPaymentStatus(state.data);

        global.dispatchEvent(new CustomEvent("senso-plan-ready", {
            detail: {
                uid: state.uid,
                plan: { ...state.data },
                paymentStatus
            }
        }));
        enforcePaymentAccess(state.data);
    }

    function setLoadError(uid, error) {
        state.ready = false;
        state.loading = false;
        state.uid = uid || null;
        state.error = error || new Error("Plano nao confirmado no Firebase.");
        state.loadPromise = null;
        state.data = { ...DEFAULT_PLAN };

        global.dispatchEvent(new CustomEvent("senso-plan-error", {
            detail: { uid: state.uid, error: state.error }
        }));
    }

    async function ensureUserPlan(uid) {
        if (!uid || !hasFirestore()) {
            setLoadError(uid, new Error("Firebase indisponivel para confirmar o plano."));
            return state.data;
        }

        if (state.loading && state.uid === uid && state.loadPromise) {
            return state.loadPromise;
        }

        state.loading = true;
        state.ready = false;
        state.uid = uid;
        state.error = null;
        state.data = { ...DEFAULT_PLAN };

        const docRef = global.firebase.firestore().collection("users").doc(uid);
        const authenticatedProfile = global.SensoAuth?.uid === uid
            ? global.SensoAuth?.profile
            : null;
        if (authenticatedProfile && typeof authenticatedProfile === "object") {
            setState(uid, { ...DEFAULT_PLAN, ...authenticatedProfile });
            startPlanListener(uid, docRef);
            state.loadPromise = Promise.resolve(state.data);
            return state.loadPromise;
        }

        startPlanListener(uid, docRef);

        state.loadPromise = docRef.get({ source: "server" })
            .then(snapshot => {
                const current = snapshot.exists ? (snapshot.data() || {}) : {};
                setState(uid, { ...DEFAULT_PLAN, ...current });
                return state.data;
            })
            .catch(err => {
                console.warn("Nao foi possivel carregar o plano do usuario.", err);
                setLoadError(uid, err);
                return state.data;
            });

        return state.loadPromise;
    }

    function startPlanListener(uid, docRef) {
        if (state.unsubscribe && state.listenerUid === uid) return;

        if (state.unsubscribe) {
            state.unsubscribe();
            state.unsubscribe = null;
        }

        state.listenerUid = uid;

        state.unsubscribe = docRef.onSnapshot(snapshot => {
            if (state.uid !== uid || state.loading) return;
            if (!state.ready && snapshot.metadata?.fromCache !== false) return;
            const current = snapshot.exists ? (snapshot.data() || {}) : {};
            setState(uid, { ...DEFAULT_PLAN, ...current });
        }, err => {
            console.warn("Nao foi possivel acompanhar o plano em tempo real.", err);
        });
    }

    function canUse(featureName) {
        if (state.data.status === "bloqueado" || getPaymentStatus(state.data).shouldBlock) return false;

        const proFeatures = global.SENSO_PRO_FEATURES || [];
        if (proFeatures.includes(featureName)) {
            return state.data.plano === "pro";
        }

        return true;
    }

    function isBasicMonthly(plan) {
        const current = normalizePlan(plan || state.data);
        return current.plano === "basico" && current.tipoPagamento === "mensal";
    }

    function isFree(plan) {
        const current = normalizePlan(plan || state.data);
        return current.plano === "gratis";
    }

    function getUsageLimits(plan) {
        if (!plan && (!state.ready || state.loading || state.error)) {
            return {
                clientes: Infinity,
                orcamentos: Infinity,
                servicos: Infinity
            };
        }

        if (isFree(plan)) {
            return { ...FREE_LIMITS };
        }

        if (!isBasicMonthly(plan)) {
            return {
                clientes: Infinity,
                orcamentos: Infinity,
                servicos: Infinity
            };
        }

        return { ...BASIC_MONTHLY_LIMITS };
    }

    global.SensoPlans = {
        defaults: DEFAULT_PLAN,
        freeLimits: FREE_LIMITS,
        basicMonthlyLimits: BASIC_MONTHLY_LIMITS,
        paymentGraceDays: PAYMENT_GRACE_DAYS,
        state,
        ensureUserPlan,
        getCurrentPlan: () => ({ ...state.data }),
        isReady: () => state.ready && !state.loading && !state.error,
        getPaymentStatus,
        isFree: () => state.data.plano === "gratis",
        isBasic: () => state.data.plano === "basico",
        isPro: () => state.data.plano === "pro",
        isBasicMonthly,
        isFreePlan: isFree,
        getUsageLimits,
        isActive: () => state.data.status === "ativo" && !getPaymentStatus(state.data).shouldBlock,
        isBlocked: () => state.data.status === "bloqueado" || getPaymentStatus(state.data).shouldBlock,
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
