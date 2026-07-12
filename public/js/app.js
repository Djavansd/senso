// =========================
// BASE DO APP
// =========================
const ACTIVE_PROFILE = (
    window.SensoProfile &&
    typeof window.SensoProfile.getActiveProfile === "function"
)
    ? window.SensoProfile.getActiveProfile()
    : {
        id: "base",
        appName: "Senso",
        defaults: {}
    };

const ACTIVE_DOMAIN = (
    window.SensoDomains &&
    ACTIVE_PROFILE.domainId &&
    window.SensoDomains[ACTIVE_PROFILE.domainId]
)
    ? window.SensoDomains[ACTIVE_PROFILE.domainId]
    : { id: "base", labels: {} };

const LEGACY_STORAGE_KEY = "appData";
const LEGACY_SETTINGS_KEY = "appSettings";
const STORAGE_KEY_BASE = `appData:${ACTIVE_PROFILE.id}`;
const LAST_UID_KEY = "senso:lastAuthUid";
const ACTIVE_BUSINESS_SYNC_KEY = "senso:activeBusinessSynced";

let cloudHydrationStarted = false;
let cloudSyncTimer = null;
let settingsCloudHydrationStarted = {};
let settingsCloudSyncTimers = {};
let authStorageMigrated = false;
let authStorageReloadDone = false;
let liveUpdateTimer = null;
let dataCacheKey = "";
let dataCacheRaw = "";
let dataCacheValue = null;

function getAuthUid() {
    if (window.SensoAuth && window.SensoAuth.uid) {
        return window.SensoAuth.uid;
    }

    try {
        const user = window.firebase?.auth?.()?.currentUser;
        if (user?.uid) return user.uid;
    } catch (_err) {
        // Sem auth pronto ainda.
    }

    try {
        const cachedUid = localStorage.getItem(LAST_UID_KEY);
        if (cachedUid) return cachedUid;
    } catch (_err) {
        // Storage indisponivel.
    }

    return null;
}

