"use strict";

const crypto = require("crypto");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

initializeApp();

const COLLECTIONS = ["clientes", "servicos", "agenda", "financeiro", "orcamentos", "correcoes"];
const REGION = "southamerica-east1";
const MERCADO_PAGO_ACCESS_TOKEN_TEST = defineSecret("MERCADO_PAGO_ACCESS_TOKEN_TEST");
const MERCADO_PAGO_WEBHOOK_SECRET_TEST = defineSecret("MERCADO_PAGO_WEBHOOK_SECRET_TEST");
const MERCADO_PAGO_API = "https://api.mercadopago.com";
const MERCADO_PAGO_PLANS = Object.freeze({
    basico: { name: "Senso Básico Mensal", amount: 29.90 },
    pro: { name: "Senso Pro Mensal", amount: 59.90 }
});

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

async function mercadoPagoRequest(path, accessToken, options = {}) {
    const response = await fetch(`${MERCADO_PAGO_API}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
    if (!response.ok) {
        const error = new Error(`Mercado Pago respondeu ${response.status}.`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }
    return payload;
}

function parseMercadoPagoReference(value) {
    const match = /^senso:([^:]+):(basico|pro)$/.exec(String(value || ""));
    return match ? { uid: match[1], plan: match[2] } : null;
}

function extractWebhookSignature(value) {
    return String(value || "").split(",").reduce((parts, item) => {
        const separator = item.indexOf("=");
        if (separator < 1) return parts;
        parts[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
        return parts;
    }, {});
}

function validWebhookSignature(request, secret) {
    const signature = extractWebhookSignature(request.get("x-signature"));
    const requestId = String(request.get("x-request-id") || "").trim();
    const dataId = String(request.query?.["data.id"] || request.query?.data_id || request.body?.data?.id || "").trim().toLowerCase();
    if (!signature.ts || !signature.v1 || !requestId || !dataId) return false;
    const manifest = `id:${dataId};request-id:${requestId};ts:${signature.ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    const receivedBuffer = Buffer.from(signature.v1, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function safeEventId(value) {
    return String(value || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 240);
}

function subscriptionValidity(subscription) {
    const next = subscription?.next_payment_date || subscription?.auto_recurring?.end_date;
    const parsed = next ? new Date(next) : null;
    if (parsed && Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now()) return Timestamp.fromDate(parsed);
    return Timestamp.fromMillis(Date.now() + (30 * 24 * 60 * 60 * 1000));
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

exports.createMercadoPagoSubscription = onCall({
    region: REGION,
    invoker: "public",
    enforceAppCheck: true,
    secrets: [MERCADO_PAGO_ACCESS_TOKEN_TEST]
}, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Entre na sua conta para contratar um plano.");
    if (request.auth.token.email_verified !== true) {
        throw new HttpsError("failed-precondition", "Confirme seu e-mail antes de contratar.");
    }

    const planKey = String(request.data?.plan || "").trim().toLowerCase();
    const plan = MERCADO_PAGO_PLANS[planKey];
    if (!plan) throw new HttpsError("invalid-argument", "Plano inválido.");

    const uid = request.auth.uid;
    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();
    const user = userSnapshot.data() || {};
    if (!userSnapshot.exists || user.autorizado !== true || user.status === "bloqueado") {
        throw new HttpsError("permission-denied", "Sua conta ainda não está liberada para contratar.");
    }
    if (user.admin !== true && user.mercadoPagoTesteAutorizado !== true) {
        throw new HttpsError("permission-denied", "Checkout de teste restrito a contas autorizadas.");
    }

    const payerEmail = String(request.auth.token.email || user.email || "").trim().toLowerCase();
    if (!payerEmail) throw new HttpsError("failed-precondition", "E-mail da conta não encontrado.");

    try {
        const subscription = await mercadoPagoRequest("/preapproval", MERCADO_PAGO_ACCESS_TOKEN_TEST.value(), {
            method: "POST",
            headers: { "X-Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({
                reason: plan.name,
                external_reference: `senso:${uid}:${planKey}`,
                payer_email: payerEmail,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: "months",
                    transaction_amount: plan.amount,
                    currency_id: "BRL"
                },
                back_url: "https://www.senso.app.br/public/pages/pagamento-app.html?mercadopago=retorno",
                notification_url: "https://southamerica-east1-senso-6d92a.cloudfunctions.net/mercadoPagoWebhook?source_news=webhooks",
                status: "pending"
            })
        });

        const checkoutUrl = subscription.sandbox_init_point || subscription.init_point;
        if (!subscription.id || !checkoutUrl) throw new Error("Checkout de teste não retornado pelo Mercado Pago.");

        await userRef.set({
            mercadoPago: {
                ambiente: "test",
                assinaturaId: subscription.id,
                planoSolicitado: planKey,
                status: subscription.status || "pending",
                checkoutCriadoEm: FieldValue.serverTimestamp(),
                atualizadoEm: FieldValue.serverTimestamp()
            },
            origemPlano: user.origemPlano || "manual"
        }, { merge: true });

        return { checkoutUrl, subscriptionId: subscription.id, plan: planKey, environment: "test" };
    } catch (error) {
        logger.error("Falha ao criar assinatura de teste.", { uid, planKey, status: error.status, detail: error.payload?.message });
        throw new HttpsError("internal", "Não foi possível iniciar a assinatura de teste.");
    }
});

exports.mercadoPagoWebhook = onRequest({
    region: REGION,
    invoker: "public",
    secrets: [MERCADO_PAGO_ACCESS_TOKEN_TEST, MERCADO_PAGO_WEBHOOK_SECRET_TEST]
}, async (request, response) => {
    if (request.method !== "POST") {
        response.status(405).send("Method Not Allowed");
        return;
    }

    if (!validWebhookSignature(request, MERCADO_PAGO_WEBHOOK_SECRET_TEST.value())) {
        logger.warn("Webhook Mercado Pago com assinatura inválida.");
        response.status(401).send("Invalid signature");
        return;
    }

    const topic = String(request.query?.type || request.body?.type || request.query?.topic || "").trim();
    const resourceId = String(request.query?.["data.id"] || request.query?.data_id || request.body?.data?.id || "").trim();
    const requestId = String(request.get("x-request-id") || "").trim();
    const db = getFirestore();
    const eventRef = db.collection("mercadoPagoWebhookEvents").doc(safeEventId(requestId || `${topic}-${resourceId}`));

    try {
        const previous = await eventRef.get();
        if (previous.data()?.processedAt) {
            response.status(200).send("Already processed");
            return;
        }
        await eventRef.set({ topic, resourceId, receivedAt: FieldValue.serverTimestamp(), status: "processing" }, { merge: true });

        let subscription;
        let payment = null;
        if (topic === "subscription_preapproval") {
            subscription = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(resourceId)}`, MERCADO_PAGO_ACCESS_TOKEN_TEST.value());
        } else if (topic === "subscription_authorized_payment") {
            payment = await mercadoPagoRequest(`/authorized_payments/${encodeURIComponent(resourceId)}`, MERCADO_PAGO_ACCESS_TOKEN_TEST.value());
            const subscriptionId = payment.preapproval_id || payment.subscription_id;
            if (!subscriptionId) throw new Error("Pagamento sem assinatura vinculada.");
            subscription = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(subscriptionId)}`, MERCADO_PAGO_ACCESS_TOKEN_TEST.value());
        } else {
            await eventRef.set({ status: "ignored", processedAt: FieldValue.serverTimestamp() }, { merge: true });
            response.status(200).send("Ignored");
            return;
        }

        const reference = parseMercadoPagoReference(subscription.external_reference);
        if (!reference) throw new Error("Assinatura sem referência válida do Senso.");
        const expectedPlan = MERCADO_PAGO_PLANS[reference.plan];
        const amount = Number(subscription.auto_recurring?.transaction_amount);
        const currency = subscription.auto_recurring?.currency_id;
        if (!expectedPlan || amount !== expectedPlan.amount || currency !== "BRL") {
            throw new Error("Plano, valor ou moeda divergente.");
        }

        const userRef = db.collection("users").doc(reference.uid);
        const userSnapshot = await userRef.get();
        if (!userSnapshot.exists) throw new Error("Usuário da assinatura não encontrado.");
        const user = userSnapshot.data() || {};
        const payerEmail = String(subscription.payer_email || "").trim().toLowerCase();
        if (payerEmail && String(user.email || "").trim().toLowerCase() !== payerEmail) {
            throw new Error("E-mail da assinatura não corresponde ao usuário.");
        }

        const update = {
            mercadoPago: {
                ambiente: "test",
                assinaturaId: subscription.id,
                planoSolicitado: reference.plan,
                status: subscription.status || "unknown",
                ultimaFaturaId: payment?.id || null,
                ultimaFaturaStatus: payment?.status || null,
                atualizadoEm: FieldValue.serverTimestamp()
            }
        };

        const paymentApproved = topic === "subscription_authorized_payment" && payment?.status === "approved";
        const manualOverride = user.controleAssinatura === "manual";
        if (paymentApproved && !manualOverride) {
            Object.assign(update, {
                plano: reference.plan,
                precoContratado: expectedPlan.amount,
                tipoPagamento: "mensal",
                tipoPlano: "normal",
                autorizado: true,
                status: "ativo",
                validade: subscriptionValidity(subscription),
                origemPlano: "mercado_pago",
                controleAssinatura: "automatico",
                ultimaConfirmacaoPagamento: FieldValue.serverTimestamp()
            });
        }

        await userRef.set(update, { merge: true });
        await eventRef.set({
            status: "processed",
            uid: reference.uid,
            subscriptionId: subscription.id,
            paymentApproved,
            manualOverride,
            processedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        response.status(200).send("OK");
    } catch (error) {
        logger.error("Falha no webhook Mercado Pago.", { topic, resourceId, message: error.message, status: error.status });
        await eventRef.set({ status: "error", error: String(error.message || "unknown").slice(0, 300), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        response.status(500).send("Processing failed");
    }
});
