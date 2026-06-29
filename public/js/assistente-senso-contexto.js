(function () {
    "use strict";

    const MASCOTES = Object.freeze({
        boasVindas: "/assets/assistente-senso/boas-vindas.png",
        pagamentoVencido: "/assets/assistente-senso/pagamento-vencido.png",
        pagamentoTresDias: "/assets/assistente-senso/pagamento-vence-em-3-dias.png",
        manutencao: "/assets/assistente-senso/lembrete-manutencao.png",
        testeGratisEncerrado: "/assets/assistente-senso/teste-gratis-encerrado.png",
        planoAtivado: "/assets/assistente-senso/plano-ativado.png"
    });

    let exibidoNestaEntrada = false;
    let timer = null;

    function getUid() {
        return window.SensoAuth?.uid
            || window.firebase?.auth?.()?.currentUser?.uid
            || "usuario";
    }

    function getDiaLocal() {
        const hoje = new Date();
        return [
            hoje.getFullYear(),
            String(hoje.getMonth() + 1).padStart(2, "0"),
            String(hoje.getDate()).padStart(2, "0")
        ].join("-");
    }

    function getChave(sufixo) {
        return `senso:assistente:${sufixo}:${getUid()}`;
    }

    function jaVisto(chave, valor) {
        try {
            return localStorage.getItem(chave) === valor;
        } catch (_err) {
            return false;
        }
    }

    function marcarVisto(chave, valor) {
        try {
            localStorage.setItem(chave, valor);
        } catch (_err) {
            // O assistente nunca deve bloquear o app por indisponibilidade do storage.
        }
    }

    function lerValor(chave) {
        try {
            return localStorage.getItem(chave) || "";
        } catch (_err) {
            return "";
        }
    }

    function removerValor(chave) {
        try {
            localStorage.removeItem(chave);
        } catch (_err) {
            // O assistente nunca deve bloquear o app por indisponibilidade do storage.
        }
    }

    function abrirUmaVez(opcoes, chave, valor) {
        if (exibidoNestaEntrada || jaVisto(chave, valor)) return false;
        exibidoNestaEntrada = true;
        marcarVisto(chave, valor);
        window.AssistenteSenso.abrir(opcoes);
        return true;
    }

    function estaNaPaginaPagamento() {
        return window.location.pathname.toLowerCase().includes("pagamento-app");
    }

    function temPlanoMensalContratado(plano) {
        const planoPago = plano?.plano === "basico" || plano?.plano === "pro";
        const pagamentoMensal = String(plano?.tipoPagamento || "mensal") === "mensal";
        const preco = Number(plano?.precoContratado);
        const possuiContratacao = !!(
            plano?.dataContratacao
            || plano?.tipoPlano
            || (Number.isFinite(preco) && preco > 0)
        );
        return planoPago && pagamentoMensal && possuiContratacao;
    }

    function mostrarPagamentoVencido(plano, status) {
        if (!temPlanoMensalContratado(plano)) return false;
        const vencido = plano?.status === "bloqueado" || status?.daysOverdue > 0 || status?.shouldBlock;
        if (!vencido) return false;

        const dias = Number(status?.daysOverdue || 0);
        const mensagem = dias > 0
            ? `Sua mensalidade está vencida há ${dias} dia(s).`
            : "Seu acesso está com uma mensalidade pendente.";

        return abrirUmaVez({
            imagem: MASCOTES.pagamentoVencido,
            mensagens: [
                "Atenção!",
                mensagem,
                "Regularize o pagamento para continuar usando o Senso normalmente."
            ],
            acoes: estaNaPaginaPagamento() ? [] : [
                {
                    texto: "Ver pagamento",
                    estilo: "primaria",
                    aoClicar: () => {
                        window.location.href = "/pages/pagamento-app.html";
                    }
                },
                {
                    texto: "Agora não",
                    estilo: "sutil",
                    aoClicar: ({ fechar }) => fechar("depois")
                }
            ]
        }, getChave("pagamento-vencido"), getDiaLocal());
    }

    function mostrarPagamentoTresDias(plano, status) {
        if (!temPlanoMensalContratado(plano)) return false;
        const dias = Number(status?.daysUntilDue);
        if (!Number.isFinite(dias) || dias < 0 || dias > 3) return false;

        const prazo = dias === 0
            ? "Sua mensalidade vence hoje."
            : dias === 1
                ? "Sua mensalidade vence amanhã."
                : `Faltam ${dias} dias para o vencimento da sua mensalidade.`;

        return abrirUmaVez({
            imagem: MASCOTES.pagamentoTresDias,
            mensagens: [
                "Lembrete amigável!",
                prazo,
                "Assim você mantém seu acesso funcionando sem interrupções."
            ],
            acoes: [
                {
                    texto: "Ver pagamento",
                    estilo: "primaria",
                    aoClicar: () => {
                        window.location.href = "/pages/pagamento-app.html";
                    }
                },
                {
                    texto: "Entendi",
                    estilo: "sutil",
                    aoClicar: ({ fechar }) => fechar("entendi")
                }
            ]
        }, getChave("pagamento-proximo"), getDiaLocal());
    }

    function mostrarTesteGratisEsgotado(plano) {
        if (plano?.plano !== "gratis" || typeof window.getData !== "function") return false;

        const data = window.getData();
        const limites = window.SensoPlans.getUsageLimits?.(plano)
            || window.SensoPlans.freeLimits
            || { clientes: 5, servicos: 10 };
        const clientes = (data.clientes || []).filter(cliente => !cliente?.arquivado).length;
        const servicos = (data.servicos || []).length;
        const clientesEsgotados = Number.isFinite(Number(limites.clientes)) && clientes >= Number(limites.clientes);
        const servicosEsgotados = Number.isFinite(Number(limites.servicos)) && servicos >= Number(limites.servicos);
        if (!clientesEsgotados && !servicosEsgotados) return false;

        const limiteAtingido = clientesEsgotados
            ? `${limites.clientes} clientes ativos`
            : `${limites.servicos} serviços`;

        return abrirUmaVez({
            imagem: MASCOTES.testeGratisEncerrado,
            mensagens: [
                "Você concluiu seu teste grátis!",
                `O limite de ${limiteAtingido} foi atingido.`,
                "Fique tranquilo: tudo o que você cadastrou continua salvo.",
                "Conheça o Plano Pro para continuar usando todos os recursos do Senso."
            ],
            acoes: [
                {
                    texto: "Ver planos",
                    estilo: "primaria",
                    aoClicar: () => {
                        window.location.href = "/pages/pagamento-app.html";
                    }
                },
                {
                    texto: "Depois",
                    estilo: "sutil",
                    aoClicar: ({ fechar }) => fechar("depois")
                }
            ]
        }, getChave("teste-gratis-esgotado"), "mostrado");
    }

    function getNomePlano(planoId) {
        return planoId === "pro" ? "Plano Pro" : "Plano Básico";
    }

    function registrarMudancaPlano(plano) {
        const planoAtual = plano?.plano === "pro"
            ? "pro"
            : plano?.plano === "basico"
                ? "basico"
                : "gratis";
        const chaveUltimoPlano = getChave("ultimo-plano");
        const planoAnterior = lerValor(chaveUltimoPlano);

        if (
            planoAnterior === "gratis"
            && planoAtual !== "gratis"
            && plano?.status !== "bloqueado"
        ) {
            marcarVisto(getChave("plano-ativado-pendente"), planoAtual);
        }

        marcarVisto(chaveUltimoPlano, planoAtual);
    }

    function mostrarPlanoAtivado(plano) {
        const planoAtual = plano?.plano === "pro"
            ? "pro"
            : plano?.plano === "basico"
                ? "basico"
                : "gratis";
        const chavePendente = getChave("plano-ativado-pendente");
        if (
            planoAtual === "gratis"
            || plano?.status === "bloqueado"
            || lerValor(chavePendente) !== planoAtual
        ) return false;

        exibidoNestaEntrada = true;
        removerValor(chavePendente);
        window.AssistenteSenso.abrir({
            imagem: MASCOTES.planoAtivado,
            mensagens: [
                `${getNomePlano(planoAtual)} ativado!`,
                "Que ótima notícia! Seus dados do teste continuam aqui, exatamente como você deixou.",
                "Agora você pode continuar aproveitando o Senso."
            ],
            acoes: [{
                texto: "Continuar",
                estilo: "primaria",
                aoClicar: ({ fechar }) => fechar("continuar")
            }]
        });
        return true;
    }

    function mostrarBoasVindas() {
        // O novo aprendizado guiado controla as orientações e o progresso por área.
        if (window.SensoAjuda) return false;
        if (typeof window.getData !== "function") return false;

        const data = window.getData();
        const possuiUso = ["clientes", "servicos", "orcamentos", "financeiro"]
            .some(campo => Array.isArray(data?.[campo]) && data[campo].length > 0);
        const chave = getChave("boas-vindas-v2");
        const progressoSalvo = lerValor(chave);
        const tourEmAndamento = /^\d+$/.test(progressoSalvo);
        if (progressoSalvo === "concluido" || (possuiUso && !tourEmAndamento)) return false;

        exibidoNestaEntrada = true;

        const etapas = [
            [
                "Bem-vindo ao Senso!",
                "Vou apresentar as principais áreas do app. É rápido e você pode fechar quando quiser."
            ],
            [
                "Clientes",
                "Aqui você cadastra os dados de cada cliente e consulta o histórico dos serviços realizados."
            ],
            [
                "Serviços",
                "Registre o trabalho, os itens e os valores. Depois, gere o orçamento para aprovação."
            ],
            [
                "Financeiro",
                "Serviços aprovados entram automaticamente como recebimento. Você também registra ganhos e gastos."
            ],
            [
                "Resumo",
                "Acompanhe receitas, gastos, saldo e os resultados de cada mês em um só lugar."
            ],
            [
                "Lembretes",
                "A Agenda avisa quando chega a data de retorno ou manutenção de um cliente."
            ],
            [
                "Tudo pronto!",
                "Agora você já conhece o caminho principal do Senso. Eu continuarei ajudando nos momentos importantes."
            ]
        ];

        function abrirEtapa(indice) {
            const ultima = indice === etapas.length - 1;
            marcarVisto(chave, String(indice));
            const acoes = [{
                texto: ultima ? "Finalizar" : "Avançar",
                estilo: "primaria",
                aoClicar: ({ fechar }) => {
                    if (ultima) {
                        marcarVisto(chave, "concluido");
                        fechar("concluido");
                        return;
                    }
                    abrirEtapa(indice + 1);
                }
            }];

            if (indice > 0) {
                acoes.push({
                    texto: "Voltar",
                    estilo: "sutil",
                    aoClicar: () => abrirEtapa(indice - 1)
                });
            }

            window.AssistenteSenso.abrir({
                titulo: `Assistente Senso • ${indice + 1}/${etapas.length}`,
                imagem: MASCOTES.boasVindas,
                mensagens: etapas[indice],
                acoes
            });
        }

        const etapaInicial = tourEmAndamento
            ? Math.min(Number(progressoSalvo), etapas.length - 1)
            : 0;
        abrirEtapa(etapaInicial);
        return true;
    }

    function mostrarManutencao() {
        if (typeof window.getData !== "function") return false;

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const pendencias = (window.getData().agenda || []).filter(item => {
            if (item?.status !== "agendado" || !item?.dataRetorno) return false;
            const retorno = new Date(item.dataRetorno);
            if (Number.isNaN(retorno.getTime())) return false;
            retorno.setHours(0, 0, 0, 0);
            return retorno <= hoje;
        });
        if (!pendencias.length) return false;

        const quantidade = pendencias.length;
        return abrirUmaVez({
            imagem: MASCOTES.manutencao,
            mensagens: [
                "Lembrete de manutenção!",
                quantidade === 1
                    ? "Você tem um retorno de serviço para verificar."
                    : `Você tem ${quantidade} retornos de serviço para verificar.`
            ],
            acoes: [
                {
                    texto: "Ver agenda",
                    estilo: "primaria",
                    aoClicar: () => {
                        window.location.href = "/pages/agenda.html";
                    }
                },
                {
                    texto: "Depois",
                    estilo: "sutil",
                    aoClicar: ({ fechar }) => fechar("depois")
                }
            ]
        }, getChave("manutencao"), getDiaLocal());
    }

    function tentarExibir() {
        if (!window.AssistenteSenso || !window.SensoPlans?.state?.ready) return;

        const plano = window.SensoPlans.getCurrentPlan?.() || {};
        const status = window.SensoPlans.getPaymentStatus?.(plano) || {};
        registrarMudancaPlano(plano);
        if (exibidoNestaEntrada) return;

        if (mostrarPlanoAtivado(plano)) return;

        if (estaNaPaginaPagamento()) {
            mostrarPagamentoVencido(plano, status);
            return;
        }

        if (mostrarBoasVindas()) return;
        if (mostrarPagamentoVencido(plano, status)) return;
        if (mostrarPagamentoTresDias(plano, status)) return;
        if (mostrarTesteGratisEsgotado(plano)) return;
        mostrarManutencao();
    }

    function agendarTentativa() {
        clearTimeout(timer);
        timer = setTimeout(tentarExibir, 650);
    }

    window.addEventListener("DOMContentLoaded", agendarTentativa);
    window.addEventListener("senso-auth-ready", agendarTentativa);
    window.addEventListener("senso-plan-ready", event => {
        registrarMudancaPlano(event?.detail?.plan || {});
        agendarTentativa();
    });
    window.addEventListener("senso-live-update", agendarTentativa);
    agendarTentativa();
})();
