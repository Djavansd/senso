(function () {
    "use strict";

    const COLLECTIONS = ["clientes", "servicos", "agenda", "financeiro", "orcamentos", "correcoes"];
    const state = { running: false };
    const enableReadButton = document.getElementById("btnEnableV2Read");
    const disableReadButton = document.getElementById("btnDisableV2Read");
    const verifyIntegrityButton = document.getElementById("btnVerifyV2Integrity");

    function profileId() {
        return window.SensoProfile?.getActiveProfile?.()?.id || "mecanica";
    }

    function safeDocId(value, collection, index) {
        const raw = String(value || `legacy-${collection}-${index}`);
        return raw.replaceAll("/", "_").slice(0, 500);
    }

    function cleanDocument(data) {
        const clean = { ...(data || {}) };
        delete clean._migration;
        delete clean._sync;
        return clean;
    }

    function canonicalValue(value) {
        if (Array.isArray(value)) return value.map(canonicalValue);
        if (value && typeof value?.toDate === "function") return value.toDate().toISOString();
        if (value && typeof value === "object") {
            return Object.keys(value).sort().reduce((result, key) => {
                if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
                return result;
            }, {});
        }
        return value;
    }

    function serialized(value) {
        return JSON.stringify(canonicalValue(value || {}));
    }

    function setStatus(message, error) {
        const element = document.getElementById("migrationPilotStatus");
        if (!element) return;
        element.textContent = message;
        element.classList.toggle("migration-error", !!error);
    }

    function downloadBackup(payload, uid, currentProfile) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const date = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
        link.href = url;
        link.download = `senso-backup-${uid}-${currentProfile}-${date}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function loadLegacyPayload(db, uid, currentProfile) {
        const dataRef = db.collection("users").doc(uid).collection("appData").doc(currentProfile);
        const settingsRef = db.collection("users").doc(uid).collection("appSettings").doc(currentProfile);
        const [dataSnapshot, settingsSnapshot] = await Promise.all([
            dataRef.get({ source: "server" }),
            settingsRef.get({ source: "server" }).catch(() => null)
        ]);
        if (!dataSnapshot.exists) throw new Error("Documento appData não encontrado para este perfil.");
        const legacyPayload = dataSnapshot.data() || {};
        const data = legacyPayload.data || {};
        return {
            legacyPayload,
            settingsPayload: settingsSnapshot?.exists ? settingsSnapshot.data() : null,
            data
        };
    }

    async function commitOperations(db, operations) {
        for (let start = 0; start < operations.length; start += 400) {
            const batch = db.batch();
            operations.slice(start, start + 400).forEach(operation => {
                batch.set(operation.ref, operation.data, { merge: true });
            });
            await batch.commit();
        }
    }

    async function verifyMigration(profileRef, sourceData) {
        const result = {};
        for (const collection of COLLECTIONS) {
            const source = Array.isArray(sourceData[collection]) ? sourceData[collection] : [];
            const snapshot = await profileRef.collection(collection).get({ source: "server" });
            const expectedIds = new Set(source.map((item, index) => safeDocId(item?.id, collection, index)));
            const receivedIds = new Set(snapshot.docs.map(doc => doc.id));
            const missing = [...expectedIds].filter(id => !receivedIds.has(id));
            result[collection] = { expected: source.length, found: snapshot.size, missing };
            if (snapshot.size < source.length || missing.length) {
                throw new Error(`Verificação falhou em ${collection}: ${missing.length} ID(s) ausente(s).`);
            }
        }
        return result;
    }

    async function verifyPilotIntegrity() {
        if (state.running) return;
        const user = firebase.auth().currentUser;
        if (!user || window.SensoAuth?.isAdmin !== true) {
            setStatus("A verificação exige a conta administrativa.", true);
            return;
        }

        state.running = true;
        verifyIntegrityButton.disabled = true;
        try {
            setStatus("Comparando todos os registros antigos com a estrutura v2…");
            await window.SensoV2Sync?.syncNow?.(window.getData?.() || {});
            const db = firebase.firestore();
            const currentProfile = profileId();
            const source = await loadLegacyPayload(db, user.uid, currentProfile);
            const profileRef = db.collection("users").doc(user.uid).collection("profiles").doc(currentProfile);
            let checked = 0;

            for (const collection of COLLECTIONS) {
                const items = Array.isArray(source.data[collection]) ? source.data[collection] : [];
                const snapshot = await profileRef.collection(collection).get({ source: "server" });
                const received = new Map(snapshot.docs.map(doc => [doc.id, serialized(cleanDocument(doc.data()))]));
                const expectedIds = new Set();

                items.forEach((item, index) => {
                    const id = safeDocId(item?.id, collection, index);
                    expectedIds.add(id);
                    if (!received.has(id)) throw new Error(`${collection}: registro ${id} ausente na v2.`);
                    if (received.get(id) !== serialized(item)) throw new Error(`${collection}: conteúdo diferente no registro ${id}.`);
                    checked += 1;
                });

                const extras = [...received.keys()].filter(id => !expectedIds.has(id));
                if (extras.length) throw new Error(`${collection}: ${extras.length} registro(s) extra(s) na v2.`);
            }

            await profileRef.set({
                integrityStatus: "verified",
                integrityCheckedAt: firebase.firestore.FieldValue.serverTimestamp(),
                integrityCheckedRecords: checked
            }, { merge: true });
            setStatus(`Integridade v2 confirmada: ${checked} registro(s) conferido(s), sem diferenças.`);
        } catch (error) {
            console.error("Falha na verificação de integridade v2.", error);
            setStatus(`Integridade v2 não confirmada: ${error.message || error}`, true);
        } finally {
            state.running = false;
            verifyIntegrityButton.disabled = false;
        }
    }

    async function migratePilot() {
        if (state.running) return;
        const user = firebase.auth().currentUser;
        if (!user || window.SensoAuth?.isAdmin !== true) {
            setStatus("A migração piloto exige a conta administrativa.", true);
            return;
        }

        state.running = true;
        const button = document.getElementById("btnMigrationPilot");
        button.disabled = true;
        const db = firebase.firestore();
        const currentProfile = profileId();

        try {
            setStatus("1/4 — Lendo o appData diretamente do servidor…");
            const source = await loadLegacyPayload(db, user.uid, currentProfile);
            const backup = {
                schema: "senso-appdata-backup-v1",
                uid: user.uid,
                profileId: currentProfile,
                exportedAt: new Date().toISOString(),
                appData: source.legacyPayload,
                appSettings: source.settingsPayload
            };
            downloadBackup(backup, user.uid, currentProfile);

            setStatus("2/4 — Backup baixado. Copiando para coleções separadas…");
            const profileRef = db.collection("users").doc(user.uid).collection("profiles").doc(currentProfile);
            const operations = [];
            const counts = {};

            COLLECTIONS.forEach(collection => {
                const items = Array.isArray(source.data[collection]) ? source.data[collection] : [];
                counts[collection] = items.length;
                items.forEach((item, index) => {
                    const id = safeDocId(item?.id, collection, index);
                    operations.push({
                        ref: profileRef.collection(collection).doc(id),
                        data: {
                            ...(item || {}),
                            _migration: {
                                source: "appData",
                                profileId: currentProfile,
                                migratedAt: firebase.firestore.Timestamp.now()
                            }
                        }
                    });
                });
            });

            await commitOperations(db, operations);
            setStatus("3/4 — Conferindo quantidades e identificadores…");
            const verification = await verifyMigration(profileRef, source.data);

            await profileRef.set({
                schemaVersion: 2,
                migrationStatus: "verified",
                migratedAt: firebase.firestore.FieldValue.serverTimestamp(),
                legacyUpdatedAt: Number(source.legacyPayload.updatedAt || source.data.updatedAt || 0),
                counts,
                verification
            }, { merge: true });

            window.dispatchEvent(new CustomEvent("senso-v2-migration-verified"));

            setStatus(`4/4 — Migração piloto verificada. ${operations.length} registro(s) copiado(s); appData antigo preservado.`);
        } catch (error) {
            console.error("Falha na migração piloto.", error);
            setStatus(`Migração interrompida com segurança: ${error.message || error}`, true);
        } finally {
            state.running = false;
            button.disabled = false;
        }
    }

    function initialize(event) {
        const isAdmin = event?.detail?.isAdmin === true || window.SensoAuth?.isAdmin === true;
        const section = document.getElementById("migrationPilotSection");
        if (!section || !isAdmin) return;
        section.hidden = false;
        window.SensoV2Sync?.ensureEnabled?.().then(enabled => {
            if (!enabled || state.running) return;
            const syncState = window.SensoV2Sync.state;
            enableReadButton.hidden = syncState.readMode === "v2-pilot";
            disableReadButton.hidden = syncState.readMode !== "v2-pilot";
            if (syncState.lastSuccessAt) {
                const time = new Date(syncState.lastSuccessAt).toLocaleString("pt-BR");
                setStatus(`Gravação dupla ativa. Última confirmação: ${time} (${syncState.lastOperations} alteração(ões)).`);
                return;
            }
            setStatus("Migração verificada. Gravação dupla piloto ativa nesta conta.");
        });
    }

    document.getElementById("btnMigrationPilot")?.addEventListener("click", migratePilot);
    verifyIntegrityButton?.addEventListener("click", verifyPilotIntegrity);
    enableReadButton?.addEventListener("click", async () => {
        enableReadButton.disabled = true;
        try {
            setStatus("Validando coleções antes de ativar a leitura v2…");
            await window.SensoV2Sync.setReadMode("v2-pilot");
            setStatus("Leitura v2 piloto ativada e validada. Recarregando…");
            setTimeout(() => location.reload(), 500);
        } catch (error) {
            setStatus(`Leitura v2 não ativada: ${error.message || error}`, true);
            enableReadButton.disabled = false;
        }
    });
    disableReadButton?.addEventListener("click", async () => {
        disableReadButton.disabled = true;
        try {
            await window.SensoV2Sync.setReadMode("legacy");
            location.reload();
        } catch (error) {
            setStatus(`Não foi possível voltar à leitura antiga: ${error.message || error}`, true);
            disableReadButton.disabled = false;
        }
    });
    window.addEventListener("senso-auth-ready", initialize);
    window.addEventListener("senso-v2-sync", event => {
        if (state.running) return;
        if (event.detail?.type === "success") {
            setStatus(`Gravação dupla confirmada: ${event.detail.operations} alteração(ões) sincronizada(s).`);
        } else if (event.detail?.type === "error") {
            setStatus(`Falha na cópia v2; appData antigo continua salvo: ${event.detail.error?.message || "erro desconhecido"}`, true);
        } else if (event.detail?.type === "read-success") {
            const syncState = window.SensoV2Sync?.state || {};
            const syncInfo = syncState.lastSuccessAt
                ? ` Última gravação dupla: ${syncState.lastOperations} alteração(ões), em ${new Date(syncState.lastSuccessAt).toLocaleString("pt-BR")}.`
                : "";
            setStatus(`Leitura v2 confirmada: todas as coleções possuem as quantidades esperadas.${syncInfo}`);
        } else if (event.detail?.type === "read-fallback") {
            setStatus(`Leitura antiga mantida por segurança: ${event.detail.error?.message || "divergência nas coleções"}`, true);
        }
    });
    if (window.SensoAuth?.profile) initialize({ detail: { isAdmin: window.SensoAuth.isAdmin } });
})();
