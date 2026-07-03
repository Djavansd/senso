"use strict";

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

initializeApp();

const COLLECTIONS = ["clientes", "servicos", "agenda", "financeiro", "orcamentos", "correcoes"];
const REGION = "southamerica-east1";

function safeDocId(value, collection, index) {
    return String(value || `legacy-${collection}-${index}`).replaceAll("/", "_").slice(0, 500);
}

function cleanDocument(data) {
    const clean = { ...(data || {}) };
    delete clean._migration;
    delete clean._sync;
    return clean;
}

async function writeIfCurrent(db, ref, data, version, profileId) {
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const currentVersion = Number(snapshot.data()?._sync?.legacyVersion || 0);
        if (currentVersion > version) return;
        transaction.set(ref, {
            ...cleanDocument(data),
            _sync: {
                source: "cloud-function",
                profileId,
                legacyVersion: version,
                syncedAt: Timestamp.now()
            }
        });
    });
}

async function deleteIfStale(db, ref, version) {
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const currentVersion = Number(snapshot.data()?._sync?.legacyVersion || 0);
        if (currentVersion > version) return;
        transaction.delete(ref);
    });
}

exports.syncAppDataV2 = onDocumentWritten({ document: "users/{uid}/appData/{profileId}", region: REGION }, async event => {
    const after = event.data?.after;
    if (!after?.exists) {
        logger.info("appData removido; v2 preservada por segurança.", event.params);
        return;
    }

    const db = getFirestore();
    const { uid, profileId } = event.params;
    const payload = after.data() || {};
    const sourceData = payload.data || {};
    const version = Number(payload.updatedAt || sourceData.updatedAt || Date.now());
    const profileRef = db.collection("users").doc(uid).collection("profiles").doc(profileId);
    const counts = {};

    for (const collection of COLLECTIONS) {
        const items = Array.isArray(sourceData[collection]) ? sourceData[collection] : [];
        const desiredIds = new Set();
        counts[collection] = items.length;

        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            const id = safeDocId(item?.id, collection, index);
            desiredIds.add(id);
            await writeIfCurrent(db, profileRef.collection(collection).doc(id), item, version, profileId);
        }

        const existing = await profileRef.collection(collection).get();
        for (const document of existing.docs) {
            if (!desiredIds.has(document.id)) await deleteIfStale(db, document.ref, version);
        }
    }

    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(profileRef);
        const manifest = snapshot.data() || {};
        const currentVersion = Number(manifest.legacyUpdatedAt || 0);
        if (currentVersion > version) return;
        transaction.set(profileRef, {
            schemaVersion: 2,
            migrationStatus: "verified",
            migratedAt: manifest.migratedAt || FieldValue.serverTimestamp(),
            backendSyncStatus: "active",
            backendSyncedAt: FieldValue.serverTimestamp(),
            legacyUpdatedAt: version,
            readMode: manifest.readMode === "v2-pilot" ? "v2-pilot" : "legacy",
            counts
        }, { merge: true });
    });

    logger.info("Estrutura v2 sincronizada pelo backend.", { uid, profileId, version, counts });
});

exports.deleteSensoUser = onCall({ region: REGION, invoker: "public", enforceAppCheck: true }, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Autenticação obrigatória.");

    const actorUid = request.auth.uid;
    const token = request.auth.token || {};
    const secondFactor = token.firebase?.sign_in_second_factor;
    const authTime = Number(token.auth_time || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (token.email_verified !== true || secondFactor !== "phone") {
        throw new HttpsError("permission-denied", "Senha e MFA administrativos são obrigatórios.");
    }
    if (!authTime || nowSeconds - authTime > 300) {
        throw new HttpsError("failed-precondition", "Autenticação administrativa recente obrigatória.");
    }

    const targetUid = String(request.data?.targetUid || "").trim();
    if (!targetUid || targetUid === actorUid || request.data?.confirmation !== "EXCLUIR") {
        throw new HttpsError("invalid-argument", "Confirmação de exclusão inválida.");
    }

    const db = getFirestore();
    const actorRef = db.collection("users").doc(actorUid);
    const targetRef = db.collection("users").doc(targetUid);
    const [actorSnapshot, targetSnapshot] = await Promise.all([actorRef.get(), targetRef.get()]);
    const actor = actorSnapshot.data() || {};
    const target = targetSnapshot.data() || {};
    if (!actorSnapshot.exists || actor.admin !== true || actor.autorizado !== true || actor.status !== "ativo") {
        throw new HttpsError("permission-denied", "Conta administrativa não autorizada.");
    }
    if (target.admin === true) {
        throw new HttpsError("permission-denied", "Contas administrativas não podem ser excluídas por este fluxo.");
    }

    const auth = getAuth();
    try {
        await auth.updateUser(targetUid, { disabled: true });
    } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
    }

    try {
        await db.recursiveDelete(targetRef);
        try {
            await auth.deleteUser(targetUid);
        } catch (error) {
            if (error.code !== "auth/user-not-found") throw error;
        }

        await db.collection("adminAudit").add({
            action: "excluir_usuario",
            actorUid,
            actorEmail: token.email || "",
            targetUid,
            targetEmail: target.email || "",
            targetName: target.nome || "",
            createdAt: FieldValue.serverTimestamp()
        });
        logger.warn("Usuário excluído pelo painel administrativo.", { actorUid, targetUid });
        return { success: true, targetUid };
    } catch (error) {
        logger.error("Falha durante exclusão administrativa.", { actorUid, targetUid, error });
        throw new HttpsError("internal", "Não foi possível concluir a exclusão.");
    }
});
