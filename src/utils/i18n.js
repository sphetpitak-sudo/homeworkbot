import en from "../i18n/en.js";
import th from "../i18n/th.js";

const LOCALES = { en, th };

const BOT_LANG = (process.env.BOT_LANG || "en").toLowerCase();

function pickLocale() {
    return LOCALES[BOT_LANG] || LOCALES.en;
}

function getByPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

function interpolate(str, params) {
    if (!params) return str;
    if (typeof str !== "string") return str;
    return str.replace(/\{(\w+)\}/g, (_, key) =>
        params[key] !== undefined ? String(params[key]) : `{${key}}`,
    );
}

export function t(key, params) {
    const dict = pickLocale();
    const val = getByPath(dict, key);
    if (val === undefined) {
        return interpolate(getByPath(en, key) ?? key, params);
    }
    return interpolate(val, params);
}

export function getLang() {
    return BOT_LANG;
}

export function setLang(lang) {
    if (LOCALES[lang]) {
        process.env.BOT_LANG = lang;
    }
}
