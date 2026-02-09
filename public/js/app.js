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
            orcamentos: []
        };
    }

    data.clientes ||= [];
    data.servicos ||= [];
    data.agenda ||= [];
    data.financeiro ||= [];
    data.orcamentos ||= [];

    return data;
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

    const numero = gerarNumeroOrcamento();

    data.orcamentos.push({
        id: gerarId(),
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

    saveData(data);
    return numero;
}

// =========================
// APROVAR ORÇAMENTO  ✅ PONTO CENTRAL
// =========================
function marcarOrcamentoComoAprovado(orcamentoId) {
    const data = getData();
    const orc = data.orcamentos.find(o => o.id === orcamentoId);
    if (!orc) return;

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
            descricao: `Serviço - ${servico.cliente.nome}`,
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
}

// =========================
// RECUSAR ORÇAMENTO
// =========================
function marcarOrcamentoComoAprovado(orcamentoId) {
    const data = getData();
    const orc = data.orcamentos.find(o => o.id === orcamentoId);
    if (!orc) return;

    // 🔒 TRAVA DEFINITIVA
    if (orc.status === "aprovado") {
        alert("Este orçamento já foi aprovado.");
        return;
    }

    if (orc.status === "recusado") {
        alert("Este orçamento foi recusado e não pode ser aprovado.");
        return;
    }

    // marca orçamento
    orc.status = "aprovado";
    orc.aprovadoEm = new Date().toISOString();

    // executa serviço UMA ÚNICA VEZ
    const servico = data.servicos.find(
        s => s.id === orc.origemServicoId
    );

    if (servico && servico.status !== "executado") {
        servico.status = "executado";
        servico.executadoEm = new Date().toISOString();

        // financeiro
        data.financeiro.push({
            id: gerarId(),
            tipo: "entrada",
            origem: "servico",
            origemServicoId: servico.id,
            descricao: `Serviço - ${servico.cliente.nome}`,
            valor: servico.totalGeral,
            data: servico.executadoEm
        });

        // agenda (se tiver retorno)
        if (servico.intervaloValor) {
            const retorno = new Date();
            retorno.setMonth(
                retorno.getMonth() + servico.intervaloValor
            );

            data.agenda.push({
                id: gerarId(),
                origemServicoId: servico.id,
                cliente: servico.cliente,
                dataExecucao: servico.executadoEm,
                dataRetorno: retorno.toISOString(),
                status: "agendado",
                valorServico: servico.totalGeral
            });
        }
    }

    saveData(data);
}


// =========================
// CORRIGIR / APAGAR SERVIÇO
// =========================
function estornarServico(servicoId) {
    const data = getData();

    data.servicos = data.servicos.filter(s => s.id !== servicoId);
    data.orcamentos = data.orcamentos.filter(o => o.origemServicoId !== servicoId);
    data.financeiro = data.financeiro.filter(f => f.origemServicoId !== servicoId);
    data.agenda = data.agenda.filter(a => a.origemServicoId !== servicoId);

    saveData(data);
}
