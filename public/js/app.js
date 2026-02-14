// =========================
// BASE DO APP
// =========================
const STORAGE_KEY = "appData";

function getData() {
    let data;
    try {
        data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
        data = null;
    }

    if (!data || typeof data !== "object") {
        data = {
            clientes: [],
            servicos: [],
            agenda: [],
            financeiro: [],
            orcamentos: [],
            correcoes: []
        };
    }

    data.clientes ||= [];
    data.servicos ||= [];
    data.agenda ||= [];
    data.financeiro ||= [];
    data.orcamentos ||= [];
    data.correcoes ||= [];

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function gerarId() {
    return crypto.randomUUID();
}

// =========================
// CLIENTES
// =========================
function adicionarCliente(cliente) {
    const data = getData();
    data.clientes.push(cliente);
    saveData(data);
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

function telefoneJaExiste(telefone) {
    return getData().clientes.some(
        c => !c.arquivado && c.telefone === telefone
    );
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
    data.servicos.push(servico);
    saveData(data);
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

        // AGENDA — só cria se houver retorno
if (servico.intervaloTipo !== "nenhum") {

    const retorno = new Date();

    if (servico.intervaloTipo === "semanas") {
        retorno.setDate(retorno.getDate() + 7);
    } else {
        retorno.setMonth(
            retorno.getMonth() + (servico.intervaloValor || 6)
        );
    }

    data.agenda.push({
        id: gerarId(),
        origemServicoId: servico.id,
        cliente: servico.cliente,
        dataExecucao: servico.executadoEm,
        dataRetorno: retorno.toISOString(),
        status: "agendado",
        valorServico: servico.totalGeral // 🔒 já estava funcionando
    });
}

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
const SETTINGS_KEY = "appSettings";

function getAppSettings() {
    let settings;
    try {
        settings = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    } catch {
        settings = null;
    }

    if (!settings || typeof settings !== "object") {
        settings = {};
    }

    return {
        primaryColor: settings.primaryColor || "#0a7cff",
        buttonTextColor: settings.buttonTextColor || "#ffffff",
        buttonSecondaryTextColor: settings.buttonSecondaryTextColor || "#111827",
        logoDataUrl: settings.logoDataUrl || "",
        companyName: settings.companyName || "PROICE CLIMATIZACAO",
        companyDocument: settings.companyDocument || "42.937.499/0001-08",
        companyAddress: settings.companyAddress || "Sao Paulo",
        companyPhone: settings.companyPhone || "(11) 99284-1312"
    };
}

function saveAppSettings(nextSettings) {
    const current = getAppSettings();
    const merged = {
        ...current,
        ...(nextSettings || {})
    };

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    applyAppSettings();
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

    const companyName = settings.companyName || "PROICE CLIMATIZACAO";
    const companyDocument = settings.companyDocument || "42.937.499/0001-08";
    const companyAddress = settings.companyAddress || "Sao Paulo";
    const companyPhone = settings.companyPhone || "(11) 99284-1312";

    empresaEl.innerHTML = "";

    const strong = document.createElement("strong");
    strong.textContent = companyName;
    empresaEl.appendChild(strong);
    empresaEl.appendChild(document.createElement("br"));

    empresaEl.appendChild(
        document.createTextNode(`CNPJ: ${companyDocument}`)
    );
    empresaEl.appendChild(document.createElement("br"));

    empresaEl.appendChild(
        document.createTextNode(`Endereco: ${companyAddress}`)
    );
    empresaEl.appendChild(document.createElement("br"));

    empresaEl.appendChild(
        document.createTextNode(`Telefone: ${companyPhone}`)
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

// =========================
// ATUALIZACAO AUTOMATICA DE TELA
// =========================
function enableAutoRefreshOnDataChange() {
    const isConfigPage = /\/configuracoes\.html$/i.test(location.pathname);
    if (isConfigPage) return;

    let lastDataRaw = localStorage.getItem(STORAGE_KEY) || "";
    let lastSettingsRaw = localStorage.getItem(SETTINGS_KEY) || "";

    function hasChanged() {
        const currentDataRaw = localStorage.getItem(STORAGE_KEY) || "";
        const currentSettingsRaw = localStorage.getItem(SETTINGS_KEY) || "";
        return currentDataRaw !== lastDataRaw || currentSettingsRaw !== lastSettingsRaw;
    }

    function refreshIfChanged() {
        if (!hasChanged()) return;
        location.reload();
    }

    window.addEventListener("storage", event => {
        if (event.key === STORAGE_KEY || event.key === SETTINGS_KEY) {
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
