(function (global) {
    "use strict";

    const COLLECTIONS = ["clientes", "servicos", "agenda", "financeiro", "orcamentos", "correcoes"];
    const state = {
        enabled: false,
        checking: false,
        syncing: false,
        lastSuccessAt: null,
        lastOperations: 0,
        readMode: "legacy",
        readSource: "legacy",
        lastError: null
    };
    let enablePromise = null;
    let baselinePromise = null;
    let baseline = new Map();
    let timer = null;
    let queuedData = null;
    let manifestCache = null;
    let hydrating = false;

    function fingerprint(value) {
        const text = String(value || "");
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function baselineStorageKey() {
        return `senso:v2-baseline:${uid() || "anon"}:${profileId()}`;
    }

    function hydrateStorageKey() {
        return `senso:v2-hydrated:${uid() || "anon"}:${profileId()}`;
    }

    function restoreBaseline(version) {
        try {
            const cached = JSON.parse(global.sessionStorage.getItem(baselineStorageKey()) || "null");
            if (!cached || Number(cached.version || 0) !== Number(version || 0)) return false;
            const restored = new Map();
            COLLECTIONS.forEach(collection => {
                restored.set(collection, new Map(Object.entries(cached.collections?.[collection] || {})));
            });
            baseline = restored;
            return true;
        } catch (_error) {
            return false;
        }
    }

    function persistBaseline(version) {
        try {
            const collections = {};
            COLLECTIONS.forEach(collection => {
                collections[collection] = Object.fromEntries(baseline.get(collection) || new Map());
            });
            global.sessionStorage.setItem(baselineStorageKey(), JSON.stringify({
                version: Number(version || 0),
                collections
            }));
        } catch (_error) {
            // Se o navegador limitar sessionStorage, a sincronização continua usando o servidor.
        }
    }

    function uid() {
        return global.SensoAuth?.uid || global.firebase?.auth?.()?.currentUser?.uid || null;
    }

    function profileId() {
        return global.SensoProfile?.getActiveProfile?.()?.id || "mecanica";
    }

    function profileRef() {
        const currentUid = uid();
        if (!currentUid || !global.firebase?.firestore) return null;
        return global.firebase.firestore().collection("users").doc(currentUid).collection("profiles").doc(profileId());
    }

    function safeDocId(value, collection, index) {
        return String(value || `legacy-${collection}-${index}`).replaceAll("/", "_").slice(0, 500);
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

    function dispatchStatus(type, detail) {
        global.dispatchEvent(new CustomEvent("senso-v2-sync", { detail: { type, state: { ...state }, ...(detail || {}) } }));
    }

    function accountCanSync() {
        const profile = global.SensoAuth?.profile;
        return !!uid() && profile?.autorizado === true && profile?.status === "ativo";
    }

    async function ensureEnabled() {
        if (state.enabled) return true;
        if (enablePromise) return enablePromise;
        if (!accountCanSync() || global.SensoAuth?.isAdmin !== true) return false;
        const ref = profileRef();
        if (!ref) return false;

        state.checking = true;
        enablePromise = ref.get({ source: "server" })
            .then(snapshot => {
                const manifest = snapshot.data() || {};
                manifestCache = manifest;
                state.enabled = snapshot.exists && manifest.migrationStatus === "verified" && manifest.schemaVersion === 2;
                state.readMode = manifest.readMode === "v2-pilot" ? "v2-pilot" : "legacy";
                state.lastSuccessAt = manifest.lastDualWriteChangeAt?.toMillis?.()
                    || (Number(manifest.lastDualWriteOperations || 0) > 0 ? manifest.lastDualWriteAt?.toMillis?.() : null)
                    || null;
                state.lastOperations = Number(manifest.lastDualWriteChangeOperations
                    || (Number(manifest.lastDualWriteOperations || 0) > 0 ? manifest.lastDualWriteOperations : 0));
                return state.enabled;
            })
            .catch(error => {
                state.lastError = error;
                return false;
            })
            .finally(() => { state.checking = false; });
        return enablePromise;
    }

    async function loadBaseline() {
        if (baselinePromise) return baselinePromise;
        if (restoreBaseline(manifestCache?.legacyUpdatedAt)) {
            baselinePromise = Promise.resolve(baseline);
            return baselinePromise;
        }
        const ref = profileRef();
        if (!ref) return baseline;

        baselinePromise = Promise.all(COLLECTIONS.map(async collection => {
            const snapshot = await ref.collection(collection).get({ source: "server" });
            const documents = new Map();
            snapshot.docs.forEach(doc => documents.set(doc.id, fingerprint(serialized(cleanDocument(doc.data())))));
            baseline.set(collection, documents);
        })).then(() => {
            persistBaseline(manifestCache?.legacyUpdatedAt);
            return baseline;
        });
        return baselinePromise;
    }

    async function commitChunks(db, operations) {
        for (let start = 0; start < operations.length; start += 400) {
            const batch = db.batch();
            operations.slice(start, start + 400).forEach(operation => {
                if (operation.type === "delete") batch.delete(operation.ref);
                else batch.set(operation.ref, operation.data, { merge: true });
            });
            await batch.commit();
        }
    }

    async function syncNow(data) {
        if (state.syncing) {
            queuedData = data;
            return;
        }
        if (!await ensureEnabled()) return;

        state.syncing = true;
        state.lastError = null;
        dispatchStatus("started");
        try {
            const incomingUpdatedAt = Number(data?.updatedAt || 0);
            const serverUpdatedAt = Number(manifestCache?.legacyUpdatedAt || 0);
            if (serverUpdatedAt > incomingUpdatedAt) {
                dispatchStatus("waiting-legacy-hydration", { incomingUpdatedAt, serverUpdatedAt });
                return;
            }
            await loadBaseline();
            const db = global.firebase.firestore();
            const ref = profileRef();
            const operations = [];
            const nextBaseline = new Map();
            const counts = {};

            COLLECTIONS.forEach(collection => {
                const items = Array.isArray(data?.[collection]) ? data[collection] : [];
                const existing = baseline.get(collection) || new Map();
                const next = new Map();
                counts[collection] = items.length;

                items.forEach((item, index) => {
                    const id = safeDocId(item?.id, collection, index);
                    const clean = cleanDocument(item);
                    const raw = fingerprint(serialized(clean));
                    next.set(id, raw);
                    if (existing.get(id) !== raw) {
                        operations.push({
                            type: "set",
                            ref: ref.collection(collection).doc(id),
                            data: {
                                ...clean,
                                _sync: {
                                    source: "dual-write",
                                    profileId: profileId(),
                                    syncedAt: global.firebase.firestore.Timestamp.now()
                                }
                            }
                        });
                    }
                });

                existing.forEach((_raw, id) => {
                    if (!next.has(id)) operations.push({ type: "delete", ref: ref.collection(collection).doc(id) });
                });
                nextBaseline.set(collection, next);
            });

            await commitChunks(db, operations);
            const manifestUpdate = {
                dualWriteStatus: "active",
                lastDualWriteAt: global.firebase.firestore.FieldValue.serverTimestamp(),
                lastDualWriteOperations: operations.length,
                legacyUpdatedAt: Number(data?.updatedAt || Date.now()),
                counts
            };
            if (operations.length > 0) {
                manifestUpdate.lastDualWriteChangeAt = global.firebase.firestore.FieldValue.serverTimestamp();
                manifestUpdate.lastDualWriteChangeOperations = operations.length;
            }
            await ref.set(manifestUpdate, { merge: true });
            manifestCache = { ...(manifestCache || {}), ...manifestUpdate };

            baseline = nextBaseline;
            persistBaseline(manifestUpdate.legacyUpdatedAt);
            if (operations.length > 0) {
                state.lastSuccessAt = Date.now();
                state.lastOperations = operations.length;
            }
            dispatchStatus("success", { operations: operations.length, counts });
        } catch (error) {
            state.lastError = error;
            console.error("Falha na gravação dupla v2.", error);
            dispatchStatus("error", { error });
        } finally {
            state.syncing = false;
            if (queuedData) {
                const next = queuedData;
                queuedData = null;
                syncNow(next);
            }
        }
    }

    function queue(data) {
        queuedData = JSON.parse(JSON.stringify(data || {}));
        clearTimeout(timer);
        timer = setTimeout(() => {
            const next = queuedData;
            queuedData = null;
            syncNow(next);
        }, 800);
    }

    function resetPilotCheck() {
        try {
            global.sessionStorage.removeItem(baselineStorageKey());
            global.sessionStorage.removeItem(hydrateStorageKey());
        } catch (_error) {}
        state.enabled = false;
        enablePromise = null;
        baselinePromise = null;
        baseline = new Map();
    }

    async function resumePilotSync() {
        if (!accountCanSync() || global.SensoAuth?.isAdmin !== true || typeof global.getData !== "function") return;
        if (!await ensureEnabled()) return;
        const currentData = global.getData();
        if (currentData) syncNow(JSON.parse(JSON.stringify(currentData)));
    }

    async function hydrateFromV2() {
        try {
            if (global.sessionStorage.getItem(hydrateStorageKey()) === "1") return false;
        } catch (_error) {}
        if (hydrating) return false;
        hydrating = true;
        if (!await ensureEnabled() || state.readMode !== "v2-pilot" || global.SensoAuth?.isAdmin !== true) {
            hydrating = false;
            return false;
        }
        const ref = profileRef();
        if (!ref) return false;

        try {
            const snapshots = await Promise.all(COLLECTIONS.map(collection => ref.collection(collection).get({ source: "server" })));
            const data = { updatedAt: Number(manifestCache?.legacyUpdatedAt || Date.now()) };
            snapshots.forEach((snapshot, index) => {
                const collection = COLLECTIONS[index];
                const expected = Number(manifestCache?.counts?.[collection] ?? snapshot.size);
                if (snapshot.size !== expected) throw new Error(`${collection}: esperado ${expected}, encontrado ${snapshot.size}`);
                data[collection] = snapshot.docs.map(doc => cleanDocument(doc.data()));
                baseline.set(collection, new Map(snapshot.docs.map(doc => [
                    doc.id,
                    fingerprint(serialized(cleanDocument(doc.data())))
                ])));
            });

            const storageKey = `appData:${profileId()}:uid:${uid()}`;
            global.localStorage.setItem(storageKey, JSON.stringify(data));
            state.readSource = "v2";
            persistBaseline(manifestCache?.legacyUpdatedAt);
            try { global.sessionStorage.setItem(hydrateStorageKey(), "1"); } catch (_error) {}
            dispatchStatus("read-success", { counts: manifestCache?.counts || {} });
            global.dispatchEvent(new CustomEvent("senso-live-update", { detail: { source: "v2-hydrate", ts: Date.now() } }));
            hydrating = false;
            return true;
        } catch (error) {
            state.readSource = "legacy-fallback";
            state.lastError = error;
            console.error("Leitura v2 recusada; mantendo appData.", error);
            dispatchStatus("read-fallback", { error });
            hydrating = false;
            return false;
        }
    }

    async function setReadMode(mode) {
        if (global.SensoAuth?.isAdmin !== true) throw new Error("Leitura v2 piloto restrita ao administrador.");
        if (!await ensureEnabled()) throw new Error("Migração v2 não verificada.");
        const nextMode = mode === "v2-pilot" ? "v2-pilot" : "legacy";
        await profileRef().set({ readMode: nextMode }, { merge: true });
        state.readMode = nextMode;
        manifestCache = { ...(manifestCache || {}), readMode: nextMode };
        if (nextMode === "v2-pilot") await hydrateFromV2();
        return nextMode;
    }

    global.SensoV2Sync = { state, queue, syncNow, ensureEnabled, resetPilotCheck, resumePilotSync, hydrateFromV2, setReadMode };
    global.addEventListener("senso-v2-migration-verified", resetPilotCheck);
    global.addEventListener("senso-auth-ready", () => {
        setTimeout(hydrateFromV2, 700);
    });
    global.addEventListener("senso-live-update", event => {
        if (event.detail?.source !== "cloud-hydrate") return;
        setTimeout(resumePilotSync, 100);
    });
    if (global.SensoAuth?.profile) {
        setTimeout(hydrateFromV2, 700);
    }
})(window);
