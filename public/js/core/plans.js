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
        servicos: 10
    });
    const BASIC_MONTHLY_LIMITS = Object.freeze({
        clientes: 50,
        servicos: 150
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

    function normalizePlan(input) {
        const data = input && typeof input === "object" ? input : {};
        const plano = data.plano === "pro"
            ? "pro"
            : data.plano === "basico"
                ? "basico"
                : "gratis";
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

        state.loadPromise = docRef.get({ source: "server" })
            .catch(() => docRef.get())
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
        if (isFree(plan)) {
            return { ...FREE_LIMITS };
        }

        if (!isBasicMonthly(plan)) {
            return {
                clientes: Infinity,
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
