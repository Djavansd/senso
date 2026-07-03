(function () {
    "use strict";

    const state = { users: [], actor: null, mfaEnrolled: false };
    const notice = document.getElementById("adminNotice");
    const body = document.getElementById("usersBody");
    const area = document.getElementById("usersArea");
    const search = document.getElementById("userSearch");
    const filter = document.getElementById("statusFilter");
    const overview = document.getElementById("adminOverview");
    const kpiTotal = document.getElementById("kpiTotal");
    const kpiWaiting = document.getElementById("kpiWaiting");
    const kpiActive = document.getElementById("kpiActive");
    const kpiBlocked = document.getElementById("kpiBlocked");
    const soundToggle = document.getElementById("adminSoundManagementToggle");
    const soundVolume = document.getElementById("adminSoundVolume");
    const soundVolumeValue = document.getElementById("adminSoundVolumeValue");
    const soundTest = document.getElementById("adminSoundTest");
    const soundAudio = document.getElementById("adminManagementAudio");
    const SOUND_KEY = "senso:admin-alert-sound";
    const SOUND_VOLUME_KEY = "senso:admin-alert-volume";
    const deleteDialog = document.getElementById("deleteUserDialog");
    const deleteForm = document.getElementById("deleteUserForm");
    const deleteDescription = document.getElementById("deleteUserDescription");
    const deleteConfirmation = document.getElementById("deleteConfirmation");
    const deleteAdminPassword = document.getElementById("deleteAdminPassword");
    const deleteMfaStep = document.getElementById("deleteMfaStep");
    const deleteMfaCode = document.getElementById("deleteMfaCode");
    const deleteDialogStatus = document.getElementById("deleteDialogStatus");
    const deleteConfirm = document.getElementById("deleteConfirm");
    const deleteState = { target: null, resolver: null, verificationId: null, recaptcha: null };
    let deleteRecaptchaSequence = 0;

    const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
    const statusOf = user => user.status === "bloqueado" ? "bloqueado" : user.autorizado === false ? "aguardando" : "ativo";
    const statusLabel = status => ({ aguardando: "Aguardando", ativo: "Ativo", bloqueado: "Bloqueado" }[status] || status);
    const dateLabel = value => {
        const date = typeof value?.toDate === "function" ? value.toDate() : value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("pt-BR") : "—";
    };
    const dateInputValue = value => {
        const date = typeof value?.toDate === "function" ? value.toDate() : value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) return "";
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    };
    const futureDateInputValue = (days = 0) => {
        const date = new Date(Date.now() + days * 86400000);
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    };

    function businessesOf(user) {
        const entries = user?.negocios && typeof user.negocios === "object"
            ? Object.values(user.negocios).filter(item => item && typeof item === "object")
            : [];
        if (entries.length) {
            return entries.sort((a, b) => String(a.tipo || "").localeCompare(String(b.tipo || ""), "pt-BR"));
        }
        if (user?.empresaConfigurada || user?.empresa || user?.telefone || user?.endereco) {
            return [{
                tipo: "Negócio principal",
                empresa: user.empresa || "",
                telefone: user.telefone || "",
                endereco: user.endereco || ""
            }];
        }
        return [];
    }

    function businessesHtml(user) {
        const businesses = businessesOf(user);
        const activeName = user?.negocioAtivoNome
            || businesses.find(item => item.businessId === user?.negocioAtivo)?.tipo
            || "";
        const activeBadge = activeName
            ? `<span class="active-business">Em uso atualmente: ${escapeHtml(activeName)}</span>`
            : "";
        if (!businesses.length) return `${activeBadge}<span class="business-empty">Nenhum negócio configurado</span>`;
        const cards = businesses.map(business => `<article class="business-summary-card">
            <strong>${escapeHtml(business.tipo || "Profissão")}</strong>
            <span>${escapeHtml(business.empresa || "Empresa não informada")}</span>
            <small>Telefone: ${escapeHtml(business.telefone || "Não informado")}</small>
            <small>Endereço: ${escapeHtml(business.endereco || "Não informado")}</small>
        </article>`).join("");
        const businessNames = businesses.map(business => business.tipo || "Profissão").join(" • ");
        return `${activeBadge}<details class="business-list" ${businesses.length === 1 ? "open" : ""}>
            <summary>${businesses.length} ${businesses.length === 1 ? "negócio" : "negócios"}: ${escapeHtml(businessNames)}</summary>
            <div class="business-list-items">${cards}</div>
        </details>`;
    }

    function soundEnabled() {
        try { return localStorage.getItem(SOUND_KEY) === "on"; }
        catch (_error) { return false; }
    }

    function savedSoundVolume() {
        try {
            const value = Number(localStorage.getItem(SOUND_VOLUME_KEY));
            return Number.isFinite(value) && value >= 10 && value <= 100 ? value : 65;
        } catch (_error) {
            return 65;
        }
    }

    function renderSoundSettings() {
        const enabled = soundEnabled();
        const volume = savedSoundVolume();
        soundToggle.textContent = enabled ? "Som ativado" : "Som desativado";
        soundToggle.setAttribute("aria-pressed", String(enabled));
        soundToggle.classList.toggle("sound-on", enabled);
        soundVolume.value = String(volume);
        soundVolumeValue.value = `${volume}%`;
    }

    async function previewSound() {
        try {
            soundAudio.currentTime = 0;
            soundAudio.volume = savedSoundVolume() / 100;
            await soundAudio.play();
        } catch (_error) {
            setNotice("O navegador bloqueou o áudio. Toque novamente em Testar som.", true);
        }
    }

    soundToggle.addEventListener("click", async () => {
        const enabled = !soundEnabled();
        try { localStorage.setItem(SOUND_KEY, enabled ? "on" : "off"); } catch (_error) {}
        renderSoundSettings();
        if (enabled) await previewSound();
    });
    soundVolume.addEventListener("input", () => {
        const volume = Number(soundVolume.value);
        try { localStorage.setItem(SOUND_VOLUME_KEY, String(volume)); } catch (_error) {}
        soundVolumeValue.value = `${volume}%`;
    });
    soundVolume.addEventListener("change", () => { if (soundEnabled()) previewSound(); });
    soundTest.addEventListener("click", previewSound);
    renderSoundSettings();

    function setNotice(message, error) {
        notice.textContent = message;
        notice.classList.toggle("error", !!error);
    }

    function render() {
        const totals = state.users.reduce((result, user) => {
            result[statusOf(user)] += 1;
            return result;
        }, { aguardando: 0, ativo: 0, bloqueado: 0 });
        kpiTotal.textContent = state.users.length;
        kpiWaiting.textContent = totals.aguardando;
        kpiActive.textContent = totals.ativo;
        kpiBlocked.textContent = totals.bloqueado;

        const term = search.value.trim().toLowerCase();
        const selectedStatus = filter.value;
        const users = state.users.filter(user => {
            const businessText = businessesOf(user).map(item => `${item.tipo || ""} ${item.empresa || ""} ${item.telefone || ""} ${item.endereco || ""}`).join(" ");
            const matchesText = !term || `${user.nome || ""} ${user.email || ""} ${businessText}`.toLowerCase().includes(term);
            return matchesText && (!selectedStatus || statusOf(user) === selectedStatus);
        });

        body.innerHTML = users.map(user => {
            const status = statusOf(user);
            const isSelf = user.uid === state.actor.uid;
            return `<tr data-uid="${escapeHtml(user.uid)}">
                <td data-label="Usuário"><strong>${escapeHtml(user.nome || "Sem nome")}</strong><div class="user-email">${escapeHtml(user.email || "")}</div></td>
                <td data-label="Negócios">${businessesHtml(user)}</td>
                <td data-label="Status"><span class="status-pill status-${status}">${statusLabel(status)}</span></td>
                <td data-label="Plano e vencimento"><div class="plan-controls">
                    <select class="plan-select" aria-label="Plano de ${escapeHtml(user.nome || user.email)}" ${isSelf ? "disabled" : ""}><option value="gratis" ${user.plano === "gratis" ? "selected" : ""}>Grátis</option><option value="basico" ${user.plano === "basico" ? "selected" : ""}>Básico mensal</option><option value="pro" ${user.plano === "pro" ? "selected" : ""}>Pro mensal</option></select>
                    <label class="validity-label" ${user.plano === "gratis" ? "hidden" : ""}>Vencimento
                        <input class="validity-input" type="date" min="${futureDateInputValue()}" max="${futureDateInputValue(364)}" value="${dateInputValue(user.validade) || futureDateInputValue(30)}" ${user.plano === "gratis" || isSelf ? "disabled" : ""}>
                    </label>
                    <button class="save-plan" type="button" data-action="salvar-plano" ${isSelf ? "disabled" : ""}>Salvar plano e vencimento</button>
                    <small class="validity-current">${user.plano === "gratis" ? "Sem vencimento" : `Vencimento atual: ${escapeHtml(dateLabel(user.validade))}`}</small>
                </div></td>
                <td data-label="Ações"><div class="row-actions">${status !== "ativo" ? `<button data-action="aprovar" ${isSelf ? "disabled" : ""}>Aprovar acesso</button>` : ""}${status !== "bloqueado" ? `<button class="danger" data-action="bloquear" ${isSelf ? "disabled" : ""}>Bloquear acesso</button>` : ""}<button class="delete-account" data-action="excluir" ${isSelf ? "disabled" : ""}>Excluir usuário</button></div></td>
            </tr>`;
        }).join("") || `<tr><td colspan="5">Nenhum usuário encontrado.</td></tr>`;
    }

    async function updateUser(uid, changes, action) {
        if (!state.actor?.isAdmin || uid === state.actor.uid) return;
        const db = firebase.firestore();
        const actionRef = db.collection("adminAudit").doc();
        const userRef = db.collection("users").doc(uid);
        const batch = db.batch();
        batch.update(userRef, { ...changes, lastAdminActionId: actionRef.id, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        batch.set(actionRef, {
            actionId: actionRef.id,
            actorUid: state.actor.uid,
            actorEmail: state.actor.email || "",
            targetUid: uid,
            action,
            changes,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
    }

    function handleChange(event) {
        const row = event.target.closest("tr[data-uid]");
        if (!row || !event.target.matches(".plan-select")) return;
        const paid = event.target.value !== "gratis";
        const label = row.querySelector(".validity-label");
        const input = row.querySelector(".validity-input");
        label.hidden = !paid;
        input.disabled = !paid;
        if (paid && !input.value) input.value = futureDateInputValue(30);
    }

    async function savePlan(row, button) {
        const uid = row.dataset.uid;
        const user = state.users.find(item => item.uid === uid);
        const selectedPlan = row.querySelector(".plan-select").value;
        const paid = selectedPlan !== "gratis";
        const validityInput = row.querySelector(".validity-input");
        if (paid && !validityInput.value) {
            setNotice("Escolha a data de vencimento solicitada pelo cliente.", true);
            validityInput.focus();
            return;
        }

        const validity = paid ? new Date(`${validityInput.value}T23:59:59`) : null;
        if (paid && (Number.isNaN(validity.getTime()) || validity <= new Date())) {
            setNotice("A data de vencimento precisa ser hoje ou uma data futura.", true);
            validityInput.focus();
            return;
        }

        button.disabled = true;
        try {
            const prices = { gratis: null, basico: 29.90, pro: 59.90 };
            const contractDate = typeof user?.dataContratacao?.toDate === "function"
                ? user.dataContratacao
                : firebase.firestore.Timestamp.now();
            await updateUser(uid, {
                plano: selectedPlan,
                tipoPagamento: "mensal",
                validade: paid ? firebase.firestore.Timestamp.fromDate(validity) : null,
                precoContratado: prices[selectedPlan],
                dataContratacao: paid ? contractDate : null,
                tipoPlano: paid ? "mensal" : null
            }, "alterar_plano");
            setNotice(`Plano atualizado. Vencimento: ${paid ? validity.toLocaleDateString("pt-BR") : "sem vencimento"}. Ação registrada na auditoria.`);
        } catch (error) {
            console.error(error);
            setNotice("Alteração recusada pelo servidor.", true);
        } finally {
            button.disabled = false;
        }
    }

    function clearDeleteRecaptcha() {
        if (deleteState.recaptcha) {
            try { deleteState.recaptcha.clear(); } catch (_error) {}
            deleteState.recaptcha = null;
        }
        const host = document.getElementById("deleteRecaptchaHost");
        if (host) host.replaceChildren();
    }

    function createDeleteRecaptchaContainer() {
        const host = document.getElementById("deleteRecaptchaHost");
        if (!host) throw new Error("Contêiner de segurança não encontrado.");
        const container = document.createElement("div");
        deleteRecaptchaSequence += 1;
        container.id = `deleteRecaptcha-${Date.now()}-${deleteRecaptchaSequence}`;
        host.replaceChildren(container);
        return container.id;
    }

    function resetDeleteDialog() {
        deleteState.target = null;
        deleteState.resolver = null;
        deleteState.verificationId = null;
        deleteConfirmation.value = "";
        deleteAdminPassword.value = "";
        deleteMfaCode.value = "";
        deleteMfaStep.hidden = true;
        deleteDialogStatus.textContent = "";
        deleteConfirm.disabled = false;
        deleteConfirm.textContent = "Excluir definitivamente";
        clearDeleteRecaptcha();
    }

    function openDeleteDialog(uid) {
        const target = state.users.find(user => user.uid === uid);
        if (!target || target.admin === true) {
            setNotice("Esta conta não pode ser excluída por este fluxo.", true);
            return;
        }
        resetDeleteDialog();
        deleteState.target = target;
        deleteDescription.textContent = `${target.nome || "Usuário sem nome"} • ${target.email || "sem e-mail"}`;
        deleteDialog.showModal();
        deleteConfirmation.focus();
    }

    async function startDeleteMfa(error) {
        deleteState.resolver = error.resolver;
        const hint = deleteState.resolver?.hints?.find(item => item.factorId === firebase.auth.PhoneMultiFactorGenerator.FACTOR_ID);
        if (!hint) throw new Error("Segundo fator por SMS não encontrado.");
        const host = location.hostname;
        const localDevelopment = host === "localhost"
            || host === "127.0.0.1"
            || host.startsWith("192.168.")
            || host.startsWith("10.")
            || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
        if (localDevelopment) {
            firebase.auth().settings.appVerificationDisabledForTesting = true;
        }
        clearDeleteRecaptcha();
        const recaptchaContainerId = createDeleteRecaptchaContainer();
        deleteState.recaptcha = new firebase.auth.RecaptchaVerifier(recaptchaContainerId, { size: "invisible" });
        deleteState.verificationId = await new firebase.auth.PhoneAuthProvider().verifyPhoneNumber({
            multiFactorHint: hint,
            session: deleteState.resolver.session
        }, deleteState.recaptcha);
        deleteMfaStep.hidden = false;
        deleteConfirm.textContent = "Validar MFA e continuar";
        deleteDialogStatus.textContent = "Digite agora o código de 6 dígitos e toque no botão vermelho.";
        deleteMfaCode.focus();
    }

    async function confirmDeleteMfa() {
        const code = deleteMfaCode.value.replace(/\D/g, "");
        if (code.length !== 6) throw new Error("Informe o código MFA de 6 dígitos.");
        const credential = firebase.auth.PhoneAuthProvider.credential(deleteState.verificationId, code);
        const assertion = firebase.auth.PhoneMultiFactorGenerator.assertion(credential);
        await deleteState.resolver.resolveSignIn(assertion);
        deleteState.resolver = null;
        deleteState.verificationId = null;
        clearDeleteRecaptcha();
    }

    function withTimeout(promise, milliseconds, message) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error(message), { code: "senso/auth-timeout" })), milliseconds);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    async function executeUserDeletion() {
        const currentUser = firebase.auth().currentUser;
        if (!currentUser || !deleteState.target) throw new Error("Sessão administrativa inválida.");

        if (deleteState.resolver) {
            await confirmDeleteMfa();
        } else {
            try {
                await withTimeout(
                    firebase.auth().signInWithEmailAndPassword(currentUser.email, deleteAdminPassword.value),
                    15000,
                    "O Firebase demorou para validar a senha. Verifique a conexão e tente novamente."
                );
            } catch (error) {
                if (error.code === "auth/multi-factor-auth-required") {
                    deleteDialogStatus.textContent = "Senha confirmada. Preparando a verificação MFA…";
                    await withTimeout(
                        startDeleteMfa(error),
                        15000,
                        "O Firebase demorou para preparar o MFA. Feche a janela e tente novamente."
                    );
                    return false;
                }
                throw error;
            }
        }

        await currentUser.getIdToken(true);
        const callable = firebase.app().functions("southamerica-east1").httpsCallable("deleteSensoUser");
        await callable({ targetUid: deleteState.target.uid, confirmation: "EXCLUIR" });
        return true;
    }

    async function handleDeleteConfirmation() {
        if (!deleteForm.reportValidity()) return;
        if (deleteConfirmation.value.trim().toUpperCase() !== "EXCLUIR") {
            deleteDialogStatus.textContent = "Digite EXCLUIR exatamente como solicitado.";
            deleteConfirmation.focus();
            return;
        }
        if (!deleteAdminPassword.value) {
            deleteDialogStatus.textContent = "Informe sua senha administrativa.";
            deleteAdminPassword.focus();
            return;
        }

        deleteConfirm.disabled = true;
        deleteDialogStatus.textContent = deleteState.resolver ? "Confirmando MFA…" : "Validando sua senha…";
        try {
            const deleted = await executeUserDeletion();
            if (!deleted) return;
            const deletedEmail = deleteState.target?.email || "usuário";
            deleteDialog.close();
            resetDeleteDialog();
            setNotice(`${deletedEmail} foi excluído do Authentication e do Firestore. Auditoria preservada.`);
        } catch (error) {
            console.error("Falha na exclusão administrativa.", error);
            if (error.code === "senso/auth-timeout") {
                clearDeleteRecaptcha();
                deleteState.resolver = null;
                deleteState.verificationId = null;
                deleteMfaStep.hidden = true;
                deleteConfirm.textContent = "Excluir definitivamente";
            }
            const messages = {
                "auth/wrong-password": "Senha administrativa incorreta.",
                "auth/invalid-credential": "Senha administrativa incorreta.",
                "auth/invalid-verification-code": "Código MFA inválido ou expirado.",
                "senso/auth-timeout": error.message || "O Firebase demorou para responder. Verifique a internet e tente novamente.",
                "functions/not-found": "A função de exclusão ainda não foi publicada no Google Cloud.",
                "functions/failed-precondition": "Faça a autenticação novamente e repita a exclusão."
            };
            deleteDialogStatus.textContent = messages[error.code] || error.message || "Não foi possível excluir o usuário.";
        } finally {
            deleteConfirm.disabled = false;
        }
    }

    deleteConfirm.onclick = handleDeleteConfirmation;
    window.confirmSensoUserDeletion = handleDeleteConfirmation;
    deleteMfaCode.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        handleDeleteConfirmation();
    });

    document.getElementById("deleteCancel").addEventListener("click", () => {
        deleteDialog.close();
        resetDeleteDialog();
    });

    async function handleClick(event) {
        const button = event.target.closest("button[data-action]");
        const row = button?.closest("tr[data-uid]");
        if (!button || !row) return;
        if (button.dataset.action === "excluir") {
            openDeleteDialog(row.dataset.uid);
            return;
        }
        if (button.dataset.action === "salvar-plano") {
            await savePlan(row, button);
            return;
        }
        button.disabled = true;
        try {
            const approve = button.dataset.action === "aprovar";
            await updateUser(row.dataset.uid, approve ? { autorizado: true, status: "ativo" } : { autorizado: false, status: "bloqueado" }, approve ? "aprovar_usuario" : "bloquear_usuario");
            setNotice(approve ? "Usuário aprovado com sucesso." : "Usuário bloqueado com sucesso.");
        } catch (error) {
            console.error(error); setNotice("Alteração recusada pelo servidor.", true);
        } finally { button.disabled = false; }
    }

    async function start(event) {
        const detail = event?.detail || {};
        if (!detail.uid || detail.isAdmin !== true) { location.replace("../index.html"); return; }
        if (detail.mfaEnrolled !== true || detail.mfaAuthenticated !== true) { location.replace("seguranca-conta.html"); return; }
        state.actor = { uid: detail.uid, email: firebase.auth().currentUser?.email, isAdmin: true };
        state.mfaEnrolled = detail.mfaEnrolled === true;
        try {
            const serverProfile = await firebase.firestore().collection("users").doc(detail.uid).get({ source: "server" });
            if (!serverProfile.exists || serverProfile.data().admin !== true) { location.replace("../index.html"); return; }
            search.disabled = false; filter.disabled = false; area.hidden = false; overview.hidden = false;
            firebase.firestore().collection("users").onSnapshot(snapshot => {
                state.users = snapshot.docs
                    .map(doc => ({ uid: doc.id, ...doc.data() }))
                    .sort((a, b) => (b.dataCadastro?.toMillis?.() || 0) - (a.dataCadastro?.toMillis?.() || 0));
                render();
                setNotice(`${state.users.length} usuário(s) carregado(s).${state.mfaEnrolled ? " MFA ativo nesta conta." : " MFA ainda não está ativo; a estrutura está preparada para habilitá-lo no Firebase Authentication."}`);
            }, error => { console.error(error); setNotice("O servidor negou a leitura dos usuários.", true); });
        } catch (error) { console.error(error); setNotice("Não foi possível confirmar a autorização administrativa.", true); }
    }

    search.addEventListener("input", render); filter.addEventListener("change", render);
    body.addEventListener("click", handleClick); body.addEventListener("change", handleChange);
    document.getElementById("adminSignOut").addEventListener("click", () => window.sensoSignOut?.());
    window.addEventListener("senso-auth-ready", start, { once: true });
    if (window.SensoAuth?.profile) {
        firebase.auth().currentUser.getIdTokenResult().then(result => start({ detail: {
            uid: window.SensoAuth.uid,
            isAdmin: window.SensoAuth.isAdmin,
            mfaEnrolled: (firebase.auth().currentUser?.multiFactor?.enrolledFactors || []).length > 0,
            mfaAuthenticated: !!result.claims?.firebase?.sign_in_second_factor
        } }));
    }
})();
