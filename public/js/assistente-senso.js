(function () {
    "use strict";

    let modalAtual = null;

    function getEstado(data) {
        data.assistenteSenso ||= {};
        data.assistenteSenso.gastosServicos ||= {};
        return data.assistenteSenso.gastosServicos;
    }

    function atualizarPendencia(servicoId, status) {
        if (!servicoId || typeof getData !== "function" || typeof saveData !== "function") return;

        const data = getData();
        const gastos = getEstado(data);
        const anterior = gastos[servicoId] || {};
        gastos[servicoId] = {
            ...anterior,
            servicoId,
            status,
            atualizadoEm: new Date().toISOString()
        };
        saveData(data);
    }

    function criarPendencia(servicoId) {
        if (!servicoId || typeof getData !== "function" || typeof saveData !== "function") return;

        const data = getData();
        const gastos = getEstado(data);
        if (gastos[servicoId]?.status === "concluido" || gastos[servicoId]?.status === "sem-gastos") return;

        gastos[servicoId] = {
            servicoId,
            status: "pendente",
            criadoEm: gastos[servicoId]?.criadoEm || new Date().toISOString(),
            atualizadoEm: new Date().toISOString()
        };
        saveData(data);
    }

    function listarPendencias() {
        if (typeof getData !== "function") return [];
        const gastos = getEstado(getData());
        return Object.values(gastos)
            .filter(item => item?.status === "pendente")
            .sort((a, b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || "")));
    }

    function fechar(motivo = "fechar") {
        if (!modalAtual) return;
        const atual = modalAtual;
        modalAtual = null;
        atual.overlay.classList.remove("ativo");
        document.removeEventListener("keydown", atual.onKeydown);
        setTimeout(() => atual.overlay.remove(), 220);
        if (typeof atual.onClose === "function") atual.onClose(motivo);
    }

    function abrir(opcoes = {}) {
        if (modalAtual) fechar("substituido");

        const overlay = document.createElement("div");
        overlay.className = "senso-assistente-overlay";
        overlay.setAttribute("role", "presentation");

        const modal = document.createElement("section");
        modal.className = "senso-assistente-modal";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "senso-assistente-titulo");

        const cabecalho = document.createElement("div");
        cabecalho.className = "senso-assistente-cabecalho";

        const icone = document.createElement("span");
        icone.className = "senso-assistente-icone";
        icone.setAttribute("aria-hidden", "true");
        if (opcoes.imagem) {
            const imagem = document.createElement("img");
            imagem.className = "senso-assistente-mascote";
            imagem.src = opcoes.imagem;
            imagem.alt = "";
            icone.appendChild(imagem);
        } else {
            icone.textContent = "🤖";
        }

        const titulo = document.createElement("h2");
        titulo.className = "senso-assistente-titulo";
        titulo.id = "senso-assistente-titulo";
        cabecalho.append(icone, titulo);
        cabecalho.querySelector("h2").textContent = opcoes.titulo || "Assistente Senso";

        const botaoFechar = document.createElement("button");
        botaoFechar.type = "button";
        botaoFechar.className = "senso-assistente-fechar";
        botaoFechar.setAttribute("aria-label", "Fechar Assistente Senso");
        botaoFechar.textContent = "×";
        cabecalho.appendChild(botaoFechar);

        const balao = document.createElement("div");
        balao.className = "senso-assistente-balao";
        (opcoes.mensagens || []).forEach(texto => {
            const p = document.createElement("p");
            p.textContent = texto;
            balao.appendChild(p);
        });

        const acoes = document.createElement("div");
        acoes.className = "senso-assistente-acoes";
        (opcoes.acoes || []).forEach(acao => {
            const botao = document.createElement("button");
            botao.type = "button";
            botao.className = `senso-assistente-acao ${acao.estilo || ""}`.trim();
            botao.textContent = acao.texto;
            botao.addEventListener("click", () => acao.aoClicar?.({ fechar }));
            acoes.appendChild(botao);
        });

        modal.append(cabecalho, balao);
        if (acoes.childElementCount) modal.appendChild(acoes);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const onKeydown = event => {
            if (event.key === "Escape") fechar("escape");
        };
        modalAtual = { overlay, onClose: opcoes.aoFechar, onKeydown };
        document.addEventListener("keydown", onKeydown);
        botaoFechar.addEventListener("click", () => fechar("botao-fechar"));
        overlay.addEventListener("click", event => {
            if (event.target === overlay) fechar("fora");
        });
        requestAnimationFrame(() => overlay.classList.add("ativo"));
        setTimeout(() => botaoFechar.focus(), 30);
    }

    window.AssistenteSenso = {
        abrir,
        fechar,
        criarPendencia,
        listarPendencias,
        lembrarDepois(servicoId) {
            atualizarPendencia(servicoId, "pendente");
        },
        concluirGasto(servicoId) {
            atualizarPendencia(servicoId, "concluido");
        },
        informarSemGastos(servicoId) {
            atualizarPendencia(servicoId, "sem-gastos");
        }
    };
})();
