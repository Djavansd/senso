(function () {
    "use strict";

    const dashboardEl = document.getElementById("desktopDashboard");
    const accessGateEl = document.getElementById("desktopAccessGate");
    const planBadgeEl = document.getElementById("desktopPlanBadge");
    const userNameEl = document.getElementById("desktopUserName");
    const signOutBtn = document.getElementById("desktopSignOut");
    let desktopDataUnsubscribe = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const el = byId(id);
        if (el) el.textContent = value;
    }

    function safeHtml(value) {
        if (typeof window.escapeHtml === "function") return window.escapeHtml(value);
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function getAppData() {
        if (typeof window.getData === "function") return window.getData();
        return {
            clientes: [],
            servicos: [],
            agenda: [],
            financeiro: [],
            orcamentos: []
        };
    }

    function getActiveProfileId() {
        return window.SensoProfile?.getActiveProfile?.()?.id || "mecanica";
    }

    function isMecanicaProfile() {
        return getActiveProfileId() === "mecanica";
    }

    function getServicePanelLabels() {
        return isMecanicaProfile()
            ? {
                title: "Carros em atendimento",
                subtitle: "Ficam aqui até o serviço ser liberado.",
                empty: "Nenhum carro em atendimento agora."
            }
            : {
                title: "Serviços em atendimento",
                subtitle: "Serviços pendentes que ainda precisam ser finalizados.",
                empty: "Nenhum serviço em atendimento agora."
            };
    }

    function applyProfileLabels() {
        const labels = getServicePanelLabels();
        setText("servicosPanelTitle", labels.title);
        setText("servicosPanelSubtitle", labels.subtitle);
    }

    function getDesktopStorageKey(uid) {
        const profileId = getActiveProfileId();
        return uid ? `appData:${profileId}:uid:${uid}` : `appData:${profileId}:anon`;
    }

    function normalizeCloudData(input) {
        const data = input && typeof input === "object" ? input : {};
        data.clientes ||= [];
        data.servicos ||= [];
        data.agenda ||= [];
        data.financeiro ||= [];
        data.orcamentos ||= [];
        data.correcoes ||= [];
        data.updatedAt = Number(data.updatedAt || 0);
        return data;
    }

    function startDesktopDataListener() {
        const uid = window.SensoAuth?.uid || window.firebase?.auth?.()?.currentUser?.uid;
        if (!uid || !window.firebase?.firestore) return;
        if (desktopDataUnsubscribe) return;

        const profileId = getActiveProfileId();
        const storageKey = getDesktopStorageKey(uid);
        const docRef = window.firebase
            .firestore()
            .collection("users")
            .doc(uid)
            .collection("appData")
            .doc(profileId);

        desktopDataUnsubscribe = docRef.onSnapshot(snapshot => {
            if (!snapshot.exists) return;

            const payload = snapshot.data() || {};
            const cloudData = normalizeCloudData(payload.data || null);
            const cloudUpdatedAt = Number(payload.updatedAt || cloudData.updatedAt || 0);

            let localUpdatedAt = 0;
            try {
                const localData = JSON.parse(localStorage.getItem(storageKey) || "null");
                localUpdatedAt = Number(localData?.updatedAt || 0);
            } catch (_err) {
                localUpdatedAt = 0;
            }

            if (cloudUpdatedAt < localUpdatedAt) return;

            const nextData = {
                ...cloudData,
                updatedAt: cloudUpdatedAt || Date.now()
            };

            localStorage.setItem(storageKey, JSON.stringify(nextData));
            window.dispatchEvent(new CustomEvent("senso-live-update", {
                detail: {
                    source: "desktop-cloud-listener",
                    ts: Date.now()
                }
            }));
        }, err => {
            console.warn("Nao foi possivel acompanhar os dados em tempo real no modo PC.", err);
        });
    }

    function formatMoney(value) {
        return `R$ ${Number(value || 0).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }

    function normalizeDate(value) {
        if (!value) return null;
        const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    }

    function formatDate(value) {
        const date = normalizeDate(value);
        return date ? date.toLocaleDateString("pt-BR") : "-";
    }

    function getMonthRange() {
        const now = new Date();
        return {
            month: now.getMonth(),
            year: now.getFullYear()
        };
    }

    function isCurrentMonth(value) {
        const date = normalizeDate(value);
        if (!date) return false;
        const current = getMonthRange();
        return date.getMonth() === current.month && date.getFullYear() === current.year;
    }

    function getServiceDate(servico) {
        return normalizeDate(
            servico?.executadoEm ||
            servico?.criadoEm ||
            servico?.data ||
            servico?.dataServico
        ) || new Date(0);
    }

    function getBudgetDate(orcamento) {
        return normalizeDate(
            orcamento?.criadoEm ||
            orcamento?.aprovadoEm ||
            orcamento?.recusadoEm
        ) || new Date(0);
    }

    function getClientSubtitle(cliente) {
        const parts = isMecanicaProfile()
            ? [
                cliente?.telefone,
                cliente?.placaCarro,
                cliente?.modeloCarro
            ].filter(Boolean)
            : [
                cliente?.telefone,
                cliente?.telefone2
            ].filter(Boolean);

        return parts.join(" - ") || "Sem detalhes adicionais";
    }

    function getServiceTitle(servico) {
        const item = Array.isArray(servico?.itens) ? servico.itens[0] : null;
        const desc = String(item?.descricao || "").trim();
        if (desc) return desc;
        return `Serviço - ${servico?.cliente?.nome || "cliente"}`;
    }

    function getServiceSubtitle(servico) {
        const cliente = servico?.cliente?.nome || "Cliente não informado";
        const problema = String(servico?.problemaRelatado || "").trim();
        const veiculo = isMecanicaProfile()
            ? [
                servico?.cliente?.modeloCarro,
                servico?.cliente?.placaCarro,
                servico?.cliente?.corCarro
            ].filter(Boolean).join(" - ")
            : "";

        if (problema && veiculo) return `Problema: ${problema} | ${veiculo}`;
        if (problema) return `Problema: ${problema}`;
        if (veiculo) return `${cliente} - ${veiculo}`;

        if (!Array.isArray(servico?.itens) || servico.itens.length === 0) {
            return `${cliente} - cadastro inicial`;
        }

        const total = formatMoney(servico?.totalGeral || 0);
        return `${cliente} - ${total}`;
    }

    function getServiceDetails(servico) {
        const cliente = servico?.cliente || {};
        const telefones = [
            cliente.telefone,
            cliente.telefone2
        ].filter(Boolean).join(" / ");
        const veiculo = isMecanicaProfile()
            ? [
                cliente.modeloCarro,
                cliente.placaCarro,
                cliente.corCarro
            ].filter(Boolean).join(" - ")
            : "";
        const problema = String(servico?.problemaRelatado || "").trim();
        const total = Number(servico?.totalGeral || 0);
        const parts = [];

        if (telefones) parts.push(`Telefone: ${telefones}`);
        if (veiculo) parts.push(`Veículo: ${veiculo}`);
        if (problema) parts.push(`Problema: ${problema}`);
        if (total > 0) parts.push(`Valor parcial: ${formatMoney(total)}`);

        return parts;
    }

    function statusTag(status) {
        const value = String(status || "").toLowerCase();
        if (value === "aprovado" || value === "executado") return "success";
        if (value === "recusado" || value === "atrasado") return "danger";
        if (value === "pendente" || value === "enviado") return "warning";
        return "";
    }

    function renderRows(containerId, rows, emptyText) {
        const container = byId(containerId);
        if (!container) return;

        if (!rows.length) {
            container.innerHTML = `<div class="desktop-list-empty">${safeHtml(emptyText)}</div>`;
            return;
        }

        container.innerHTML = rows.join("");
    }

    function renderUser() {
        const user = window.SensoAuth?.user || window.firebase?.auth?.()?.currentUser;
        const name = user?.displayName || user?.email || "Usuário";
        if (userNameEl) userNameEl.textContent = name;
    }

    function isProAllowed() {
        if (!window.SensoPlans?.state?.ready) return false;
        if (typeof window.SensoPlans.isPro !== "function") return false;
        if (!window.SensoPlans.isPro()) return false;
        if (typeof window.SensoPlans.isActive === "function") {
            return window.SensoPlans.isActive();
        }
        return true;
    }

    function renderAccess() {
        renderUser();

        const plan = window.SensoPlans?.getCurrentPlan?.() || {};
        const planReady = !!window.SensoPlans?.state?.ready;

        if (!planReady) {
            if (planBadgeEl) {
                planBadgeEl.textContent = "Carregando plano...";
            }
            dashboardEl?.classList.add("hidden");
            accessGateEl?.classList.add("hidden");
            return;
        }

        const isPro = isProAllowed();

        if (planBadgeEl) {
            planBadgeEl.textContent = isPro ? "Pro ativo" : "Plano Pro necessário";
        }

        dashboardEl?.classList.toggle("hidden", !isPro);
        accessGateEl?.classList.toggle("hidden", isPro);

        if (isPro) renderDashboard();
    }

    function renderKpis(data) {
        const clientesAtivos = (data.clientes || []).filter(c => !c?.arquivado).length;
        const servicosPendentes = (data.servicos || []).filter(s => s?.status === "pendente").length;
        const orcamentosEnviados = (data.orcamentos || [])
            .filter(o => o?.status === "enviado" && isCurrentMonth(getBudgetDate(o))).length;
        const financeiroValido = typeof window.listarFinanceiroValido === "function"
            ? window.listarFinanceiroValido(data)
            : (data.financeiro || []);
        const saldoMes = financeiroValido.reduce((acc, item) => {
            if (!isCurrentMonth(item?.data)) return acc;
            const value = Number(item?.valor || 0);
            return acc + (item?.tipo === "saida" ? -value : value);
        }, 0);

        setText("kpiClientes", clientesAtivos);
        setText("kpiServicosPendentes", servicosPendentes);
        setText("kpiOrcamentosEnviados", orcamentosEnviados);
        setText("kpiSaldoMes", formatMoney(saldoMes));
    }

    function renderAgenda(data) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sevenDaysFromToday = new Date(today);
        sevenDaysFromToday.setDate(today.getDate() + 7);

        const servicosPorId = new Map((data.servicos || []).map(servico => [servico.id, servico]));

        const agenda = (data.agenda || [])
            .filter(item => item?.status === "agendado" && item?.dataRetorno)
            .map(item => {
                const date = normalizeDate(item.dataRetorno);
                if (date) date.setHours(0, 0, 0, 0);
                return { item, date };
            })
            .filter(entry => entry.date)
            .sort((a, b) => a.date - b.date);

        const atrasadas = agenda.filter(entry => entry.date < today);
        const hoje = agenda.filter(entry => entry.date.getTime() === today.getTime());
        const proximas = agenda.filter(entry => entry.date > today);
        const proximosSeteDias = proximas.filter(entry => entry.date <= sevenDaysFromToday);

        setText("agendaAtrasadas", atrasadas.length);
        setText("agendaHoje", hoje.length);
        setText("agendaProximas", proximosSeteDias.length);

        const rows = [...atrasadas, ...hoje, ...proximosSeteDias.slice(0, 3)]
            .map(entry => {
                const isLate = entry.date < today;
                const isToday = entry.date.getTime() === today.getTime();
                const tagClass = isLate ? "danger" : isToday ? "warning" : "success";
                const label = isLate ? "Atrasada" : isToday ? "Hoje" : formatDate(entry.item.dataRetorno);
                const cliente = entry.item?.cliente?.nome || "Cliente não informado";
                const servico = servicosPorId.get(entry.item?.origemServicoId);
                const telefone = [
                    entry.item?.cliente?.telefone,
                    entry.item?.cliente?.telefone2
                ].filter(Boolean).join(" / ");
                const itens = Array.isArray(servico?.itens)
                    ? servico.itens.map(item => String(item?.descricao || "").trim()).filter(Boolean)
                    : [];
                const servicoResumo = itens[0] || (servico ? getServiceTitle(servico) : "Retorno agendado");
                const diasTexto = isLate
                    ? `${Math.max(1, Math.round((today - entry.date) / 86400000))} dia(s) atrasado`
                    : isToday
                    ? "Retorno hoje"
                    : `Faltam ${Math.max(1, Math.round((entry.date - today) / 86400000))} dia(s)`;
                const meta = [
                    telefone ? `Telefone: ${telefone}` : "",
                    servico?.executadoEm ? `Último serviço: ${formatDate(servico.executadoEm)}` : "",
                    Number(entry.item?.valorServico || servico?.totalGeral || 0) > 0
                        ? `Valor: ${formatMoney(entry.item?.valorServico || servico?.totalGeral || 0)}`
                        : ""
                ].filter(Boolean);

                return `
                    <div class="desktop-row desktop-agenda-row">
                        <div>
                            <strong>${safeHtml(cliente)}</strong>
                            <small>${safeHtml(servicoResumo)} · Retorno: ${safeHtml(formatDate(entry.item.dataRetorno))}</small>
                            ${
                                meta.length
                                ? `<div class="desktop-row-details">${meta.map(item => `<span>${safeHtml(item)}</span>`).join("")}</div>`
                                : ""
                            }
                        </div>
                        <div class="desktop-row-side">
                            <span class="desktop-tag ${tagClass}">${safeHtml(label)}</span>
                            <small>${safeHtml(diasTexto)}</small>
                            <a class="desktop-row-action" href="pages/agenda.html">Ver agenda</a>
                        </div>
                    </div>
                `;
            });

        renderRows("agendaList", rows, "Nenhuma pendência de agenda para hoje.");
    }

    function renderServicosPendentesAlert(data) {
        const panel = byId("servicosPendentesAlert");
        const pendentes = (data.servicos || [])
            .filter(servico => String(servico?.status || "pendente").toLowerCase() === "pendente")
            .slice()
            .sort((a, b) => getServiceDate(b) - getServiceDate(a));

        setText("servicosPendentesAlertCount", pendentes.length);
        panel?.classList.toggle("hidden", pendentes.length === 0);

        const rows = pendentes.slice(0, 4).map(servico => {
            const cliente = servico?.cliente?.nome || "Cliente não informado";
            const semItens = !Array.isArray(servico?.itens) || servico.itens.length === 0;
            const status = semItens ? "Completar itens" : "Abrir orçamento";
            const detalhes = getServiceSubtitle(servico);

            return `
                <div class="desktop-row attention">
                    <div>
                        <strong>${safeHtml(cliente)}</strong>
                        <small>${safeHtml(detalhes)}</small>
                    </div>
                    <a class="desktop-row-action" href="pages/servico.html?editar=${encodeURIComponent(servico.id)}">
                        ${safeHtml(status)}
                    </a>
                </div>
            `;
        });

        renderRows("servicosPendentesAlertList", rows, "Nenhum serviço pendente.");
    }

    function renderPreAtendimentos(data) {
        const panel = document.querySelector(".desktop-attention-panel");
        const preAtendimentos = (data.servicos || [])
            .filter(servico => {
                const semItens = !Array.isArray(servico?.itens) || servico.itens.length === 0;
                const pendente = !servico?.status || servico.status === "pendente";
                return semItens && pendente;
            })
            .slice()
            .sort((a, b) => getServiceDate(b) - getServiceDate(a));

        setText("preAtendimentosCount", preAtendimentos.length);
        panel?.classList.toggle("has-alert", preAtendimentos.length > 0);

        const rows = preAtendimentos.slice(0, 8).map(servico => {
            const cliente = servico?.cliente?.nome || "Cliente não informado";
            const problema = String(servico?.problemaRelatado || "Problema não informado").trim();
            const veiculo = [
                servico?.cliente?.modeloCarro,
                servico?.cliente?.placaCarro,
                servico?.cliente?.corCarro
            ].filter(Boolean).join(" - ");
            const detalhe = veiculo
                ? `${problema} | ${veiculo}`
                : problema;

            return `
                <div class="desktop-row attention">
                    <div>
                        <strong>${safeHtml(cliente)}</strong>
                        <small>${safeHtml(detalhe)}</small>
                    </div>
                    <a class="desktop-row-action" href="pages/servico.html?editar=${encodeURIComponent(servico.id)}">
                        Completar serviço
                    </a>
                </div>
            `;
        });

        renderRows("preAtendimentosList", rows, "Nenhum pré-atendimento aguardando complemento.");
    }

    function renderClientes(data) {
        const rows = (data.clientes || [])
            .filter(cliente => !cliente?.arquivado)
            .slice()
            .reverse()
            .slice(0, 6)
            .map(cliente => `
                <div class="desktop-row">
                    <div>
                        <strong>${safeHtml(cliente?.nome || "Cliente sem nome")}</strong>
                        <small>${safeHtml(getClientSubtitle(cliente))}</small>
                    </div>
                    <span class="desktop-tag success">Ativo</span>
                </div>
            `);

        renderRows("clientesRecentes", rows, "Nenhum cliente ativo cadastrado.");
    }

    function renderServicos(data) {
        const labels = getServicePanelLabels();
        const rows = (data.servicos || [])
            .filter(servico => {
                const status = String(servico?.status || "pendente").toLowerCase();
                return status === "pendente";
            })
            .slice()
            .sort((a, b) => getServiceDate(b) - getServiceDate(a))
            .slice(0, 8)
            .map(servico => {
                const status = servico?.status || "pendente";
                const details = getServiceDetails(servico);
                return `
                    <div class="desktop-row in-service">
                        <div>
                            <strong>${safeHtml(getServiceTitle(servico))}</strong>
                            <small>${safeHtml(getServiceSubtitle(servico))}</small>
                            ${
                                details.length
                                ? `<div class="desktop-row-details">${details.map(item => `<span>${safeHtml(item)}</span>`).join("")}</div>`
                                : ""
                            }
                        </div>
                        <span class="desktop-tag ${statusTag(status)}">${safeHtml(status)}</span>
                    </div>
                `;
            });

        renderRows("servicosRecentes", rows, labels.empty);
    }

    function renderOrcamentos(data) {
        const rows = (data.orcamentos || [])
            .filter(orcamento => isCurrentMonth(getBudgetDate(orcamento)))
            .slice()
            .sort((a, b) => getBudgetDate(b) - getBudgetDate(a))
            .slice(0, 6)
            .map(orcamento => {
                const status = orcamento?.status || "enviado";
                const numero = orcamento?.numero || "Sem número";
                const cliente = orcamento?.cliente?.nome || "Cliente não informado";
                const total = formatMoney(orcamento?.total || 0);

                return `
                    <div class="desktop-row">
                        <div>
                            <strong>${safeHtml(numero)} - ${safeHtml(cliente)}</strong>
                            <small>${safeHtml(total)} - ${safeHtml(formatDate(orcamento?.criadoEm))}</small>
                        </div>
                        <span class="desktop-tag ${statusTag(status)}">${safeHtml(status)}</span>
                    </div>
                `;
            });

        renderRows("orcamentosRecentes", rows, "Nenhum orçamento do mês.");
    }

    function renderDashboard() {
        const data = getAppData();
        applyProfileLabels();
        renderKpis(data);
        renderServicosPendentesAlert(data);
        renderPreAtendimentos(data);
        renderAgenda(data);
        renderClientes(data);
        renderServicos(data);
        renderOrcamentos(data);
    }

    signOutBtn?.addEventListener("click", () => {
        if (typeof window.sensoSignOut === "function") {
            window.sensoSignOut();
        }
    });

    window.addEventListener("senso-auth-ready", () => {
        renderUser();
        startDesktopDataListener();
        renderAccess();
    });

    window.addEventListener("senso-plan-ready", () => {
        startDesktopDataListener();
        renderAccess();
    });

    window.addEventListener("senso-live-update", () => {
        if (isProAllowed()) renderDashboard();
    });

    renderUser();
    startDesktopDataListener();
    renderAccess();
})();
