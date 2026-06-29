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
                companyName: "Senso",
                companyDocument: "",
                companyAddress: "",
                companyPhone: ""
            }
        },
        prestador: {
            id: "prestador",
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
