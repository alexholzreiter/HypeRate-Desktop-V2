// Texts for the new window live in src/i18n/*.json, section "app". Labels the previous settings
// window already has (section "settings") are reused rather than translated twice.
// A key missing in a language falls back to English, then to the key itself.

import { get } from './state.js';

const STRINGS = window.HR_STRINGS || {};

export function t(key, vars) {
  const lang = get().lang;
  let text = STRINGS[lang]?.app?.[key] ?? STRINGS[lang]?.settings?.[key]
    ?? STRINGS.en?.app?.[key] ?? STRINGS.en?.settings?.[key] ?? key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value);
  return text;
}
