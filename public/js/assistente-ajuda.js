(function () {
    "use strict";

    const STORAGE_PREFIX = "senso:ajuda-guiada:v1";
    const ROTEIRO_VERSION = 2;
    const CONFETTI_URL = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.4/dist/confetti.browser.min.js";
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
            etapas: [
                {
                    titulo: "Seu painel principal",
                    mensagens: [
                        "Esta é a tela inicial do Senso. Os cartões mostram um resumo rápido da sua operação.",
                        "Toque em qualquer cartão para abrir a área correspondente. Você pode voltar ao Início sempre que quiser."
                    ]
                },
                {
                    titulo: "Clientes e Serviços",
                    mensagens: [
                        "Clientes guarda contatos, veículos, histórico e atalhos para WhatsApp.",
                        "Serviços é onde você seleciona o cliente, registra o trabalho, informa os valores e prepara o orçamento."
                    ],
                    mensagensPrestador: [
                        "Clientes guarda contatos, endereços, histórico de atendimentos e atalhos para WhatsApp.",
                        "Serviços é onde você seleciona o cliente, descreve o atendimento, informa materiais, quantidades e valores e prepara o orçamento."
                    ]
                },
                {
                    titulo: "Orçamentos e Agenda",
                    mensagens: [
                        "Orçamentos reúne propostas enviadas, aprovadas e recusadas. Também permite gerar PDF e enviar pelo WhatsApp.",
                        "Agenda mostra retornos e manutenções cadastrados nos serviços para você não esquecer o cliente."
                    ],
                    mensagensPrestador: [
                        "Orçamentos reúne propostas enviadas, aprovadas e recusadas. Também permite gerar PDF e enviar pelo WhatsApp.",
                        "Agenda mostra retornos e acompanhamentos cadastrados nos atendimentos para você não esquecer o cliente."
                    ]
                },
                {
                    titulo: "Financeiro, Resumo e menu",
                    mensagens: [
                        "Financeiro controla ganhos, gastos e saldo. Resumo mensal apresenta o resultado completo de cada mês.",
                        "Use o menu no alto da tela para acessar Configurações, Assistente de ajuda, planos e outras opções."
                    ]
                }
            ]
        },
        {
            id: "clientes",
            nome: "Clientes",
            href: "/pages/clientes.html",
            paginas: ["clientes.html", "novo-cliente.html"],
            imagem: IMAGENS.instrucoes,
            etapas: [
                {
                    titulo: "Cadastrar um cliente",
                    mensagens: [
                        "Toque em “+ Novo Cliente” para abrir o cadastro.",
                        "Informe pelo menos o nome. Telefone, endereço e documento ajudam no atendimento, no orçamento e no histórico."
                    ]
                },
                {
                    titulo: "Dados do cadastro",
                    mensagens: [
                        "Preencha os telefones com DDD para usar corretamente o atalho do WhatsApp.",
                        "Revise os dados antes de tocar em “Salvar”. Depois, o cliente aparecerá nesta lista."
                    ]
                },
                {
                    titulo: "Dados do veículo",
                    tituloPrestador: "Dados importantes do cliente",
                    mensagens: [
                        "No perfil de mecânica, você também pode registrar modelo, placa, cor e quilometragem do veículo.",
                        "Essas informações acompanham o cliente nos serviços e podem ser atualizadas mais tarde."
                    ],
                    mensagensPrestador: [
                        "No perfil de prestador, confirme endereço, telefones e documento conforme as necessidades do seu atendimento.",
                        "Esses dados acompanham o cliente nos serviços, orçamentos e contatos futuros e podem ser atualizados mais tarde."
                    ]
                },
                {
                    titulo: "WhatsApp e detalhes",
                    imagem: IMAGENS.apontando,
                    mensagens: [
                        "O botão verde “WA” abre uma conversa com o telefone cadastrado.",
                        "Toque em “Ver” para expandir todos os dados e acessar as demais ações daquele cliente."
                    ]
                },
                {
                    titulo: "Editar e consultar histórico",
                    mensagens: [
                        "Use “Editar” para corrigir os dados pessoais e “Editar veículo” para atualizar as informações do automóvel.",
                        "Em “Ver histórico”, você consulta os serviços anteriores, datas, valores e observações do cliente."
                    ],
                    mensagensPrestador: [
                        "Use “Editar” para corrigir nome, telefones, endereço ou documento do cliente.",
                        "Em “Ver histórico”, você consulta os atendimentos anteriores, datas, valores e observações do cliente."
                    ]
                },
                {
                    titulo: "Arquivar com segurança",
                    mensagens: [
                        "Use “Arquivar” quando não quiser mais exibir o cliente entre os ativos.",
                        "Arquivar organiza a lista sem apagar o histórico dos atendimentos que já foram realizados."
                    ]
                }
            ]
        },
        {
            id: "servicos",
            nome: "Serviços",
            href: "/pages/servico.html",
            paginas: ["servico.html"],
            imagem: IMAGENS.instrucoes,
            etapas: [
                {
                    titulo: "Selecionar o cliente",
                    mensagens: [
                        "Comece digitando nome, sobrenome ou telefone no campo de busca e selecione o cliente correto na lista.",
                        "Confira o resumo exibido abaixo. Se o cliente não existir, cadastre-o primeiro na área Clientes."
                    ]
                },
                {
                    titulo: "Conferir o veículo",
                    tituloPrestador: "Conferir o atendimento",
                    mensagens: [
                        "No perfil de mecânica, revise modelo, placa, cor e quilometragem antes de continuar.",
                        "As alterações feitas aqui também podem atualizar o cadastro do veículo do cliente."
                    ],
                    mensagensPrestador: [
                        "Revise o cliente selecionado e confirme telefone e endereço antes de continuar.",
                        "Use o problema relatado para registrar local do serviço, urgência, medidas, acesso e outros detalhes necessários ao atendimento."
                    ]
                },
                {
                    titulo: "Registrar o problema",
                    mensagens: [
                        "Em “Problema relatado pelo cliente”, escreva com clareza o que a pessoa informou antes do atendimento.",
                        "Esse registro cria um pré-atendimento mesmo quando os itens e valores ainda não foram definidos."
                    ],
                    mensagensPrestador: [
                        "Em “Problema relatado pelo cliente”, descreva o pedido, o local, a urgência e as condições informadas antes da visita.",
                        "Esse registro cria um pré-atendimento mesmo quando mão de obra, materiais e valores ainda não foram definidos."
                    ]
                },
                {
                    titulo: "Adicionar itens e valores",
                    mensagens: [
                        "Digite a descrição do serviço ou produto, o valor unitário e a quantidade. Depois toque em “Adicionar Item”.",
                        "Repita o processo para cada item. Use “Editar” ou “Remover” se precisar corrigir a lista."
                    ],
                    mensagensPrestador: [
                        "Digite a descrição da mão de obra, diária, visita ou material, informe o valor unitário e a quantidade e toque em “Adicionar Item”.",
                        "Repita para cada etapa ou material do atendimento. Use “Editar” ou “Remover” para corrigir a lista."
                    ]
                },
                {
                    titulo: "Pagamento e observações",
                    mensagens: [
                        "Use Observações para registrar detalhes importantes, condições ou recomendações do atendimento.",
                        "Selecione a forma de pagamento combinada. Essas informações acompanharão o serviço e o orçamento."
                    ]
                },
                {
                    titulo: "Agendar retorno",
                    mensagens: [
                        "Se o cliente precisar retornar, informe a data em “Retorno / Manutenção”.",
                        "Ao salvar o serviço, esse compromisso aparecerá automaticamente na Agenda. O campo é opcional."
                    ],
                    mensagensPrestador: [
                        "Se precisar voltar ao local ou acompanhar o cliente, informe a data em “Retorno / Manutenção”.",
                        "Ao salvar o serviço, esse compromisso aparecerá automaticamente na Agenda. O campo é opcional."
                    ]
                },
                {
                    titulo: "Salvar e gerar orçamento",
                    imagem: IMAGENS.apontando,
                    mensagens: [
                        "Toque em “Salvar Serviço” somente depois de revisar cliente, itens e valores.",
                        "Na lista de serviços, use “Gerar orçamento” para criar a proposta. Enquanto não for aprovada, você ainda poderá editar o serviço."
                    ],
                    mensagensPrestador: [
                        "Toque em “Salvar Serviço” somente depois de revisar cliente, descrição do atendimento, materiais e valores.",
                        "Na lista de serviços, use “Gerar orçamento” para criar a proposta. Enquanto não for aprovada, você ainda poderá editar o atendimento."
                    ]
                }
            ]
        },
        {
            id: "orcamentos",
            nome: "Orçamentos",
            href: "/pages/orcamentos.html",
            paginas: ["orcamentos.html", "orcamento.html"],
            imagem: IMAGENS.apontando,
            etapas: [
                {
                    titulo: "Encontrar um orçamento",
                    mensagens: [
                        "Esta lista reúne os orçamentos gerados a partir dos serviços.",
                        "Use a busca para localizar pelo cliente e toque no cartão para abrir todos os detalhes."
                    ]
                },
                {
                    titulo: "Filtrar período e situação",
                    mensagens: [
                        "Use “Mês atual” para a rotina recente e “Meses fechados” para consultar períodos anteriores.",
                        "Os filtros Todos, Enviados, Aprovados e Recusados ajudam a encontrar rapidamente cada situação."
                    ]
                },
                {
                    titulo: "Revisar antes de enviar",
                    mensagens: [
                        "Ao abrir o orçamento, confira empresa, cliente, veículo, itens, quantidades, valores e total.",
                        "Se houver informação incorreta, toque em “Editar” antes de enviar ou aprovar."
                    ],
                    mensagensPrestador: [
                        "Ao abrir o orçamento, confira empresa, cliente, serviços, materiais, quantidades, valores, observações e total.",
                        "Se houver informação incorreta, toque em “Editar” antes de enviar ou aprovar."
                    ]
                },
                {
                    titulo: "PDF e WhatsApp",
                    mensagens: [
                        "O botão “PDF” gera o documento para salvar ou imprimir.",
                        "O botão “WhatsApp” prepara o envio ao cliente. Confirme se o telefone cadastrado está correto."
                    ]
                },
                {
                    titulo: "Aprovar ou recusar",
                    mensagens: [
                        "Use “Aprovar” quando o cliente aceitar a proposta. O serviço e o financeiro serão atualizados conforme as regras do app.",
                        "Use “Recusar” somente quando a proposta não for aceita. Revise antes, pois o status ficará registrado."
                    ]
                },
                {
                    titulo: "Gastos relacionados",
                    mensagens: [
                        "Depois da aprovação, o assistente pergunta se houve algum gasto relacionado ao serviço.",
                        "Registre peças, materiais ou outras despesas no Financeiro para o lucro e o resumo mensal ficarem corretos."
                    ],
                    mensagensPrestador: [
                        "Depois da aprovação, o assistente pergunta se houve algum gasto relacionado ao atendimento.",
                        "Registre materiais, deslocamento, alimentação, taxas ou outras despesas para o lucro e o resumo mensal ficarem corretos."
                    ]
                }
            ]
        },
        {
            id: "agenda",
            nome: "Agenda",
            href: "/pages/agenda.html",
            paginas: ["agenda.html"],
            imagem: IMAGENS.apontando,
            etapas: [
                {
                    titulo: "Como os retornos chegam aqui",
                    mensagens: [
                        "A Agenda recebe as datas de Retorno / Manutenção informadas ao salvar um serviço.",
                        "Cada cartão mostra o cliente, o telefone e a data prevista para o novo contato."
                    ],
                    mensagensPrestador: [
                        "A Agenda recebe as datas de retorno ou acompanhamento informadas ao salvar um atendimento.",
                        "Cada cartão mostra o cliente, o telefone e a data prevista para o novo contato ou visita."
                    ]
                },
                {
                    titulo: "Filtrar por mês",
                    mensagens: [
                        "Use o seletor de mês para mostrar somente os retornos do período desejado.",
                        "Escolha “Todos os meses” quando precisar localizar compromissos antigos ou futuros."
                    ]
                },
                {
                    titulo: "Entrar em contato",
                    mensagens: [
                        "Toque no botão do WhatsApp para falar com o cliente usando o telefone cadastrado.",
                        "Use “Ver” para abrir os detalhes do retorno e conferir as informações antes do contato."
                    ]
                },
                {
                    titulo: "Remarcar uma data",
                    mensagens: [
                        "Toque em “Editar”, escolha a nova data e depois toque em “Salvar”.",
                        "Use “Cancelar” se não quiser manter a alteração. A nova data substituirá a anterior."
                    ]
                },
                {
                    titulo: "Arquivar um retorno",
                    mensagens: [
                        "Depois de concluir o contato ou quando o lembrete não for mais necessário, use o botão de arquivar.",
                        "Confirme a ação somente quando tiver certeza, para manter a Agenda limpa e atualizada."
                    ]
                }
            ]
        },
        {
            id: "financeiro",
            nome: "Financeiro",
            href: "/pages/financeiro.html",
            paginas: ["financeiro.html"],
            imagem: IMAGENS.instrucoes,
            etapas: [
                {
                    titulo: "Entender o saldo",
                    mensagens: [
                        "O cartão principal mostra o saldo do período selecionado: entradas menos saídas.",
                        "Escolha o mês desejado e use Mês atual ou Meses fechados para navegar entre os períodos."
                    ]
                },
                {
                    titulo: "Recebimentos de serviços",
                    mensagens: [
                        "Quando um orçamento é aprovado, o valor do serviço pode entrar automaticamente no Financeiro.",
                        "Evite lançar o mesmo recebimento novamente para não duplicar o saldo."
                    ]
                },
                {
                    titulo: "Adicionar um ganho manual",
                    mensagens: [
                        "Use o campo de ganho para registrar uma entrada que não veio de um orçamento aprovado.",
                        "Informe uma descrição clara e o valor correto antes de tocar no botão de adicionar ganho."
                    ]
                },
                {
                    titulo: "Adicionar um gasto",
                    mensagens: [
                        "Em “Novo gasto”, descreva a despesa e informe o valor pago.",
                        "Registre peças, materiais, taxas e outros custos para o saldo representar a realidade."
                    ],
                    mensagensPrestador: [
                        "Em “Novo gasto”, descreva a despesa e informe o valor pago.",
                        "Registre materiais, deslocamentos, alimentação, taxas, ajudantes e outros custos para o saldo representar a realidade."
                    ]
                },
                {
                    titulo: "Consultar o extrato",
                    mensagens: [
                        "Toque em “Extrato” para ver todas as movimentações do mês, com entradas e saídas separadas.",
                        "Confira a descrição e o valor de cada lançamento. Use a lixeira apenas para remover um registro incorreto."
                    ]
                },
                {
                    titulo: "Manter o caixa correto",
                    mensagens: [
                        "Sempre selecione o mês certo antes de analisar valores ou lançar movimentações.",
                        "O Financeiro alimenta o Resumo mensal; por isso, lançamentos duplicados ou esquecidos alteram o resultado."
                    ]
                }
            ]
        },
        {
            id: "resumo",
            nome: "Resumo mensal",
            href: "/pages/resumo.html",
            paginas: ["resumo.html"],
            imagem: IMAGENS.apontando,
            etapas: [
                {
                    titulo: "Selecionar o mês",
                    mensagens: [
                        "Comece escolhendo o mês que deseja analisar no seletor do topo.",
                        "Todos os valores e listas da tela serão recalculados para o período selecionado."
                    ]
                },
                {
                    titulo: "Receitas, gastos e saldo",
                    mensagens: [
                        "Receitas representam as entradas do período e Gastos mostram as despesas registradas.",
                        "O saldo é a diferença entre esses valores e ajuda a entender o resultado do mês."
                    ]
                },
                {
                    titulo: "Abrir os detalhes",
                    mensagens: [
                        "Toque nas seções expansíveis para ver serviços, gastos e correções que formaram os totais.",
                        "Use os detalhes para localizar valores ausentes, duplicados ou lançados de maneira incorreta."
                    ]
                },
                {
                    titulo: "Comparar resultados",
                    mensagens: [
                        "A comparação mostra como o mês selecionado se comportou em relação ao período anterior.",
                        "Analise junto com o número de serviços e as despesas; faturamento maior nem sempre significa lucro maior."
                    ]
                },
                {
                    titulo: "Cuidado ao apagar",
                    mensagens: [
                        "O botão “Apagar resumo” remove somente os dados de correções do resumo após sua confirmação.",
                        "Use essa opção apenas quando souber exatamente o que precisa limpar. Para corrigir lançamentos, prefira o Financeiro."
                    ]
                }
            ]
        }
    ]);

    let confettiCarregando = null;

    function getPerfilAtivoId() {
        const perfilId = window.SensoProfile?.getActiveProfile?.()?.id;
        return perfilId === "prestador" ? "prestador" : "mecanica";
    }

    function getUid() {
        const firebaseUid = window.firebase?.apps?.length
            ? window.firebase.auth().currentUser?.uid
            : null;
        return window.SensoAuth?.uid || firebaseUid || "usuario";
    }

    function getStorageKey() {
        return `${STORAGE_PREFIX}:${getUid()}:${getPerfilAtivoId()}`;
    }

    function estadoPadrao() {
        return {
            ativo: true,
            concluidas: [],
            roteiroVersion: ROTEIRO_VERSION,
            atualizadoEm: new Date().toISOString()
        };
    }

    function lerEstado() {
        try {
            const salvoAtual = JSON.parse(localStorage.getItem(getStorageKey()) || "null");
            const salvoLegado = salvoAtual
                ? null
                : JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}:${getUid()}`) || "null");
            const salvo = salvoAtual || salvoLegado;
            if (!salvo || typeof salvo !== "object") return estadoPadrao();
            const roteiroAtual = Number(salvo.roteiroVersion) === ROTEIRO_VERSION;
            return {
                ativo: salvo.ativo !== false,
                concluidas: salvoAtual && roteiroAtual && Array.isArray(salvo.concluidas)
                    ? salvo.concluidas.filter(id => LICOES.some(licao => licao.id === id))
                    : [],
                roteiroVersion: ROTEIRO_VERSION,
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
            roteiroVersion: ROTEIRO_VERSION,
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
        const pagina = partes.at(-1) || "";
        // A produção usa cleanUrls (ex.: /pages/clientes), enquanto o desenvolvimento
        // pode manter o nome completo (ex.: /pages/clientes.html).
        return pagina && !pagina.includes(".") ? `${pagina}.html` : pagina;
    }

    function getLicaoAtual() {
        const pagina = getPaginaAtual();
        return LICOES.find(licao => licao.paginas.includes(pagina)) || null;
    }

    function carregarConfetti() {
        if (typeof window.confetti === "function") return Promise.resolve(window.confetti);
        if (confettiCarregando) return confettiCarregando;

        confettiCarregando = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = CONFETTI_URL;
            script.async = true;
            script.crossOrigin = "anonymous";
            script.addEventListener("load", () => {
                if (typeof window.confetti === "function") {
                    resolve(window.confetti);
                    return;
                }
                reject(new Error("canvas-confetti não ficou disponível."));
            }, { once: true });
            script.addEventListener("error", () => reject(new Error("Falha ao carregar canvas-confetti.")), { once: true });
            document.head.appendChild(script);
        }).catch(error => {
            confettiCarregando = null;
            throw error;
        });

        return confettiCarregando;
    }

    function celebrarConclusao() {
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

        carregarConfetti().then(confetti => {
            const cores = ["#0f9d58", "#55d67e", "#facc15", "#ffffff"];
            const duracao = 2000;
            const inicio = Date.now();

            confetti({
                particleCount: 90,
                spread: 78,
                startVelocity: 42,
                origin: { x: .5, y: .68 },
                colors: cores,
                zIndex: 11000,
                disableForReducedMotion: true
            });

            const chuva = window.setInterval(() => {
                const tempoDecorrido = Date.now() - inicio;
                if (tempoDecorrido >= duracao) {
                    window.clearInterval(chuva);
                    return;
                }

                confetti({
                    particleCount: 7,
                    angle: 270,
                    spread: 45,
                    startVelocity: 12,
                    gravity: .75,
                    scalar: .9,
                    ticks: 180,
                    origin: { x: .08 + Math.random() * .84, y: -.05 },
                    colors: cores,
                    zIndex: 11000,
                    disableForReducedMotion: true
                });
            }, 120);
        }).catch(() => {
            // A comemoração visual nunca deve impedir a conclusão do aprendizado.
        });
    }

    function abrirConclusao() {
        celebrarConclusao();
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
        const etapas = Array.isArray(licao.etapas) && licao.etapas.length
            ? licao.etapas
            : [{ titulo: licao.nome, mensagens: licao.mensagens || [], imagem: licao.imagem }];

        function abrirEtapa(indice) {
            const etapa = etapas[indice];
            const ultimaEtapa = indice === etapas.length - 1;
            const acoes = [];
            const perfilId = getPerfilAtivoId();
            const tituloEtapa = perfilId === "prestador"
                ? (etapa.tituloPrestador || etapa.titulo)
                : (etapa.tituloMecanica || etapa.titulo);
            const mensagensEtapa = perfilId === "prestador"
                ? (etapa.mensagensPrestador || etapa.mensagens || [])
                : (etapa.mensagensMecanica || etapa.mensagens || []);

            if (!ultimaEtapa) {
                acoes.push({
                    texto: "Avançar",
                    estilo: "primaria",
                    aoClicar: () => abrirEtapa(indice + 1)
                });
            } else if (!jaConcluida) {
                acoes.push({
                    texto: "Concluir esta área",
                    estilo: "primaria",
                    aoClicar: ({ fechar }) => {
                        const novoEstado = concluirLicao(licao.id);
                        fechar("licao-concluida");
                        if (novoEstado.concluidas.length >= LICOES.length) {
                            setTimeout(abrirConclusao, 260);
                        }
                    }
                });
            } else {
                acoes.push({
                    texto: "Finalizar revisão",
                    estilo: "primaria",
                    aoClicar: ({ fechar }) => fechar("revisao-concluida")
                });
            }

            if (indice > 0) {
                acoes.push({
                    texto: "Voltar",
                    estilo: "sutil",
                    aoClicar: () => abrirEtapa(indice - 1)
                });
            }

            acoes.push({
                texto: manual ? "Fechar ajuda" : "Continuar depois",
                estilo: "sutil",
                aoClicar: ({ fechar }) => fechar(manual ? "fechar" : "depois")
            });

            window.AssistenteSenso.abrir({
                titulo: `Ajuda • ${licao.nome} • ${indice + 1}/${etapas.length}`,
                imagem: etapa.imagem || licao.imagem,
                mensagens: [tituloEtapa, ...mensagensEtapa],
                acoes
            });
        }

        abrirEtapa(0);
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

        const chaveSessao = `senso:ajuda-vista:v4:${getUid()}:${getPerfilAtivoId()}:${licao.id}`;
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
        abrirLicao,
        celebrarConclusao
    };

    window.addEventListener("DOMContentLoaded", iniciarAjudaContextual);
    window.addEventListener("senso-auth-ready", () => setTimeout(iniciarAjudaContextual, 180));
})();
