(function (global) {
    "use strict";

    var PROFILE_STORAGE_KEY = "senso:activeProfile";
    var BUSINESS_STORAGE_KEY = "senso:businessType";

    var BUSINESS_TYPES = {
        mecanica: { id: "mecanica", label: "Mecânica", profileId: "mecanica", group: "Automotivo", problemLabel: "Problema relatado pelo cliente", problemPlaceholder: "Ex: carro falhando, barulho ao frear, vazamento ou luz acesa no painel..." },
        lava_rapido: { id: "lava_rapido", label: "Lava-rápido", profileId: "mecanica", group: "Automotivo", problemLabel: "Serviço solicitado pelo cliente", problemPlaceholder: "Ex: lavagem completa, higienização interna, motor, bancos ou remoção de manchas..." },
        estetica_automotiva: { id: "estetica_automotiva", label: "Estética automotiva", profileId: "mecanica", group: "Automotivo", problemLabel: "Serviço solicitado para o veículo", problemPlaceholder: "Ex: polimento, vitrificação, higienização, riscos ou manchas informadas..." },
        funilaria: { id: "funilaria", label: "Funilaria", profileId: "mecanica", group: "Automotivo", problemLabel: "Danos relatados no veículo", problemPlaceholder: "Ex: amassado na porta, para-choque danificado, riscos ou peça desalinhada..." },
        pintura_automotiva: { id: "pintura_automotiva", label: "Pintura automotiva", profileId: "mecanica", group: "Automotivo", problemLabel: "Danos ou pintura solicitada", problemPlaceholder: "Ex: riscos, pintura queimada, retoque, peça ou área que será pintada..." },
        eletrica_automotiva: { id: "eletrica_automotiva", label: "Elétrica automotiva", profileId: "mecanica", group: "Automotivo", problemLabel: "Falha elétrica relatada", problemPlaceholder: "Ex: veículo não liga, bateria descarregando, farol ou painel com falha..." },
        borracharia: { id: "borracharia", label: "Borracharia", profileId: "mecanica", group: "Automotivo", problemLabel: "Problema relatado nos pneus", problemPlaceholder: "Ex: pneu furado, vazamento, troca, rodízio ou calibragem..." },
        auto_center: { id: "auto_center", label: "Auto center", profileId: "mecanica", group: "Automotivo", problemLabel: "Problema relatado pelo cliente", problemPlaceholder: "Ex: alinhamento, balanceamento, suspensão, freios ou troca de pneus..." },
        ar_automotivo: { id: "ar_automotivo", label: "Ar-condicionado automotivo", profileId: "mecanica", group: "Automotivo", problemLabel: "Problema relatado no ar-condicionado", problemPlaceholder: "Ex: não gela, mau cheiro, ruído, vazamento ou pouca ventilação..." },
        som_acessorios: { id: "som_acessorios", label: "Som e acessórios automotivos", profileId: "mecanica", group: "Automotivo", problemLabel: "Instalação ou problema relatado", problemPlaceholder: "Ex: instalação de som, alarme, câmera, trava ou acessório solicitado..." },
        prestador: { id: "prestador", label: "Prestador de serviço", profileId: "prestador", group: "Serviços gerais", problemLabel: "Problema relatado pelo cliente", problemPlaceholder: "Ex: problema, local do serviço, urgência, medidas, acesso ou detalhes do atendimento..." },
        pedreiro: { id: "pedreiro", label: "Pedreiro", profileId: "prestador", group: "Serviços gerais", problemLabel: "Serviço de obra solicitado", problemPlaceholder: "Ex: reparo, construção, medidas, materiais, local e condições do serviço..." },
        pintor: { id: "pintor", label: "Pintor residencial/comercial", profileId: "prestador", group: "Serviços gerais", problemLabel: "Serviço de pintura solicitado", problemPlaceholder: "Ex: ambientes, metragem, estado das paredes, cores e acabamento desejado..." },
        encanador: { id: "encanador", label: "Encanador", profileId: "prestador", group: "Serviços gerais", problemLabel: "Problema hidráulico relatado", problemPlaceholder: "Ex: vazamento, entupimento, baixa pressão, instalação ou local afetado..." },
        eletricista: { id: "eletricista", label: "Eletricista", profileId: "prestador", group: "Serviços gerais", problemLabel: "Problema elétrico relatado", problemPlaceholder: "Ex: falta de energia, disjuntor, tomada, instalação ou equipamento afetado..." },
        faxineiro: { id: "faxineiro", label: "Limpeza e faxina", profileId: "prestador", group: "Serviços gerais", problemLabel: "Detalhes da limpeza solicitada", problemPlaceholder: "Ex: tipo de imóvel, quantidade de cômodos, limpeza pesada e áreas prioritárias..." },
        jardineiro: { id: "jardineiro", label: "Jardineiro", profileId: "prestador", group: "Serviços gerais", problemLabel: "Serviço de jardinagem solicitado", problemPlaceholder: "Ex: poda, corte de grama, limpeza, plantio, tamanho e acesso ao local..." },
        tecnico_ar: { id: "tecnico_ar", label: "Técnico de ar-condicionado", profileId: "prestador", group: "Serviços gerais", problemLabel: "Problema relatado no equipamento", problemPlaceholder: "Ex: não gela, vazamento, ruído, limpeza ou instalação; informe modelo e local..." },
        montador_moveis: { id: "montador_moveis", label: "Montador de móveis", profileId: "prestador", group: "Serviços gerais", problemLabel: "Montagem solicitada", problemPlaceholder: "Ex: móvel, quantidade, desmontagem, manual disponível e endereço do serviço..." },
        chaveiro: { id: "chaveiro", label: "Chaveiro", profileId: "prestador", group: "Serviços gerais", problemLabel: "Serviço de chaveiro solicitado", problemPlaceholder: "Ex: abertura, troca de fechadura, cópia de chave e local do atendimento..." },
        vidraceiro: { id: "vidraceiro", label: "Vidraceiro", profileId: "prestador", group: "Serviços gerais", problemLabel: "Serviço de vidro solicitado", problemPlaceholder: "Ex: instalação ou troca, medidas, tipo de vidro e local do serviço..." },
        marceneiro: { id: "marceneiro", label: "Marceneiro", profileId: "prestador", group: "Serviços gerais", problemLabel: "Serviço de marcenaria solicitado", problemPlaceholder: "Ex: móvel, reparo, medidas, material e acabamento desejado..." },
        gesseiro: { id: "gesseiro", label: "Gesseiro / Drywall", profileId: "prestador", group: "Serviços gerais", problemLabel: "Serviço de gesso solicitado", problemPlaceholder: "Ex: forro, parede, reparo, medidas e acabamento desejado..." },
        piscineiro: { id: "piscineiro", label: "Piscineiro", profileId: "prestador", group: "Serviços gerais", problemLabel: "Serviço solicitado para a piscina", problemPlaceholder: "Ex: limpeza, água verde, manutenção, tamanho da piscina e produtos necessários..." }
    };

    var PROFILES = {
        mecanica: {
            id: "mecanica",
            modelId: "mecanica",
            appName: "Senso Mecanica",
            domainId: "mecanica",
            defaults: {
                primaryColor: "#0f766e",
                companyName: "Senso",
                companyDocument: "",
                companyAddress: "",
                companyPhone: ""
            }
        },
        prestador: {
            id: "prestador",
            modelId: "prestador",
            appName: "Senso Prestador",
            domainId: "base",
            defaults: {
                primaryColor: "#0a7cff",
                companyName: "Senso",
                companyDocument: "",
                companyAddress: "",
                companyPhone: ""
            }
        },
        base: {
            id: "base",
            modelId: "prestador",
            appName: "Senso",
            domainId: "base",
            defaults: {
                primaryColor: "#0a7cff",
                companyName: "Senso",
                companyDocument: "",
                companyAddress: "",
                companyPhone: ""
            }
        }
    };

    Object.keys(BUSINESS_TYPES).forEach(function (businessId) {
        if (PROFILES[businessId]) return;
        var business = BUSINESS_TYPES[businessId];
        var model = business.profileId === "mecanica" ? PROFILES.mecanica : PROFILES.prestador;
        PROFILES[businessId] = {
            id: businessId,
            modelId: business.profileId,
            appName: "Senso " + business.label,
            domainId: model.domainId,
            defaults: Object.assign({}, model.defaults, {
                companyName: "",
                companyDocument: "",
                companyAddress: "",
                companyPhone: ""
            })
        };
    });

    function safeReadProfileId() {
        try {
            return localStorage.getItem(PROFILE_STORAGE_KEY);
        } catch (_err) {
            return null;
        }
    }

    function getActiveProfile() {
        var selectedId = safeReadProfileId();
        if (selectedId && PROFILES[selectedId]) return PROFILES[selectedId];
        return PROFILES.mecanica;
    }

    function setActiveProfile(id) {
        if (!PROFILES[id]) return false;
        try {
            localStorage.setItem(PROFILE_STORAGE_KEY, id);
        } catch (_err) {
            return false;
        }
        return true;
    }

    function getBusinessType() {
        var selectedId = null;
        try { selectedId = localStorage.getItem(BUSINESS_STORAGE_KEY); } catch (_err) {}
        var activeProfile = getActiveProfile();
        var selected = selectedId && BUSINESS_TYPES[selectedId] ? BUSINESS_TYPES[selectedId] : null;
        if (selected && (selected.id === activeProfile.id || selected.profileId === activeProfile.id)) return selected;
        if (BUSINESS_TYPES[activeProfile.id]) return BUSINESS_TYPES[activeProfile.id];
        if (selected && selected.profileId === activeProfile.modelId) return selected;
        return activeProfile.modelId === "prestador" ? BUSINESS_TYPES.prestador : BUSINESS_TYPES.mecanica;
    }

    function setBusinessType(id) {
        var business = BUSINESS_TYPES[id];
        if (!business) return false;
        try { localStorage.setItem(BUSINESS_STORAGE_KEY, id); } catch (_err) { return false; }
        return true;
    }

    global.SensoProfile = {
        profiles: PROFILES,
        getActiveProfile: getActiveProfile,
        setActiveProfile: setActiveProfile,
        businessTypes: BUSINESS_TYPES,
        getBusinessType: getBusinessType,
        setBusinessType: setBusinessType,
        usesVehicleFields: function () { return getActiveProfile().modelId === "mecanica"; },
        storageKey: PROFILE_STORAGE_KEY,
        businessStorageKey: BUSINESS_STORAGE_KEY
    };
})(window);
