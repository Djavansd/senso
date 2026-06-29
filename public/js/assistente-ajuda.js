(function () {
    "use strict";

    const STORAGE_PREFIX = "senso:ajuda-guiada:v1";
    const IMAGENS = Object.freeze({
        apontando: "/assets/assistente-senso/ajuda-apontando.png",
        concluida: "/assets/assistente-senso/ajuda-concluida.png",
        desativada: "/assets/assistente-senso/ajuda-desativada.png",
        instrucoes: "/assets/assistente-senso/ajuda-instrucoes.png"
    });

    const LICOES = Object.freeze([
        {
            id: "inicio",
            nome: "Início",
            href: "/index.html",
            paginas: ["", "index.html"],
            imagem: IMAGENS.apontando,
            mensagens: [
                "Este é o painel principal do Senso.",
                "Use os cartões para entrar rapidamente em Clientes, Serviços, Orçamentos, Agenda, Financeiro e Resumo."
            ]
        },
        {
            id: "clientes",
            nome: "Clientes",
            href: "/pages/clientes.html",
            paginas: ["clientes.html", "novo-cliente.html"],
            imagem: IMAGENS.instrucoes,
            mensagens: [
                "Aqui você organiza seus clientes.",
                "Cadastre os dados principais e abra um cliente sempre que precisar consultar ou iniciar um atendimento."
            ]
        },
        {
            id: "servicos",
            nome: "Serviços",
            href: "/pages/servico.html",
            paginas: ["servico.html"],
            imagem: IMAGENS.instrucoes,
            mensagens: [
                "Nesta área você registra o serviço realizado.",
                "Selecione o cliente, descreva o problema, informe itens e valores e salve para continuar o atendimento."
            ]
        },
        {
            id: "orcamentos",
            nome: "Orçamentos",
            href: "/pages/orcamentos.html",
            paginas: ["orcamentos.html", "orcamento.html"],
            imagem: IMAGENS.apontando,
            mensagens: [
                "Os orçamentos ficam reunidos aqui.",
                "Você pode revisar as informações, acompanhar a aprovação e abrir o documento para enviar ao cliente."
            ]
        },
        {
            id: "agenda",
            nome: "Agenda",
            href: "/pages/agenda.html",
            paginas: ["agenda.html"],
            imagem: IMAGENS.apontando,
            mensagens: [
                "A Agenda cuida dos retornos e lembretes.",
                "Confira as datas pendentes e marque cada retorno como visto quando concluir o contato."
            ]
        },
        {
            id: "financeiro",
            nome: "Financeiro",
            href: "/pages/financeiro.html",
            paginas: ["financeiro.html"],
            imagem: IMAGENS.instrucoes,
            mensagens: [
                "Aqui você acompanha entradas e saídas.",
                "Registre movimentações extras e consulte o saldo para manter o caixa organizado."
            ]
        },
        {
            id: "resumo",
            nome: "Resumo mensal",
            href: "/pages/resumo.html",
            paginas: ["resumo.html"],
            imagem: IMAGENS.apontando,
            mensagens: [
                "O Resumo mostra o resultado do mês.",
                "Use esta tela para conferir receitas, gastos, saldo e o desempenho do seu trabalho."
            ]
        }
    ]);

    function getUid() {
        const firebaseUid = window.firebase?.apps?.length
            ? window.firebase.auth().currentUser?.uid
            : null;
        return window.SensoAuth?.uid || firebaseUid || "usuario";
    }

    function getStorageKey() {
        return `${STORAGE_PREFIX}:${getUid()}`;
    }

    function estadoPadrao() {
        return {
            ativo: true,
            concluidas: [],
            atualizadoEm: new Date().toISOString()
        };
    }

    function lerEstado() {
        try {
            const salvo = JSON.parse(localStorage.getItem(getStorageKey()) || "null");
            if (!salvo || typeof salvo !== "object") return estadoPadrao();
            return {
                ativo: salvo.ativo !== false,
                concluidas: Array.isArray(salvo.concluidas)
                    ? salvo.concluidas.filter(id => LICOES.some(licao => licao.id === id))
                    : [],
                atualizadoEm: salvo.atualizadoEm || new Date().toISOString()
            };
        } catch (_err) {
            return estadoPadrao();
        }
    }

    function salvarEstado(estado) {
        const normalizado = {
            ativo: estado.ativo !== false,
            concluidas: Array.from(new Set(estado.concluidas || [])),
            atualizadoEm: new Date().toISOString()
        };
        try {
            localStorage.setItem(getStorageKey(), JSON.stringify(normalizado));
        } catch (_err) {
            // A ajuda não deve impedir o uso do app quando o storage estiver indisponível.
        }
        window.dispatchEvent(new CustomEvent("senso-ajuda-alterada", { detail: normalizado }));
        return normalizado;
    }

    function definirAtivo(ativo) {
        return salvarEstado({ ...lerEstado(), ativo: Boolean(ativo) });
    }

    function concluirLicao(id) {
        const estado = lerEstado();
        if (!estado.concluidas.includes(id)) estado.concluidas.push(id);
        if (estado.concluidas.length >= LICOES.length) estado.ativo = false;
        return salvarEstado(estado);
    }

    function reiniciar() {
        return salvarEstado({ ...estadoPadrao(), ativo: true, concluidas: [] });
    }

    function getPaginaAtual() {
        const partes = window.location.pathname.toLowerCase().split("/").filter(Boolean);
        return partes.at(-1) || "";
    }

    function getLicaoAtual() {
        const pagina = getPaginaAtual();
        return LICOES.find(licao => licao.paginas.includes(pagina)) || null;
    }

    function abrirConclusao() {
        window.AssistenteSenso?.abrir({
            titulo: "Você aprendeu o Senso!",
            imagem: IMAGENS.concluida,
            mensagens: [
                "Muito bem! Você concluiu todas as orientações.",
                "A ajuda foi desativada para não atrapalhar sua rotina. Quando precisar, é só ativá-la novamente na aba Assistente de ajuda."
            ],
            acoes: [{
                texto: "Concluir",
                estilo: "primaria",
                aoClicar: ({ fechar }) => fechar("concluido")
            }]
        });
    }

    function abrirLicao(licao, manual) {
        if (!licao || !window.AssistenteSenso) return;
        const estadoAntes = lerEstado();
        const jaConcluida = estadoAntes.concluidas.includes(licao.id);
        const acoes = [];

        if (!jaConcluida) {
            acoes.push({
                texto: "Entendi esta parte",
                estilo: "primaria",
                aoClicar: ({ fechar }) => {
                    const novoEstado = concluirLicao(licao.id);
                    fechar("licao-concluida");
                    if (novoEstado.concluidas.length >= LICOES.length) {
                        setTimeout(abrirConclusao, 260);
                    }
                }
            });
        }

        acoes.push({
            texto: manual ? "Fechar" : "Ver depois",
            estilo: "sutil",
            aoClicar: ({ fechar }) => fechar(manual ? "fechar" : "depois")
        });

        window.AssistenteSenso.abrir({
            titulo: `Ajuda • ${licao.nome}`,
            imagem: licao.imagem,
            mensagens: licao.mensagens,
            acoes
        });
    }

    function criarBotaoFlutuante(licao) {
        if (!licao || document.querySelector(".senso-ajuda-flutuante")) return;
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "senso-ajuda-flutuante";
        botao.setAttribute("aria-label", `Abrir ajuda sobre ${licao.nome}`);

        const imagem = document.createElement("img");
        imagem.src = IMAGENS.apontando;
        imagem.alt = "";
        imagem.setAttribute("aria-hidden", "true");

        const texto = document.createElement("span");
        texto.textContent = "Precisa de ajuda?";
        botao.append(imagem, texto);
        botao.addEventListener("click", () => abrirLicao(licao, true));
        document.body.appendChild(botao);
    }

    function iniciarAjudaContextual() {
        const estado = lerEstado();
        const licao = getLicaoAtual();
        if (!estado.ativo || !licao) return;

        criarBotaoFlutuante(licao);
        if (estado.concluidas.includes(licao.id)) return;

        const chaveSessao = `senso:ajuda-vista:v2:${getUid()}:${licao.id}`;
        let tentativas = 0;

        function tentarAbrir() {
            const estadoAtual = lerEstado();
            if (!estadoAtual.ativo || estadoAtual.concluidas.includes(licao.id)) return;

            try {
                if (sessionStorage.getItem(chaveSessao)) return;
            } catch (_err) {
                // Sem sessionStorage, a orientação ainda pode ser exibida normalmente.
            }

            if (document.querySelector(".senso-assistente-overlay")) {
                tentativas += 1;
                if (tentativas <= 20) setTimeout(tentarAbrir, 600);
                return;
            }

            try {
                // Só registra depois de garantir que nenhum outro aviso impediu a abertura.
                sessionStorage.setItem(chaveSessao, "1");
            } catch (_err) {
                // A ajuda continua funcionando mesmo sem persistência de sessão.
            }
            abrirLicao(licao, false);
        }

        setTimeout(tentarAbrir, 850);
    }

    window.SensoAjuda = {
        imagens: IMAGENS,
        licoes: LICOES,
        lerEstado,
        definirAtivo,
        concluirLicao,
        reiniciar,
        abrirLicao
    };

    window.addEventListener("DOMContentLoaded", iniciarAjudaContextual);
    window.addEventListener("senso-auth-ready", () => setTimeout(iniciarAjudaContextual, 180));
})();