async function syncActiveBusinessForAdmin() {
    const uid = getAuthUid();
    const business = window.SensoProfile?.getBusinessType?.();
    if (!uid || !business?.id || !window.firebase?.firestore) return;

    const syncKey = `${ACTIVE_BUSINESS_SYNC_KEY}:${uid}`;
    try {
        if (sessionStorage.getItem(syncKey) === business.id) return;
        await firebase.firestore().collection("users").doc(uid).update({
            negocioAtivo: business.id,
            negocioAtivoNome: business.label || business.id,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        sessionStorage.setItem(syncKey, business.id);
    } catch (error) {
        console.warn("Não foi possível sincronizar o negócio ativo.", error);
    }
}

window.addEventListener("senso-auth-ready", syncActiveBusinessForAdmin);
setTimeout(syncActiveBusinessForAdmin, 0);

function getStorageKey() {
    const uid = getAuthUid();
    if (uid) return `${STORAGE_KEY_BASE}:uid:${uid}`;

    return `${STORAGE_KEY_BASE}:anon`;
}

function getProfileId(profileId) {
    const id = String(profileId || ACTIVE_PROFILE.id || "base");
    return window.SensoProfile?.profiles?.[id] ? id : "base";
}

function getSettingsKey(profileId) {
    const uid = getAuthUid();
    const settingsKeyBase = `appSettings:${getProfileId(profileId)}`;
    if (uid) return `${settingsKeyBase}:uid:${uid}`;

    return `${settingsKeyBase}:anon`;
}

function getUidStorageKey(uid) {
    return `${STORAGE_KEY_BASE}:uid:${uid}`;
}

function getUidSettingsKey(uid, profileId) {
    return `appSettings:${getProfileId(profileId)}:uid:${uid}`;
}

function getAnonStorageKey() {
    return `${STORAGE_KEY_BASE}:anon`;
}

function getAnonSettingsKey() {
    return `appSettings:${getProfileId()}:anon`;
}

function createEmptyData() {
    return {
        clientes: [],
        servicos: [],
        agenda: [],
        financeiro: [],
        orcamentos: [],
        correcoes: [],
        updatedAt: 0
    };
}

function normalizarChaveAgenda(valor) {
    return String(valor || "").trim().toLocaleLowerCase("pt-BR");
}

function obterServicoIdAgenda(agendamento) {
    return String(agendamento?.servicoOrigemId || agendamento?.origemServicoId || "").trim();
}

function obterDescricaoAgenda(agendamento, dataRef) {
    const descricaoInformada = String(agendamento?.descricaoProximoServico || "").trim();
    if (descricaoInformada) return descricaoInformada;

    const servicoOrigem = (dataRef?.servicos || []).find(servico =>
        servico.id === agendamento?.servicoOrigemId || servico.id === agendamento?.origemServicoId
    );
    const item = Array.isArray(servicoOrigem?.itens) ? servicoOrigem.itens[0] : null;
    return String(item?.descricao || item?.nome || "Retorno agendado").trim();
}

function assinaturaAgendaExcluida(agendamento, dataRef) {
    const cliente = agendamento?.cliente || {};
    const clienteKey = agendamento?.clienteId || cliente.id || cliente.documento || cliente.telefone || cliente.nome || "";
    return [
        normalizarChaveAgenda(clienteKey),
        normalizarChaveAgenda(obterServicoIdAgenda(agendamento)),
        normalizarChaveAgenda(obterDescricaoAgenda(agendamento, dataRef)),
        String(agendamento?.dataRetorno || "").slice(0, 10)
    ].join("|");
}

function lerAgendamentosExcluidos() {
    try {
        const bruto = localStorage.getItem(`senso:agenda-excluida:${ACTIVE_PROFILE.id}:uid:${getAuthUid() || "anon"}`);
        const lista = JSON.parse(bruto || "[]");
        return new Set(Array.isArray(lista) ? lista : []);
    } catch (_error) {
        return new Set();
    }
}

function agendamentoMarcadoComoExcluido(agendamento, dataRef, excluidos) {
    return (agendamento?.id && excluidos.has(`id:${agendamento.id}`))
        || excluidos.has(`sig:${assinaturaAgendaExcluida(agendamento, dataRef)}`);
}

function agendamentoTemOrcamentoAprovado(agendamento, dataRef) {
    const servicoId = obterServicoIdAgenda(agendamento);
    if (!servicoId) return false;
    if (!(dataRef.servicos || []).some(servico => servico.id === servicoId)) return false;
    return (dataRef.orcamentos || []).some(orcamento =>
        orcamento?.origemServicoId === servicoId &&
        (orcamento.status === "aprovado" || !!orcamento.aprovadoEm)
    );
}

function removerResiduosAgenda(data) {
    const agenda = Array.isArray(data.agenda) ? data.agenda : [];
    if (!agenda.length) return data;

    const excluidos = lerAgendamentosExcluidos();
    data.agenda = agenda.filter(agendamento => {
        if (agendamento?.status !== "agendado") return true;
        return !agendamentoMarcadoComoExcluido(agendamento, data, excluidos)
            && agendamentoTemOrcamentoAprovado(agendamento, data);
    });
    return data;
}

function normalizarChaveCliente(cliente) {
    return [
        normalizarChaveAgenda(cliente?.documento),
        normalizarChaveAgenda(cliente?.telefone),
        normalizarChaveAgenda(cliente?.nome),
        normalizarChaveAgenda(cliente?.endereco)
    ].join("|");
}

function deduplicarClientesPorDados(clientes) {
    const vistos = new Set();
    return (Array.isArray(clientes) ? clientes : []).filter(cliente => {
        const chave = normalizarChaveCliente(cliente);
        if (chave === "|||") return true;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
    });
}

function aplicarFirebaseComoFonte(dataLocal, dataFirebase) {
    const local = normalizeData(dataLocal || null);
    const cloud = normalizeData(dataFirebase || null);
    return normalizeData({
        ...local,
        ...cloud,
        clientes: deduplicarClientesPorDados(cloud.clientes),
        agenda: Array.isArray(cloud.agenda) ? cloud.agenda : [],
        updatedAt: Number(cloud.updatedAt || Date.now())
    });
}

function normalizeData(input) {
    const data = (input && typeof input === "object")
        ? input
        : createEmptyData();

    data.clientes = deduplicarClientesPorDados(data.clientes || []);
    data.servicos ||= [];
    data.agenda ||= [];
    data.financeiro ||= [];
    data.orcamentos ||= [];
    data.correcoes ||= [];
    data.updatedAt = Number(data.updatedAt || 0);
    sanitizarObjetoSeguro(data);
    removerResiduosAgenda(data);

    return data;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function contemCodigoPerigoso(value) {
    const texto = String(value || "");
    return [
        /<\s*\/?\s*(script|iframe|object|embed|link|meta|style|svg|img|form|input|button)[\s>/]/i,
        /\bjavascript\s*:/i,
        /\bon[a-z]+\s*=/i,
        /\b(select|insert|update|delete|drop|alter|create|truncate|union|exec)\b[\s\S]*(\bfrom\b|\bwhere\b|\btable\b|\binto\b|;|--|\/\*)/i,
        /['"]\s*(or|and)\s+['"]?\w+['"]?\s*=\s*['"]?\w+/i
    ].some(regex => regex.test(texto));
}

function limparTextoSeguro(value, maxLength = 200) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/[<>`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function sanitizarObjetoSeguro(value, seen = new WeakSet()) {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return value;
    seen.add(value);

    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            if (typeof item === "string") {
                value[index] = limparTextoSeguro(item, 1000);
                return;
            }
            sanitizarObjetoSeguro(item, seen);
        });
        return value;
    }

    Object.keys(value).forEach(key => {
        const item = value[key];
        if (typeof item === "string") {
            value[key] = limparTextoSeguro(item, 1000);
            return;
        }
        sanitizarObjetoSeguro(item, seen);
    });

    return value;
}

function validarTextoUsuario(value, nomeCampo = "campo", maxLength = 200) {
    const texto = String(value || "");
    if (contemCodigoPerigoso(texto)) {
        throw new Error(`${nomeCampo} contem texto invalido ou codigo bloqueado.`);
    }
    return limparTextoSeguro(texto, maxLength);
}

function parseDataSafe(raw) {
    if (!raw) return null;
    try {
        return normalizeData(JSON.parse(raw));
    } catch {
        return null;
    }
}

function isDataEmpty(data) {
    const d = normalizeData(data);
    return (
        d.clientes.length === 0 &&
        d.servicos.length === 0 &&
        d.agenda.length === 0 &&
        d.financeiro.length === 0 &&
        d.orcamentos.length === 0 &&
        d.correcoes.length === 0
    );
}

function migrateAnonStorageToUser(uid) {
    if (!uid || authStorageMigrated) return;
    authStorageMigrated = true;

    const anonDataKey = getAnonStorageKey();
    const anonSettingsKey = getAnonSettingsKey();
    const uidDataKey = getUidStorageKey(uid);
    const uidSettingsKey = getUidSettingsKey(uid);

    const anonDataRaw = localStorage.getItem(anonDataKey);
    const anonSettingsRaw = localStorage.getItem(anonSettingsKey);
    const uidDataRaw = localStorage.getItem(uidDataKey);
    const uidSettingsRaw = localStorage.getItem(uidSettingsKey);

    let migratedSomething = false;

    const anonData = parseDataSafe(anonDataRaw);
    const uidData = parseDataSafe(uidDataRaw);
    if (anonData && !isDataEmpty(anonData)) {
        if (!uidData || isDataEmpty(uidData)) {
            localStorage.setItem(uidDataKey, JSON.stringify(anonData));
            migratedSomething = true;
        } else if (Number(anonData.updatedAt || 0) > Number(uidData.updatedAt || 0)) {
            localStorage.setItem(uidDataKey, JSON.stringify(anonData));
            migratedSomething = true;
        }
    }

    if (anonSettingsRaw) {
        if (!uidSettingsRaw) {
            localStorage.setItem(uidSettingsKey, anonSettingsRaw);
            migratedSomething = true;
        }
    }

    if (anonDataRaw) localStorage.removeItem(anonDataKey);
    if (anonSettingsRaw) localStorage.removeItem(anonSettingsKey);

    if (migratedSomething && !authStorageReloadDone) {
        authStorageReloadDone = true;
        notifyLiveUpdate("auth-migrate");
    }
}

function getFirestoreDocRef() {
    const uid = getAuthUid();
    if (!uid || !window.firebase?.firestore) return null;

    return window.firebase
        .firestore()
        .collection("users")
        .doc(uid)
        .collection("appData")
        .doc(ACTIVE_PROFILE.id);
}

function getFirestoreSettingsDocRef(profileId) {
    const uid = getAuthUid();
    if (!uid || !window.firebase?.firestore) return null;

    return window.firebase
        .firestore()
        .collection("users")
        .doc(uid)
        .collection("appSettings")
        .doc(getProfileId(profileId));
}

function migrateLegacyStorageIfNeeded(targetKey, legacyKey) {
    const targetRaw = localStorage.getItem(targetKey);
    if (targetRaw !== null) return;

    const legacyRaw = localStorage.getItem(legacyKey);
    if (legacyRaw === null) return;

    localStorage.setItem(targetKey, legacyRaw);
}

function parseSettingsSafe(raw) {
    if (!raw) return null;
    try {
        const settings = JSON.parse(raw);
        return settings && typeof settings === "object" ? settings : null;
    } catch {
        return null;
    }
}

function hasCustomSettings(settings) {
    if (!settings || typeof settings !== "object") return false;
    return Object.keys(settings).some(key => key !== "updatedAt" && settings[key] !== "" && settings[key] != null);
}

function hasCompanyIdentitySettings(settings) {
    if (!settings || typeof settings !== "object") return false;
    return [
        settings.logoDataUrl,
        settings.companyName && settings.companyName !== "Senso",
        settings.companyDocument,
        settings.companyAddress,
        settings.companyPhone,
        settings.companyPhone2,
        settings.headerServices
    ].some(Boolean);
}

function migrateLegacySettingsIfNeeded(targetKey, profileId) {
    const resolvedProfileId = getProfileId(profileId);
    if (resolvedProfileId !== "mecanica" && resolvedProfileId !== "prestador") return;
    migrateLegacyStorageIfNeeded(targetKey, LEGACY_SETTINGS_KEY);
}

function getProfileDefaults(profileId) {
    const id = getProfileId(profileId);
    const profile = window.SensoProfile?.profiles?.[id];
    return profile?.defaults || (id === ACTIVE_PROFILE.id ? (ACTIVE_PROFILE.defaults || {}) : {});
}

function getDomainLabel(name, fallback) {
    if (!ACTIVE_DOMAIN || !ACTIVE_DOMAIN.labels) return fallback;
    return ACTIVE_DOMAIN.labels[name] || fallback;
}

function getData() {
    const storageKey = getStorageKey();
    if (ACTIVE_PROFILE.id === "mecanica") {
        migrateLegacyStorageIfNeeded(storageKey, LEGACY_STORAGE_KEY);
    }

    const raw = localStorage.getItem(storageKey);
    if (dataCacheValue && dataCacheKey === storageKey && dataCacheRaw === raw) {
        tryHydrateCloudData();
        return dataCacheValue;
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        data = null;
    }

    data = normalizeData(data);
    dataCacheKey = storageKey;
    dataCacheRaw = raw;
    dataCacheValue = data;
    tryHydrateCloudData();

    return data;
}

function lancamentoFinanceiroValido(f, dataRef) {
    const data = dataRef || getData();
    if (!f) return false;

    if (f.origem !== "servico") return true;
    if (!f.origemServicoId) return false;

    return data.orcamentos.some(
        o => o.origemServicoId === f.origemServicoId && o.status === "aprovado"
    );
}

function listarFinanceiroValido(dataRef) {
    const data = dataRef || getData();
    return (data.financeiro || []).filter(f => lancamentoFinanceiroValido(f, data));
}

function saveData(data) {
    const storageKey = getStorageKey();
    const normalized = normalizeData(data);
    normalized.updatedAt = Date.now();
    const raw = JSON.stringify(normalized);
    localStorage.setItem(storageKey, raw);
    dataCacheKey = storageKey;
    dataCacheRaw = raw;
    dataCacheValue = normalized;
    queueCloudDataSync(normalized);
    notifyLiveUpdate("save-data");
}

function queueCloudDataSync(data) {
    const docRef = getFirestoreDocRef();
    if (!docRef) return;

    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
        docRef.set({
            data: normalizeData(data),
            updatedAt: Number(data.updatedAt || Date.now())
        }).catch(err => {
            console.warn("Falha ao sincronizar dados no Firestore.", err);
        });
    }, 500);
}

function tryHydrateCloudData() {
    if (cloudHydrationStarted) return;

    const docRef = getFirestoreDocRef();
    if (!docRef) return;
    cloudHydrationStarted = true;

    const storageKey = getStorageKey();
    let localData;
    try {
        localData = normalizeData(JSON.parse(localStorage.getItem(storageKey) || "null"));
    } catch {
        localData = createEmptyData();
    }

    docRef.get().then(snapshot => {
        if (!snapshot.exists) {
            if (!isDataEmpty(localData)) {
                queueCloudDataSync(localData);
            }
            return;
        }

        const cloudPayload = snapshot.data() || {};
        const cloudData = normalizeData(cloudPayload.data || null);
        const cloudUpdatedAt = Number(cloudPayload.updatedAt || cloudData.updatedAt || 0);

        const mergedCloudData = aplicarFirebaseComoFonte(localData, {
            ...cloudData,
            updatedAt: cloudUpdatedAt || Date.now()
        });
        const raw = JSON.stringify(mergedCloudData);
        localStorage.setItem(storageKey, raw);
        dataCacheKey = storageKey;
        dataCacheRaw = raw;
        dataCacheValue = mergedCloudData;
        notifyLiveUpdate("cloud-hydrate");

        if (JSON.stringify(cloudData) !== JSON.stringify(mergedCloudData)) {
            queueCloudDataSync(mergedCloudData);
        }
    }).catch(err => {
        console.warn("Falha ao carregar dados do Firestore.", err);
    });
}

function gerarId() {
    return crypto.randomUUID();
}

// =========================
// CLIENTES
// =========================
function adicionarCliente(cliente) {
    const data = getData();
    if (!podeAdicionarCliente(data)) return false;

    data.clientes.push(cliente);
    saveData(data);
    return true;
}

function atualizarCliente(id, dadosCliente) {
    const data = getData();
    const cliente = data.clientes.find(c => c.id === id && !c.arquivado);
    if (!cliente) return false;

    Object.assign(cliente, dadosCliente, { id: cliente.id });

    const dadosCadastroCliente = {
        ...dadosCliente
    };
    delete dadosCadastroCliente.modeloCarro;
    delete dadosCadastroCliente.placaCarro;
    delete dadosCadastroCliente.corCarro;
    delete dadosCadastroCliente.kmCarro;

    const atualizarClienteVinculado = alvo => {
        if (!alvo?.cliente || alvo.cliente.id !== id) return;
        alvo.cliente = {
            ...alvo.cliente,
            ...dadosCadastroCliente,
            id
        };
    };

    (data.servicos || []).forEach(atualizarClienteVinculado);
    (data.orcamentos || []).forEach(atualizarClienteVinculado);
    (data.agenda || []).forEach(atualizarClienteVinculado);

    saveData(data);
    return true;
}

function listarClientesAtivos() {
    return getData().clientes.filter(c => !c.arquivado);
}

function arquivarCliente(id) {
    const data = getData();
    const c = data.clientes.find(x => x.id === id);
    if (c) c.arquivado = true;
    saveData(data);
}

function telefoneJaExiste(telefone, ignorarClienteId = "") {
    const telefoneNormalizado = String(telefone || "").trim();
    if (!telefoneNormalizado) return false;

    return getData().clientes.some(
        c => !c.arquivado && c.id !== ignorarClienteId && (
            c.telefone === telefoneNormalizado ||
            c.telefone2 === telefoneNormalizado
        )
    );
}

function getUsageLimits() {
    const planState = window.SensoPlans?.state;
    if (!planState?.ready || planState.loading || planState.error) {
        return {
            clientes: Infinity,
            orcamentos: Infinity,
            servicos: Infinity
        };
    }

    if (window.SensoPlans && typeof window.SensoPlans.getUsageLimits === "function") {
        return window.SensoPlans.getUsageLimits();
    }

    return {
        clientes: Infinity,
        orcamentos: Infinity,
        servicos: Infinity
    };
}

function limiteFinito(valor) {
    return Number.isFinite(Number(valor));
}

function mostrarAlertaLimite(recurso, limite) {
    const planoAtual = window.SensoPlans?.getCurrentPlan?.();
    const nomePlano = planoAtual?.plano === "gratis" ? "Plano Gratis" : "Plano Basico mensal";
    const destino = planoAtual?.plano === "gratis" ? "Plano Basico ou Pro" : "Plano Pro";

    alert(
        `Limite do ${nomePlano} atingido: ${limite} ${recurso}. ` +
        `Para continuar cadastrando, altere o cliente para o ${destino}.`
    );
}

function podeAdicionarCliente(dataRef) {
    const data = dataRef || getData();
    const limite = getUsageLimits().clientes;
    if (!limiteFinito(limite)) return true;

    const totalAtivos = (data.clientes || []).filter(c => !c.arquivado).length;
    if (totalAtivos < limite) return true;

    mostrarAlertaLimite("clientes ativos", limite);
    return false;
}

function podeAdicionarServico(dataRef) {
    const data = dataRef || getData();
    const limite = getUsageLimits().servicos;
    if (!limiteFinito(limite)) return true;

    const totalServicos = (data.servicos || []).length;
    if (totalServicos < limite) return true;

    mostrarAlertaLimite("servicos", limite);
    return false;
}

function podeAdicionarOrcamento(dataRef) {
    const data = dataRef || getData();
    const limite = getUsageLimits().orcamentos;
    if (!limiteFinito(limite)) return true;

    const totalOrcamentos = (data.orcamentos || []).length;
    if (totalOrcamentos < limite) return true;

    mostrarAlertaLimite("orcamentos", limite);
    return false;
}

// =========================
// FORMATADORES
// =========================
function formatarTelefoneBR(v) {
    if (!v) return "";
    v = v.replace(/\D/g, "");
    if (v.length === 11)
        return v.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
    if (v.length === 10)
        return v.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
    return v;
}

function formatarMoedaBR(valor) {
    return Number(valor).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatarDocumentoBR(doc) {
    if (!doc) return "";
    const v = doc.replace(/\D/g, "");
    if (v.length === 11)
        return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (v.length === 14)
        return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return doc;
}

function listarTelefonesCliente(cliente) {
    const telefones = [
        cliente?.telefone,
        cliente?.telefone2
    ]
        .map(t => formatarTelefoneBR(String(t || "").trim()))
        .filter(Boolean);

    return Array.from(new Set(telefones));
}

function listarTelefonesEmpresa(settings) {
    const telefones = [
        settings?.companyPhone,
        settings?.companyPhone2
    ]
        .map(t => formatarTelefoneBR(String(t || "").trim()))
        .filter(Boolean);

    return Array.from(new Set(telefones));
}

function formatarDocumentoPorTipo(doc, tipo) {
    const v = String(doc || "").replace(/\D/g, "");
    if (tipo === "none") return "";
    const t = tipo === "cpf" ? "cpf" : "cnpj";

    if (t === "cpf") {
        const clipped = v.slice(0, 11);
        if (clipped.length <= 3) return clipped;
        if (clipped.length <= 6) return `${clipped.slice(0, 3)}.${clipped.slice(3)}`;
        if (clipped.length <= 9) return `${clipped.slice(0, 3)}.${clipped.slice(3, 6)}.${clipped.slice(6)}`;
        return `${clipped.slice(0, 3)}.${clipped.slice(3, 6)}.${clipped.slice(6, 9)}-${clipped.slice(9)}`;
    }

    const clipped = v.slice(0, 14);
    if (clipped.length <= 2) return clipped;
    if (clipped.length <= 5) return `${clipped.slice(0, 2)}.${clipped.slice(2)}`;
    if (clipped.length <= 8) return `${clipped.slice(0, 2)}.${clipped.slice(2, 5)}.${clipped.slice(5)}`;
    if (clipped.length <= 12) return `${clipped.slice(0, 2)}.${clipped.slice(2, 5)}.${clipped.slice(5, 8)}/${clipped.slice(8)}`;
    return `${clipped.slice(0, 2)}.${clipped.slice(2, 5)}.${clipped.slice(5, 8)}/${clipped.slice(8, 12)}-${clipped.slice(12)}`;
}

function montarDescricaoServicoFinanceiro(servico) {
    if (!servico || !Array.isArray(servico.itens) || !servico.itens.length) {
        return `Servico - ${servico?.cliente?.nome || ""}`.trim();
    }

    const descricoes = servico.itens
        .map(i => String(i?.descricao || "").trim())
        .filter(Boolean);

    if (!descricoes.length) {
        return `Servico - ${servico?.cliente?.nome || ""}`.trim();
    }

    if (descricoes.length === 1) {
        return `${descricoes[0]} - ${servico?.cliente?.nome || ""}`.trim();
    }

    return `${descricoes[0]} +${descricoes.length - 1} item(ns) - ${servico?.cliente?.nome || ""}`.trim();
}

// =========================
// SERVIÇOS
// =========================
function salvarServico(servico) {
    const data = getData();
    if (!podeAdicionarServico(data)) return false;

    data.servicos.push(servico);
    saveData(data);
    return true;
}

// ❌ NÃO executa mais serviço manualmente
// Serviço só é executado quando o ORÇAMENTO é aprovado

// =========================
// ORÇAMENTOS
// =========================
function gerarNumeroOrcamento() {
    const data = getData();
    const ano = new Date().getFullYear();
    return `${ano}-${String(data.orcamentos.length + 1).padStart(4, "0")}`;
}

function gerarOrcamentoDoServico(servicoId) {
    const data = getData();
    const servico = data.servicos.find(s => s.id === servicoId);
    if (!servico) return null;

    if (!Array.isArray(servico.itens) || servico.itens.length === 0) {
        alert("Complete os itens e valores do serviço antes de gerar o orçamento.");
        return null;
    }

    if (servico.orcamentoId) {
        const porId = data.orcamentos.find(o => o.id === servico.orcamentoId);
        if (porId) return porId.numero;
    }

    const orcamentoExistente = data.orcamentos.find(
        o => o.origemServicoId === servico.id
    );
    if (orcamentoExistente) {
        servico.orcamentoId = orcamentoExistente.id;
        saveData(data);
        return orcamentoExistente.numero;
    }

    if (!podeAdicionarOrcamento(data)) return null;

    const numero = gerarNumeroOrcamento();

    const novoId = gerarId();
    data.orcamentos.push({
        id: novoId,
        numero,
        criadoEm: new Date().toISOString(),
        origemServicoId: servico.id,
        status: "enviado",

        cliente: servico.cliente,
        itens: servico.itens,
        total: servico.totalGeral,
        observacoes: servico.observacoes || "",
        formaPagamento: servico.formaPagamento || ""
    });

    servico.orcamentoId = novoId;
    saveData(data);
    return numero;
}

// =========================
// APROVAR ORÇAMENTO  ✅ PONTO CENTRAL
// =========================
function marcarOrcamentoComoAprovado(orcamentoId) {
    const data = getData();
    const orc = data.orcamentos.find(o => o.id === orcamentoId);
    if (!orc) return false;

    if (orc.status === "aprovado") {
        alert("Este orcamento ja foi aprovado.");
        return false;
    }

    orc.status = "aprovado";
    orc.aprovadoEm = new Date().toISOString();

    const servico = data.servicos.find(
        s => s.id === orc.origemServicoId
    );

    if (servico && servico.status !== "executado") {
        servico.status = "executado";
        servico.executadoEm = new Date().toISOString();

        // FINANCEIRO
        data.financeiro.push({
            id: gerarId(),
            tipo: "entrada",
            origem: "servico",
            origemServicoId: servico.id,
            descricao: montarDescricaoServicoFinanceiro(servico),
            valor: servico.totalGeral,
            data: servico.executadoEm
        });

    }

    saveData(data);
    return true;
}

// =========================
// RECUSAR ORÇAMENTO
// =========================
function marcarOrcamentoComoRecusado(orcamentoId) {
    const data = getData();
    const orc = data.orcamentos.find(o => o.id === orcamentoId);
    if (!orc) return false;

    if (orc.status === "aprovado") {
        alert("Este orcamento ja foi aprovado.");
        return false;
    }

    if (orc.status === "recusado") {
        alert("Este orcamento ja foi recusado.");
        return false;
    }

    orc.status = "recusado";
    orc.recusadoEm = new Date().toISOString();

    saveData(data);
    return true;
}

// =========================
// CORRIGIR / APAGAR SERVIÇO
// =========================
function estornarServico(servicoId) {
    const data = getData();
    const servico = data.servicos.find(s => s.id === servicoId);
    const lancamentosRemovidos = data.financeiro.filter(
        f => f.origemServicoId === servicoId
    );

    if (servico) {
        const impactoSaldo = lancamentosRemovidos.reduce((acc, f) => {
            if (f.tipo === "saida") return acc + Number(f.valor || 0);
            return acc - Number(f.valor || 0);
        }, 0);

        const itens = Array.isArray(servico.itens) ? servico.itens : [];
        const itensResumo = itens
            .map(i => String(i?.descricao || "").trim())
            .filter(Boolean)
            .join(" - ");

        data.correcoes.push({
            id: gerarId(),
            servicoId,
            data: new Date().toISOString(),
            clienteNome: servico?.cliente?.nome || "",
            totalServico: Number(servico?.totalGeral || 0),
            impactoSaldo,
            itensResumo
        });
    }

    data.servicos = data.servicos.filter(s => s.id !== servicoId);
    data.orcamentos = data.orcamentos.filter(o => o.origemServicoId !== servicoId);
    data.financeiro = data.financeiro.filter(f => f.origemServicoId !== servicoId);
    data.agenda = data.agenda.filter(a => a.origemServicoId !== servicoId);

    saveData(data);
}

// =========================
// CONFIGURACOES VISUAIS
// =========================
function getAppSettings(profileId) {
    const resolvedProfileId = getProfileId(profileId);
    const settingsKey = getSettingsKey(resolvedProfileId);
    migrateLegacySettingsIfNeeded(settingsKey, resolvedProfileId);

    const profileDefaults = getProfileDefaults(resolvedProfileId);
    tryHydrateCloudSettings(resolvedProfileId);
    let settings;
    try {
        settings = JSON.parse(localStorage.getItem(settingsKey));
    } catch {
        settings = null;
    }

    if (!settings || typeof settings !== "object") {
        settings = {};
    }

    const hasSettingDocument = Object.prototype.hasOwnProperty.call(settings, "companyDocument");
    const resolvedDocument = hasSettingDocument
        ? String(settings.companyDocument || "")
        : (profileDefaults.companyDocument || "");
    const resolvedDocumentType = (
        settings.companyDocumentType === "none" ||
        settings.companyDocumentType === "cpf" ||
        settings.companyDocumentType === "cnpj"
    )
        ? settings.companyDocumentType
        : (resolvedDocument ? inferCompanyDocumentType(resolvedDocument) : "none");

    return {
        primaryColor: settings.primaryColor || profileDefaults.primaryColor || "#0a7cff",
        buttonTextColor: settings.buttonTextColor || "#ffffff",
        buttonSecondaryTextColor: settings.buttonSecondaryTextColor || "#111827",
        logoDataUrl: settings.logoDataUrl || "",
        companyName: Object.prototype.hasOwnProperty.call(settings, "companyName")
            ? String(settings.companyName || "")
            : (profileDefaults.companyName ?? "Senso"),
        companyDocument: resolvedDocument,
        companyDocumentType: resolvedDocumentType,
        companyAddress: settings.companyAddress || profileDefaults.companyAddress || "",
        companyPhone: settings.companyPhone || profileDefaults.companyPhone || "",
        companyPhone2: settings.companyPhone2 || profileDefaults.companyPhone2 || "",
        headerServices: String(settings.headerServices || "").slice(0, 120)
    };
}

function inferCompanyDocumentType(doc) {
    const digits = String(doc || "").replace(/\D/g, "");
    if (digits.length === 11) return "cpf";
    return "cnpj";
}

function notifyLiveUpdate(source) {
    if (liveUpdateTimer) clearTimeout(liveUpdateTimer);
    liveUpdateTimer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("senso-live-update", {
            detail: {
                source: source || "unknown",
                ts: Date.now()
            }
        }));
    }, 180);
}

function saveAppSettings(nextSettings, profileId) {
    const resolvedProfileId = getProfileId(profileId);
    const current = getAppSettings(resolvedProfileId);
    const merged = {
        ...current,
        ...(nextSettings || {}),
        updatedAt: Date.now()
    };

    localStorage.setItem(getSettingsKey(resolvedProfileId), JSON.stringify(merged));
    queueCloudSettingsSync(merged, resolvedProfileId);
    if (resolvedProfileId === ACTIVE_PROFILE.id) {
        applyAppSettings();
    }
    notifyLiveUpdate("save-settings");
}

function queueCloudSettingsSync(settings, profileId) {
    const resolvedProfileId = getProfileId(profileId);
    const docRef = getFirestoreSettingsDocRef(resolvedProfileId);
    if (!docRef) return;

    if (settingsCloudSyncTimers[resolvedProfileId]) {
        clearTimeout(settingsCloudSyncTimers[resolvedProfileId]);
    }

    settingsCloudSyncTimers[resolvedProfileId] = setTimeout(() => {
        docRef.set({
            settings: {
                ...(settings || {}),
                updatedAt: Number(settings?.updatedAt || Date.now())
            },
            updatedAt: Number(settings?.updatedAt || Date.now())
        }).catch(err => {
            console.warn("Falha ao sincronizar configuracoes no Firestore.", err);
        });
    }, 500);
}

function tryHydrateCloudSettings(profileId) {
    const resolvedProfileId = getProfileId(profileId);
    if (settingsCloudHydrationStarted[resolvedProfileId]) return;

    const docRef = getFirestoreSettingsDocRef(resolvedProfileId);
    if (!docRef) return;
    settingsCloudHydrationStarted[resolvedProfileId] = true;

    const settingsKey = getSettingsKey(resolvedProfileId);
    const localSettings = parseSettingsSafe(localStorage.getItem(settingsKey)) || {};
    const localUpdatedAt = Number(localSettings.updatedAt || 0);

    docRef.get().then(snapshot => {
        if (!snapshot.exists) {
            if (hasCustomSettings(localSettings)) {
                const settingsToSync = {
                    ...localSettings,
                    updatedAt: localUpdatedAt || Date.now()
                };
                localStorage.setItem(settingsKey, JSON.stringify(settingsToSync));
                queueCloudSettingsSync(settingsToSync, resolvedProfileId);
            }
            return;
        }

        const cloudPayload = snapshot.data() || {};
        const cloudSettings = (cloudPayload.settings && typeof cloudPayload.settings === "object")
            ? cloudPayload.settings
            : {};
        const cloudUpdatedAt = Number(cloudPayload.updatedAt || cloudSettings.updatedAt || 0);

        const localHasCustomSettings = hasCustomSettings(localSettings);
        const cloudHasCustomSettings = hasCustomSettings(cloudSettings);
        const localHasCompanyIdentity = hasCompanyIdentitySettings(localSettings);
        const cloudHasCompanyIdentity = hasCompanyIdentitySettings(cloudSettings);

        if (
            cloudHasCustomSettings &&
            (!localHasCustomSettings || cloudUpdatedAt >= localUpdatedAt || (cloudHasCompanyIdentity && !localHasCompanyIdentity))
        ) {
            const nextSettings = {
                ...cloudSettings,
                updatedAt: cloudUpdatedAt || Date.now()
            };
            localStorage.setItem(settingsKey, JSON.stringify(nextSettings));
            if (resolvedProfileId === ACTIVE_PROFILE.id) {
                applyAppSettings();
            }
            notifyLiveUpdate("cloud-settings-hydrate");
            return;
        }

        if (localUpdatedAt > cloudUpdatedAt && hasCustomSettings(localSettings)) {
            queueCloudSettingsSync(localSettings, resolvedProfileId);
        }
    }).catch(err => {
        console.warn("Falha ao carregar configuracoes do Firestore.", err);
    });
}

function applyAppSettings() {
    const settings = getAppSettings();

    document.documentElement.style.setProperty(
        "--app-primary",
        settings.primaryColor
    );
    document.documentElement.style.setProperty(
        "--app-button-text",
        settings.buttonTextColor || "#ffffff"
    );
    document.documentElement.style.setProperty(
        "--app-button-secondary-text",
        settings.buttonSecondaryTextColor || "#111827"
    );

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute("content", settings.primaryColor);
    }

    applyBudgetCompanyInfo(settings);
    applyBudgetLogo(settings.logoDataUrl);
}

function applyBudgetCompanyInfo(settings) {
    const empresaEl = document.querySelector(".cabecalho .empresa");
    if (!empresaEl) return;

    const companyName = settings.companyName || "Senso";
    const companyDocument = settings.companyDocument || "";
    const companyDocumentType = ["cpf", "cnpj", "none"].includes(settings.companyDocumentType)
        ? settings.companyDocumentType
        : inferCompanyDocumentType(companyDocument);
    const companyDocumentLabel = companyDocumentType === "cpf" ? "CPF" : "CNPJ";
    const companyDocumentFormatted = formatarDocumentoPorTipo(companyDocument, companyDocumentType);
    const companyAddress = settings.companyAddress || "—";
    const companyPhonesFormatted = listarTelefonesEmpresa(settings).join(" / ") || "—";

    empresaEl.innerHTML = "";

    const strong = document.createElement("strong");
    strong.textContent = companyName;
    empresaEl.appendChild(strong);
    empresaEl.appendChild(document.createElement("br"));

    if (companyDocumentType !== "none" && companyDocumentFormatted) {
        empresaEl.appendChild(
            document.createTextNode(`${companyDocumentLabel}: ${companyDocumentFormatted}`)
        );
        empresaEl.appendChild(document.createElement("br"));
    }

    empresaEl.appendChild(
        document.createTextNode(`Endereco: ${companyAddress}`)
    );
    empresaEl.appendChild(document.createElement("br"));

    empresaEl.appendChild(
        document.createTextNode(`Telefone: ${companyPhonesFormatted}`)
    );
}

function applyBudgetLogo(logoDataUrl) {
    const empresaEl = document.querySelector(".cabecalho .empresa");
    if (!empresaEl) return;

    const existing = document.getElementById("orcamentoLogo");
    if (existing) existing.remove();

    if (!logoDataUrl) return;

    const img = document.createElement("img");
    img.id = "orcamentoLogo";
    img.src = logoDataUrl;
    img.alt = "Logo da empresa";
    img.style.display = "block";
    img.style.height = "110px";
    img.style.maxHeight = "110px";
    img.style.maxWidth = "320px";
    img.style.width = "auto";
    img.style.marginBottom = "8px";
    img.style.objectFit = "contain";
    img.style.objectPosition = "left center";

    empresaEl.prepend(img);
}

applyAppSettings();

window.addEventListener("senso-auth-ready", event => {
    const uid = event?.detail?.uid || getAuthUid();
    if (!uid) return;
    migrateAnonStorageToUser(uid);
    applyAppSettings();
});

const initialAuthUid = getAuthUid();
if (initialAuthUid) {
    migrateAnonStorageToUser(initialAuthUid);
}

// =========================
// ATUALIZACAO AUTOMATICA DE TELA
// =========================
function enableAutoRefreshOnDataChange() {
    const isConfigPage = /\/configuracoes\.html$/i.test(location.pathname);
    if (isConfigPage) return;

    let lastDataKey = getStorageKey();
    let lastSettingsKey = getSettingsKey();
    let lastDataRaw = localStorage.getItem(lastDataKey) || "";
    let lastSettingsRaw = localStorage.getItem(lastSettingsKey) || "";

    function captureCurrentSnapshot() {
        lastDataKey = getStorageKey();
        lastSettingsKey = getSettingsKey();
        lastDataRaw = localStorage.getItem(lastDataKey) || "";
        lastSettingsRaw = localStorage.getItem(lastSettingsKey) || "";
    }

    function hasChanged() {
        const currentDataKey = getStorageKey();
        const currentSettingsKey = getSettingsKey();

        // Quando a chave muda (ex.: anon -> uid), so recalibra baseline.
        if (currentDataKey !== lastDataKey || currentSettingsKey !== lastSettingsKey) {
            lastDataKey = currentDataKey;
            lastSettingsKey = currentSettingsKey;
            lastDataRaw = localStorage.getItem(lastDataKey) || "";
            lastSettingsRaw = localStorage.getItem(lastSettingsKey) || "";
            return false;
        }

        const currentDataRaw = localStorage.getItem(currentDataKey) || "";
        const currentSettingsRaw = localStorage.getItem(currentSettingsKey) || "";
        return currentDataRaw !== lastDataRaw || currentSettingsRaw !== lastSettingsRaw;
    }

    function refreshIfChanged() {
        if (!hasChanged()) return;
        captureCurrentSnapshot();
        applyAppSettings();
        notifyLiveUpdate("storage-sync");
    }

    window.addEventListener("storage", event => {
        if (event.key === getStorageKey() || event.key === getSettingsKey()) {
            refreshIfChanged();
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) refreshIfChanged();
    });

    window.addEventListener("focus", refreshIfChanged);

    // fallback para navegadores mobile onde alguns eventos sao limitados
    setInterval(() => {
        if (!document.hidden) refreshIfChanged();
    }, 15000);
}

enableAutoRefreshOnDataChange();
