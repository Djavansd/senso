(function () {
    "use strict";

    const message = document.getElementById("securityMessage");
    const emailStep = document.getElementById("verifyEmailStep");
    const phoneStep = document.getElementById("enrollPhoneStep");
    const codeStep = document.getElementById("confirmCodeStep");
    const activeStep = document.getElementById("mfaActiveStep");
    const phoneInput = document.getElementById("adminPhone");
    const codeInput = document.getElementById("enrollCode");
    const continueLink = document.getElementById("securityContinue");
    const reauthenticateButton = document.getElementById("reauthenticate");
    let verificationId = null;
    let recaptchaVerifier = null;

    function firebaseErrorMessage(error) {
        const messages = {
            "auth/unauthorized-domain": "Este domínio ainda não está autorizado no Firebase Authentication.",
            "auth/captcha-check-failed": "O reCAPTCHA não foi validado. Atualize a página e tente novamente.",
            "auth/invalid-phone-number": "O telefone informado não é válido.",
            "auth/quota-exceeded": "A cota de SMS do Firebase foi atingida.",
            "auth/too-many-requests": "Muitas tentativas foram feitas. Aguarde alguns minutos.",
            "auth/missing-phone-number": "Informe o telefone com DDD.",
            "auth/operation-not-allowed": "O MFA por SMS ainda não está liberado para este projeto.",
            "auth/requires-recent-login": "Saia da conta, entre novamente e repita o cadastro do telefone.",
            "auth/unverified-email": "Confirme seu e-mail antes de cadastrar o segundo fator."
        };
        const code = error?.code || "erro-desconhecido";
        const technicalMessage = String(error?.message || error || "").replace(/[<>]/g, "").slice(0, 220);
        return `${messages[error?.code] || "Não foi possível enviar o código."} (${code})${technicalMessage ? ` — ${technicalMessage}` : ""}`;
    }

    function show(step, text) {
        [emailStep, phoneStep, codeStep, activeStep].forEach(element => { element.hidden = element !== step; });
        message.textContent = text || "";
    }

    function normalizePhone(value) {
        const raw = String(value || "").trim();
        const digits = raw.replace(/\D/g, "");
        if (raw.startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
        if (digits.length === 11) return `+55${digits}`;
        return "";
    }

    async function sendEmailVerification() {
        const button = document.getElementById("sendVerification");
        button.disabled = true;
        try {
            await firebase.auth().currentUser.sendEmailVerification({ url: `${location.origin}/pages/seguranca-conta.html` });
            message.textContent = "E-mail enviado. Abra a mensagem, confirme e volte para esta página.";
        } catch (error) {
            console.error(error);
            message.textContent = "Não foi possível enviar agora. Aguarde um momento e tente novamente.";
        } finally { button.disabled = false; }
    }

    async function reloadAccount() {
        const user = firebase.auth().currentUser;
        await user.reload();
        if (firebase.auth().currentUser.emailVerified) {
            show(phoneStep, "Informe o telefone exclusivo da conta administrativa.");
        } else {
            message.textContent = "O e-mail ainda não aparece como verificado. Confirme pelo link recebido.";
        }
    }

    async function sendCode() {
        const phoneNumber = normalizePhone(phoneInput.value);
        if (!phoneNumber) {
            message.textContent = "Informe um telefone válido com DDD.";
            return;
        }

        const button = document.getElementById("sendMfaCode");
        button.disabled = true;
        message.textContent = "Preparando a verificação de segurança…";
        try {
            if (!firebase.auth().currentUser?.multiFactor?.getSession) {
                throw new Error("API MFA não disponível nesta sessão do Firebase Auth.");
            }
            if (!firebase.auth.RecaptchaVerifier || !firebase.auth.PhoneAuthProvider) {
                throw new Error("Componentes de telefone/reCAPTCHA não carregados pelo Firebase Auth.");
            }
            if (recaptchaVerifier) recaptchaVerifier.clear();
            recaptchaVerifier = new firebase.auth.RecaptchaVerifier("enroll-recaptcha", { size: "invisible" });
            const session = await firebase.auth().currentUser.multiFactor.getSession();
            verificationId = await new firebase.auth.PhoneAuthProvider().verifyPhoneNumber({ phoneNumber, session }, recaptchaVerifier);
            show(codeStep, "Código enviado. Digite os 6 números para concluir.");
            codeInput.focus();
        } catch (error) {
            console.error("Falha ao enviar MFA.", error);
            message.textContent = firebaseErrorMessage(error);
            reauthenticateButton.hidden = error?.code !== "auth/requires-recent-login";
            if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
        } finally { button.disabled = false; }
    }

    async function confirmEnrollment() {
        const code = codeInput.value.replace(/\D/g, "");
        if (!verificationId || code.length !== 6) {
            message.textContent = "Informe o código de 6 dígitos.";
            return;
        }

        const button = document.getElementById("confirmEnrollment");
        button.disabled = true;
        try {
            const credential = firebase.auth.PhoneAuthProvider.credential(verificationId, code);
            const assertion = firebase.auth.PhoneMultiFactorGenerator.assertion(credential);
            await firebase.auth().currentUser.multiFactor.enroll(assertion, "Administrador Senso");
            await firebase.auth().currentUser.reload();
            continueLink.textContent = "Entrar novamente com o código SMS";
            continueLink.href = "login.html?next=%2Fpages%2Fgestao-interna-4m8x2.html";
            continueLink.addEventListener("click", event => {
                event.preventDefault();
                firebase.auth().signOut().finally(() => location.replace(continueLink.href));
            }, { once: true });
            show(activeStep, "Proteção ativada. Por segurança, faça um novo login para validar o segundo fator.");
        } catch (error) {
            console.error("Falha ao ativar MFA.", error);
            message.textContent = "Código inválido ou expirado. Solicite um novo código.";
        } finally { button.disabled = false; }
    }

    function start(event) {
        const detail = event?.detail || {};
        if (!detail.uid || detail.isAdmin !== true) {
            location.replace("../index.html");
            return;
        }

        const user = firebase.auth().currentUser;
        if ((user.multiFactor?.enrolledFactors || []).length > 0) {
            if (detail.mfaAuthenticated === true) {
                show(activeStep, "Sua conta administrativa está protegida e esta sessão confirmou o segundo fator.");
            } else {
                continueLink.textContent = "Entrar novamente com o código SMS";
                continueLink.href = "login.html?next=%2Fpages%2Fgestao-interna-4m8x2.html";
                continueLink.addEventListener("click", event => {
                    event.preventDefault();
                    firebase.auth().signOut().finally(() => location.replace(continueLink.href));
                }, { once: true });
                show(activeStep, "O telefone está cadastrado, mas esta sessão ainda não confirmou o segundo fator.");
            }
        } else if (!user.emailVerified) {
            show(emailStep, "Primeiro, confirme que o e-mail desta conta pertence a você.");
        } else {
            show(phoneStep, "Informe o telefone exclusivo da conta administrativa.");
        }
    }

    document.getElementById("sendVerification").addEventListener("click", sendEmailVerification);
    document.getElementById("reloadAccount").addEventListener("click", reloadAccount);
    document.getElementById("sendMfaCode").addEventListener("click", sendCode);
    reauthenticateButton.addEventListener("click", () => {
        firebase.auth().signOut().finally(() => {
            location.replace("login.html?next=%2Fpages%2Fseguranca-conta.html");
        });
    });
    document.getElementById("confirmEnrollment").addEventListener("click", confirmEnrollment);
    codeInput.addEventListener("keydown", event => { if (event.key === "Enter") confirmEnrollment(); });
    window.addEventListener("senso-auth-ready", start, { once: true });
    if (window.SensoAuth?.profile) {
        firebase.auth().currentUser.getIdTokenResult().then(result => start({ detail: {
            uid: window.SensoAuth.uid,
            isAdmin: window.SensoAuth.isAdmin,
            mfaAuthenticated: !!result.claims?.firebase?.sign_in_second_factor
        } }));
    }
})();
