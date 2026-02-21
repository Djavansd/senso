(function (global) {
    "use strict";

    var PROFILE_STORAGE_KEY = "senso:activeProfile";

    var PROFILES = {
        mecanica: {
            id: "mecanica",
            appName: "Senso Mecanica",
            domainId: "mecanica",
            defaults: {
                primaryColor: "#0f766e",
                companyName: "OFICINA MODELO",
                companyDocument: "00.000.000/0001-00",
                companyAddress: "Sao Paulo",
                companyPhone: "(11) 90000-0000"
            }
        },
        base: {
            id: "base",
            appName: "Senso",
            domainId: "base",
            defaults: {
                primaryColor: "#0a7cff",
                companyName: "EMPRESA MODELO",
                companyDocument: "00.000.000/0001-00",
                companyAddress: "Sao Paulo",
                companyPhone: "(11) 90000-0000"
            }
        }
    };

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

    global.SensoProfile = {
        profiles: PROFILES,
        getActiveProfile: getActiveProfile,
        setActiveProfile: setActiveProfile,
        storageKey: PROFILE_STORAGE_KEY
    };
})(window);
