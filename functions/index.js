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
const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";
const ENFORCE_APP_CHECK = !IS_FUNCTIONS_EMULATOR;
const MERCADO_PAGO_ACCESS_TOKEN_TEST = defineSecret("MERCADO_PAGO_ACCESS_TOKEN_TEST");
const MERCADO_PAGO_WEBHOOK_SECRET_TEST = defineSecret("MERCADO_PAGO_WEBHOOK_SECRET_TEST");
const MERCADO_PAGO_ACCESS_TOKEN_PROD = defineSecret("MERCADO_PAGO_ACCESS_TOKEN_PROD");
const MERCADO_PAGO_WEBHOOK_SECRET_PROD = defineSecret("MERCADO_PAGO_WEBHOOK_SECRET_PROD");
const ABACATEPAY_API_KEY_DEV = defineSecret("ABACATEPAY_API_KEY_DEV");
const ABACATEPAY_WEBHOOK_SECRET_DEV = defineSecret("ABACATEPAY_WEBHOOK_SECRET_DEV");
const MERCADO_PAGO_API = "https://api.mercadopago.com";
const ABACATEPAY_API = "https://api.abacatepay.com/v2";
const ABACATEPAY_PUBLIC_HMAC_KEY = "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";
const MERCADO_PAGO_PLANS = Object.freeze({
    basico: { name: "Senso Básico Mensal", amount: 29.90 },
    pro: { name: "Senso Pro Mensal", amount: 59.90 }
});
const ABACATEPAY_DEV_PLANS = Object.freeze({
    basico: { name: "Senso Básico Mensal", amountCents: 2990, productId: "prod_JPtH3zTayW2YebK63aDK0sZM" },
    pro: { name: "Senso Pro Mensal", amountCents: 5990, productId: "prod_adDUYcpEXGEp0XzDseg6BB1P" }
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

async function abacatePayRequest(path, apiKey, options = {}) {
    const response = await fetch(`${ABACATEPAY_API}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${String(apiKey || "").trim()}`,
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
    if (!response.ok || payload.success === false) {
        const error = new Error(`AbacatePay respondeu ${response.status}.`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }
    return payload.data;
}

function parseAbacateReference(value) {
    const match = /^senso:([^:]+):(basico|pro):[a-zA-Z0-9_-]+$/.exec(String(value || ""));
    return match ? { uid: match[1], plan: match[2] } : null;
}

function validAbacateSignature(request) {
    const signature = String(request.get("x-webhook-signature") || request.get("x-abacate-signature") || "").trim();
    if (!signature || !request.rawBody) return false;
    const expected = crypto.createHmac("sha256", ABACATEPAY_PUBLIC_HMAC_KEY).update(request.rawBody).digest("base64");
    const receivedBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
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

exports.deleteSensoUser = onCall({ region: REGION, invoker: "public", enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
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
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [MERCADO_PAGO_ACCESS_TOKEN_TEST]
}, async request => {
    const simulatorUid = IS_FUNCTIONS_EMULATOR ? String(request.data?.simulatorUid || "").trim() : "";
    if (!request.auth && !simulatorUid) throw new HttpsError("unauthenticated", "Entre na sua conta para contratar um plano.");
    if (!IS_FUNCTIONS_EMULATOR && request.auth.token.email_verified !== true) {
        throw new HttpsError("failed-precondition", "Confirme seu e-mail antes de contratar.");
    }

    const planKey = String(request.data?.plan || "").trim().toLowerCase();
    const plan = MERCADO_PAGO_PLANS[planKey];
    if (!plan) throw new HttpsError("invalid-argument", "Plano inválido.");

    const uid = request.auth?.uid || simulatorUid;
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

    const payerEmail = String(request.auth?.token?.email || user.email || "").trim().toLowerCase();
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

exports.createMercadoPagoProductionSubscription = onCall({
    region: REGION,
    invoker: "public",
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [MERCADO_PAGO_ACCESS_TOKEN_PROD]
}, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Entre na sua conta para contratar.");
    if (request.auth.token.email_verified !== true) {
        throw new HttpsError("failed-precondition", "Confirme seu e-mail antes de contratar.");
    }
    const planKey = String(request.data?.plan || "").trim().toLowerCase();
    const plan = MERCADO_PAGO_PLANS[planKey];
    if (!plan) throw new HttpsError("invalid-argument", "Plano inválido.");

    const uid = request.auth.uid;
    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const snapshot = await userRef.get();
    const user = snapshot.data() || {};
    if (!snapshot.exists || user.autorizado !== true || user.status === "bloqueado") {
        throw new HttpsError("permission-denied", "Sua conta ainda não está liberada para contratar.");
    }
    const payerEmail = String(request.auth.token.email || user.email || "").trim().toLowerCase();

    try {
        const subscription = await mercadoPagoRequest("/preapproval", MERCADO_PAGO_ACCESS_TOKEN_PROD.value(), {
            method: "POST",
            headers: { "X-Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({
                reason: plan.name,
                external_reference: `senso:${uid}:${planKey}`,
                payer_email: payerEmail,
                auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: plan.amount, currency_id: "BRL" },
                back_url: "https://www.senso.app.br/pages/pagamento-app.html?mercadopago=retorno",
                notification_url: "https://southamerica-east1-senso-6d92a.cloudfunctions.net/mercadoPagoWebhook?source_news=webhooks",
                status: "pending"
            })
        });
        if (!subscription.id || !subscription.init_point) throw new Error("Checkout de produção não retornado.");
        await userRef.set({
            mercadoPago: {
                ambiente: "production",
                assinaturaId: subscription.id,
                planoSolicitado: planKey,
                status: subscription.status || "pending",
                checkoutCriadoEm: FieldValue.serverTimestamp(),
                atualizadoEm: FieldValue.serverTimestamp()
            }
        }, { merge: true });
        return { checkoutUrl: subscription.init_point, subscriptionId: subscription.id, plan: planKey, environment: "production" };
    } catch (error) {
        logger.error("Falha ao criar assinatura de produção.", { uid, planKey, status: error.status, detail: error.payload?.message });
        throw new HttpsError("internal", "Não foi possível iniciar a assinatura de produção.");
    }
});

exports.reconcileMercadoPagoSubscription = onCall({
    region: REGION,
    invoker: "public",
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [MERCADO_PAGO_ACCESS_TOKEN_TEST, MERCADO_PAGO_ACCESS_TOKEN_PROD]
}, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Entre na sua conta para conferir o pagamento.");

    const uid = request.auth.uid;
    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) throw new HttpsError("not-found", "Usuário não encontrado.");
    const user = userSnapshot.data() || {};
    const subscriptionId = String(user.mercadoPago?.assinaturaId || "").trim();
    if (!subscriptionId) throw new HttpsError("failed-precondition", "Nenhuma assinatura para conferir.");

    try {
        const environment = user.mercadoPago?.ambiente === "production" ? "production" : "test";
        const token = environment === "production" ? MERCADO_PAGO_ACCESS_TOKEN_PROD.value() : MERCADO_PAGO_ACCESS_TOKEN_TEST.value();
        const subscription = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(subscriptionId)}`, token);
        const reference = parseMercadoPagoReference(subscription.external_reference);
        if (!reference || reference.uid !== uid) throw new Error("Assinatura não pertence ao usuário autenticado.");
        const expectedPlan = MERCADO_PAGO_PLANS[reference.plan];
        const amount = Number(subscription.auto_recurring?.transaction_amount);
        if (!expectedPlan || amount !== expectedPlan.amount || subscription.auto_recurring?.currency_id !== "BRL") {
            throw new Error("Plano, valor ou moeda divergente.");
        }

        const invoices = await mercadoPagoRequest(`/authorized_payments/search?preapproval_id=${encodeURIComponent(subscriptionId)}`, token);
        const approvedInvoice = (Array.isArray(invoices.results) ? invoices.results : [])
            .filter(item => item?.payment?.status === "approved" && Number(item.transaction_amount) === expectedPlan.amount)
            .sort((a, b) => new Date(b.last_modified || b.date_created || 0) - new Date(a.last_modified || a.date_created || 0))[0];

        if (!approvedInvoice) {
            await userRef.set({ mercadoPago: { atualizadoEm: FieldValue.serverTimestamp(), status: subscription.status || "pending" } }, { merge: true });
            return { approved: false, status: subscription.status || "pending" };
        }

        const manualOverride = user.controleAssinatura === "manual";
        const update = {
            mercadoPago: {
                ambiente: environment,
                assinaturaId: subscription.id,
                planoSolicitado: reference.plan,
                status: subscription.status || "authorized",
                ultimaFaturaId: approvedInvoice.id || approvedInvoice.payment?.id || null,
                ultimaFaturaStatus: "approved",
                atualizadoEm: FieldValue.serverTimestamp()
            },
            ultimaConfirmacaoPagamento: FieldValue.serverTimestamp()
        };
        if (!manualOverride) Object.assign(update, {
            plano: reference.plan,
            precoContratado: expectedPlan.amount,
            tipoPagamento: "mensal",
            tipoPlano: "normal",
            autorizado: true,
            status: "ativo",
            validade: subscriptionValidity(subscription),
            origemPlano: "mercado_pago",
            controleAssinatura: "automatico"
        });
        await userRef.set(update, { merge: true });
        return { approved: true, plan: reference.plan, manualOverride };
    } catch (error) {
        logger.error("Falha ao reconciliar assinatura Mercado Pago.", { uid, subscriptionId, status: error.status, detail: error.payload?.message || error.message });
        throw new HttpsError("internal", "Não foi possível conferir o pagamento agora.");
    }
});

exports.mercadoPagoWebhook = onRequest({
    region: REGION,
    invoker: "public",
    secrets: [MERCADO_PAGO_ACCESS_TOKEN_TEST, MERCADO_PAGO_WEBHOOK_SECRET_TEST, MERCADO_PAGO_ACCESS_TOKEN_PROD, MERCADO_PAGO_WEBHOOK_SECRET_PROD]
}, async (request, response) => {
    if (request.method !== "POST") {
        response.status(405).send("Method Not Allowed");
        return;
    }

    const isProduction = validWebhookSignature(request, MERCADO_PAGO_WEBHOOK_SECRET_PROD.value());
    const isTest = !isProduction && validWebhookSignature(request, MERCADO_PAGO_WEBHOOK_SECRET_TEST.value());
    if (!isProduction && !isTest) {
        logger.warn("Webhook Mercado Pago com assinatura inválida.");
        response.status(401).send("Invalid signature");
        return;
    }

    const topic = String(request.query?.type || request.body?.type || request.query?.topic || "").trim();
    const resourceId = String(request.query?.["data.id"] || request.query?.data_id || request.body?.data?.id || "").trim();
    const requestId = String(request.get("x-request-id") || "").trim();
    const db = getFirestore();
    const environment = isProduction ? "production" : "test";
    const accessToken = isProduction ? MERCADO_PAGO_ACCESS_TOKEN_PROD.value() : MERCADO_PAGO_ACCESS_TOKEN_TEST.value();
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
            subscription = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(resourceId)}`, accessToken);
        } else if (topic === "subscription_authorized_payment") {
            try {
                payment = await mercadoPagoRequest(`/authorized_payments/${encodeURIComponent(resourceId)}`, accessToken);
                const subscriptionId = payment.preapproval_id || payment.subscription_id;
                if (!subscriptionId) throw new Error("Pagamento sem assinatura vinculada.");
                subscription = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(subscriptionId)}`, accessToken);
            } catch (paymentError) {
                // O simulador do Mercado Pago pode enviar o ID da assinatura usando
                // o tópico de pagamento autorizado. Aceitamos apenas para consultar
                // a assinatura; sem uma fatura aprovada, o plano não é liberado.
                if (paymentError.status !== 400 && paymentError.status !== 404) throw paymentError;
                subscription = await mercadoPagoRequest(`/preapproval/${encodeURIComponent(resourceId)}`, accessToken);
                payment = null;
            }
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
                ambiente: environment,
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

exports.setupAbacatePayDevWebhook = onCall({
    region: REGION,
    invoker: "public",
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [ABACATEPAY_API_KEY_DEV, ABACATEPAY_WEBHOOK_SECRET_DEV]
}, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Autenticação obrigatória.");
    const db = getFirestore();
    const adminSnapshot = await db.collection("users").doc(request.auth.uid).get();
    const admin = adminSnapshot.data() || {};
    if (!adminSnapshot.exists || admin.admin !== true || admin.autorizado !== true || admin.status !== "ativo") {
        throw new HttpsError("permission-denied", "Somente o administrador pode configurar o webhook.");
    }
    try {
        const webhook = await abacatePayRequest("/webhooks/create", ABACATEPAY_API_KEY_DEV.value(), {
            method: "POST",
            body: JSON.stringify({
                name: "Senso Dev - Assinaturas",
                endpoint: "https://southamerica-east1-senso-6d92a.cloudfunctions.net/abacatePayWebhook",
                secret: ABACATEPAY_WEBHOOK_SECRET_DEV.value().trim(),
                events: ["subscription.completed", "subscription.renewed", "subscription.cancelled"]
            })
        });
        await db.collection("appConfig").doc("abacatePayDev").set({
            webhookId: webhook.id,
            configuredAt: FieldValue.serverTimestamp(),
            configuredBy: request.auth.uid
        }, { merge: true });
        return { success: true, webhookId: webhook.id };
    } catch (error) {
        logger.error("Falha ao configurar webhook AbacatePay Dev.", { status: error.status, detail: error.payload?.error || error.message });
        throw new HttpsError("internal", "Não foi possível configurar o webhook AbacatePay.");
    }
});

exports.createAbacatePayDevSubscription = onCall({
    region: REGION,
    invoker: "public",
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [ABACATEPAY_API_KEY_DEV]
}, async request => {
    const simulatorUid = IS_FUNCTIONS_EMULATOR ? String(request.data?.simulatorUid || "").trim() : "";
    if (!request.auth && !simulatorUid) throw new HttpsError("unauthenticated", "Entre na sua conta para contratar.");
    if (!IS_FUNCTIONS_EMULATOR && request.auth.token.email_verified !== true) {
        throw new HttpsError("failed-precondition", "Confirme seu e-mail antes de contratar.");
    }
    const planKey = String(request.data?.plan || "").trim().toLowerCase();
    const method = String(request.data?.method || "").trim().toUpperCase();
    const plan = ABACATEPAY_DEV_PLANS[planKey];
    if (!plan || !["PIX", "CARD"].includes(method)) throw new HttpsError("invalid-argument", "Plano ou forma de pagamento inválida.");

    const uid = request.auth?.uid || simulatorUid;
    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const snapshot = await userRef.get();
    const user = snapshot.data() || {};
    if (!snapshot.exists || (user.admin !== true && user.abacatePayDevTesteAutorizado !== true)) {
        throw new HttpsError("permission-denied", "Teste AbacatePay restrito a contas autorizadas.");
    }

    const reference = `senso:${uid}:${planKey}:${Date.now().toString(36)}`;
    try {
        const checkout = await abacatePayRequest("/subscriptions/create", ABACATEPAY_API_KEY_DEV.value(), {
            method: "POST",
            body: JSON.stringify({
                items: [{ id: plan.productId, quantity: 1 }],
                methods: [method],
                externalId: reference,
                returnUrl: "https://www.senso.app.br/pages/pagamento-app.html?abacatepay=retorno",
                completionUrl: "https://www.senso.app.br/pages/pagamento-app.html?abacatepay=retorno",
                metadata: { uid, plan: planKey, environment: "dev" }
            })
        });
        if (!checkout?.id || !checkout?.url || checkout.devMode !== true) throw new Error("Checkout Dev inválido.");
        await userRef.set({
            abacatePay: {
                ambiente: "dev",
                checkoutId: checkout.id,
                planoSolicitado: planKey,
                metodo: method,
                status: checkout.status || "PENDING",
                externalId: reference,
                checkoutCriadoEm: FieldValue.serverTimestamp(),
                atualizadoEm: FieldValue.serverTimestamp()
            }
        }, { merge: true });
        return { checkoutUrl: checkout.url, checkoutId: checkout.id, plan: planKey, method, environment: "dev" };
    } catch (error) {
        logger.error("Falha ao criar assinatura AbacatePay Dev.", { uid, planKey, method, status: error.status, detail: error.payload?.error || error.message });
        throw new HttpsError("internal", "Não foi possível iniciar o checkout AbacatePay.");
    }
});

exports.abacatePayWebhook = onRequest({
    region: REGION,
    invoker: "public",
    secrets: [ABACATEPAY_WEBHOOK_SECRET_DEV]
}, async (request, response) => {
    if (request.method !== "POST") return response.status(405).send("Method Not Allowed");
    const expectedSecret = ABACATEPAY_WEBHOOK_SECRET_DEV.value().trim();
    const receivedSecret = String(request.query?.webhookSecret || "").trim();
    if (!receivedSecret || receivedSecret.length !== expectedSecret.length || !crypto.timingSafeEqual(Buffer.from(receivedSecret), Buffer.from(expectedSecret)) || !validAbacateSignature(request)) {
        logger.warn("Webhook AbacatePay com autenticação inválida.");
        return response.status(401).send("Invalid signature");
    }

    const payload = request.body || {};
    const eventId = safeEventId(payload.id);
    const eventName = String(payload.event || "");
    const data = payload.data || {};
    const subscription = data.subscription || {};
    const payment = data.payment || {};
    const checkout = data.checkout || {};
    const db = getFirestore();
    const eventRef = db.collection("abacatePayWebhookEvents").doc(eventId);

    try {
        const previous = await eventRef.get();
        if (previous.data()?.processedAt) return response.status(200).send("Already processed");
        await eventRef.set({ event: eventName, devMode: payload.devMode === true, receivedAt: FieldValue.serverTimestamp(), status: "processing" }, { merge: true });
        if (payload.devMode !== true) throw new Error("Evento de produção recebido no endpoint Dev.");

        const supported = ["subscription.completed", "subscription.renewed", "subscription.cancelled"];
        if (!supported.includes(eventName)) {
            await eventRef.set({ status: "ignored", processedAt: FieldValue.serverTimestamp() }, { merge: true });
            return response.status(200).send("Ignored");
        }

        let reference = parseAbacateReference(checkout.externalId || payment.externalId);
        let userRef;
        let userSnapshot;
        if (reference) {
            userRef = db.collection("users").doc(reference.uid);
            userSnapshot = await userRef.get();
        } else if (subscription.id) {
            const match = await db.collection("users").where("abacatePay.assinaturaId", "==", subscription.id).limit(1).get();
            if (!match.empty) {
                userSnapshot = match.docs[0];
                userRef = userSnapshot.ref;
                const storedPlan = String(userSnapshot.data()?.abacatePay?.planoSolicitado || "");
                reference = ABACATEPAY_DEV_PLANS[storedPlan] ? { uid: userSnapshot.id, plan: storedPlan } : null;
            }
        }
        if (!reference || !userSnapshot?.exists) throw new Error("Usuário ou referência da assinatura não encontrado.");
        const plan = ABACATEPAY_DEV_PLANS[reference.plan];
        const itemId = checkout.items?.[0]?.id;
        if (!plan || Number(subscription.amount) !== plan.amountCents || subscription.currency !== "BRL" || subscription.frequency !== "MONTHLY" || (itemId && itemId !== plan.productId)) {
            throw new Error("Plano, produto, valor ou moeda divergente.");
        }

        const user = userSnapshot.data() || {};
        const manualOverride = user.controleAssinatura === "manual";
        const approvedPaymentStatus = ["PAID", "APPROVED"].includes(String(payment.status || "").toUpperCase());
        const paid = ["subscription.completed", "subscription.renewed"].includes(eventName)
            && subscription.status === "ACTIVE" && approvedPaymentStatus
            && Number(payment.paidAmount) === plan.amountCents;
        const update = {
            abacatePay: {
                ambiente: "dev",
                assinaturaId: subscription.id || null,
                checkoutId: checkout.id || user.abacatePay?.checkoutId || null,
                planoSolicitado: reference.plan,
                metodo: subscription.method || data.payerInformation?.method || null,
                status: subscription.status || "unknown",
                ultimaCobrancaId: payment.id || null,
                ultimaCobrancaStatus: payment.status || null,
                atualizadoEm: FieldValue.serverTimestamp()
            }
        };
        if (paid && !manualOverride) Object.assign(update, {
            plano: reference.plan,
            precoContratado: plan.amountCents / 100,
            tipoPagamento: "mensal",
            tipoPlano: "normal",
            autorizado: true,
            status: "ativo",
            validade: Timestamp.fromMillis(Date.now() + (31 * 24 * 60 * 60 * 1000)),
            origemPlano: "abacatepay",
            controleAssinatura: "automatico",
            ultimaConfirmacaoPagamento: FieldValue.serverTimestamp()
        });
        await userRef.set(update, { merge: true });
        await eventRef.set({ status: "processed", uid: reference.uid, plan: reference.plan, subscriptionId: subscription.id || null, paymentApproved: paid, manualOverride, processedAt: FieldValue.serverTimestamp() }, { merge: true });
        return response.status(200).send("OK");
    } catch (error) {
        logger.error("Falha no webhook AbacatePay.", { eventId, eventName, message: error.message });
        await eventRef.set({ status: "error", error: String(error.message || "unknown").slice(0, 300), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return response.status(500).send("Processing failed");
    }
});
