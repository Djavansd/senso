(function () {
    "use strict";

    const contextScriptUrl = document.currentScript?.src || "";

    function getMascoteUrl(fileName) {
        if (contextScriptUrl) {
            return new URL(`../assets/assistente-senso/${fileName}`, contextScriptUrl).href;
        }

        return `/assets/assistente-senso/${fileName}`;
    }

    const MASCOTES = Object.freeze({
        boasVindas: getMascoteUrl("boas-vindas.png"),
        pagamentoVencido: getMascoteUrl("pagamento-vencido.png"),
        pagamentoTresDias: getMascoteUrl("pagamento-vence-em-3-dias.png"),
        manutencao: getMascoteUrl("lembrete-manutencao.png"),
        testeGratisEncerrado: getMascoteUrl("teste-gratis-encerrado.png"),
        planoAtivado: getMascoteUrl("plano-ativado.png")
    });

    let exibidoNestaEntrada = false;
    let modalLimiteGratisAberto = false;
    let confirmacaoPlanoGratis = null;
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
        const planState = window.SensoPlans?.state;
        const loadingPlano = planState?.loading === true;
        if (
            loadingPlano
            || !planState?.ready
            || planState?.error
            || plano?.plano !== "gratis"
            || typeof window.getData !== "function"
        ) return false;

        const data = window.getData();
        const limites = window.SensoPlans.getUsageLimits?.(plano)
            || window.SensoPlans.freeLimits
            || { clientes: 5, orcamentos: 10 };
        const clientes = (data.clientes || []).filter(cliente => !cliente?.arquivado).length;
        const orcamentos = (data.orcamentos || []).length;
        const clientesEsgotados = Number.isFinite(Number(limites.clientes)) && clientes >= Number(limites.clientes);
        const orcamentosEsgotados = Number.isFinite(Number(limites.orcamentos)) && orcamentos >= Number(limites.orcamentos);
        if (!clientesEsgotados && !orcamentosEsgotados) return false;

        const limiteAtingido = clientesEsgotados
            ? `${limites.clientes} clientes ativos`
            : `${limites.orcamentos} orçamentos`;

        const abriu = abrirUmaVez({
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
            ],
            aoFechar: () => {
                modalLimiteGratisAberto = false;
            }
        }, getChave("teste-gratis-esgotado"), "mostrado");

        if (abriu) modalLimiteGratisAberto = true;
        return abriu;
    }

    function getNomePlano(planoId) {
        return planoId === "pro" ? "Plano Pro" : "Plano Básico";
    }

    function getValidadeMillis(value) {
        if (!value) return 0;
        if (typeof value?.toMillis === "function") return value.toMillis();
        if (typeof value?.toDate === "function") return value.toDate().getTime();
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }

    function registrarMudancaPlano(plano) {
        const planoAtual = plano?.plano === "pro"
            ? "pro"
            : plano?.plano === "basico"
                ? "basico"
                : "gratis";
        const chaveUltimoPlano = getChave("ultimo-plano");
        const chavePlanoAtivado = getChave("plano-ativado-pendente");
        const chaveUltimaValidade = getChave("ultima-validade");
        const chavePagamentoConfirmado = getChave("pagamento-confirmado-pendente");
        const planoAnterior = lerValor(chaveUltimoPlano);
        const validadeAtual = getValidadeMillis(plano?.validade);
        const validadeAnterior = Number(lerValor(chaveUltimaValidade) || 0);

        if (
            planoAnterior === planoAtual
            && lerValor(chavePlanoAtivado) === planoAtual
        ) {
            removerValor(chavePlanoAtivado);
        }

        if (
            planoAnterior === "gratis"
            && planoAtual !== "gratis"
            && plano?.status !== "bloqueado"
        ) {
            marcarVisto(chavePlanoAtivado, planoAtual);
        }

        if (
            planoAtual !== "gratis"
            && plano?.status !== "bloqueado"
            && validadeAnterior > 0
            && validadeAtual > validadeAnterior + 60000
        ) {
            marcarVisto(chavePagamentoConfirmado, String(validadeAtual));
        }

        marcarVisto(chaveUltimoPlano, planoAtual);
        if (validadeAtual > 0) marcarVisto(chaveUltimaValidade, String(validadeAtual));
    }

    function mostrarPagamentoConfirmado(plano) {
        const validade = getValidadeMillis(plano?.validade);
        const chavePendente = getChave("pagamento-confirmado-pendente");
        if (!validade || lerValor(chavePendente) !== String(validade)) return false;

        exibidoNestaEntrada = true;
        removerValor(chavePendente);
        const vencimento = new Date(validade).toLocaleDateString("pt-BR");
        window.AssistenteSenso.abrir({
            imagem: MASCOTES.planoAtivado,
            mensagens: [
                "Pagamento confirmado!",
                "Seu plano foi renovado com sucesso.",
                `Próximo vencimento: ${vencimento}.`
            ],
            acoes: [{
                texto: "Continuar",
                estilo: "primaria",
                aoClicar: ({ fechar }) => fechar("pagamento-confirmado")
            }]
        });
        return true;
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

    function aguardar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function reconfirmarPlanoAposGratis(uid) {
        if (!uid) return null;
        if (confirmacaoPlanoGratis?.uid === uid) return confirmacaoPlanoGratis.promise;

        const promise = (async () => {
            await window.SensoPlans.ensureUserPlan?.(uid);
            await aguardar(900);
            await window.SensoPlans.ensureUserPlan?.(uid);

            const state = window.SensoPlans.state;
            if (state.loading || !state.ready || state.error || state.uid !== uid) return null;
            return window.SensoPlans.getCurrentPlan?.() || null;
        })();

        confirmacaoPlanoGratis = { uid, promise };
        try {
            return await promise;
        } finally {
            if (confirmacaoPlanoGratis?.promise === promise) {
                confirmacaoPlanoGratis = null;
            }
        }
    }

    async function tentarExibir() {
        if (!window.AssistenteSenso || !window.SensoPlans) return;

        const uid = window.SensoAuth?.uid || window.firebase?.auth?.()?.currentUser?.uid;
        const planState = window.SensoPlans.state;
        if (uid && (!planState.ready || planState.uid !== uid)) {
            await window.SensoPlans.ensureUserPlan?.(uid);
        }

        const loadingPlano = planState.loading === true;
        if (loadingPlano || !planState.ready || planState.error || planState.uid !== uid) return;

        let plano = window.SensoPlans.getCurrentPlan?.() || {};
        if (plano.plano === "gratis") {
            plano = await reconfirmarPlanoAposGratis(uid);
            if (!plano) return;
        }

        const status = window.SensoPlans.getPaymentStatus?.(plano) || {};
        registrarMudancaPlano(plano);
        if (exibidoNestaEntrada) return;

        if (mostrarPlanoAtivado(plano)) return;
        if (mostrarPagamentoConfirmado(plano)) return;

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
        const plano = event?.detail?.plan || {};
        if (plano.plano !== "gratis" && modalLimiteGratisAberto) {
            modalLimiteGratisAberto = false;
            exibidoNestaEntrada = false;
            window.AssistenteSenso?.fechar?.("plano-pago-confirmado");
        }

        if (confirmacaoPlanoGratis) return;
        agendarTentativa();
    });
    window.addEventListener("senso-live-update", agendarTentativa);
    agendarTentativa();
})();
