// The languages HypeRate Desktop speaks: one list for the main process and the windows.
// A language needs a src/i18n/<code>.json (run npm run i18n afterwards) and a line here.
//   code    the JSON file name and what settings.json stores
//   name    how the language calls itself, for the picker
//   locale  for dates and times
(function (root) {
  var LANGUAGES = [
    { code: 'en', name: 'English', locale: 'en-GB' },
    { code: 'de', name: 'Deutsch', locale: 'de-DE' },
    { code: 'zh-CN', name: '简体中文', locale: 'zh-CN' },
  ];

  function find(code) {
    for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i].code === code) return LANGUAGES[i];
    return null;
  }

  // From a system or browser language ("de-AT", "zh-Hans-CN", "zh_CN") to one we have
  function fromSystem(tag) {
    var t = String(tag || '').replace('_', '-').toLowerCase();
    if (/^zh(-hans|-cn|-sg|$)/.test(t) || t === 'zh') return 'zh-CN';
    if (t.indexOf('zh') === 0) return 'zh-CN';   // Traditional is closer to Simplified than to English
    var base = t.split('-')[0];
    for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i].code.toLowerCase() === base) return LANGUAGES[i].code;
    return 'en';
  }

  // What to use: the saved choice if we have it, otherwise the system language
  function resolve(saved, systemTag) {
    return find(saved) ? saved : fromSystem(systemTag);
  }

  function localeFor(code) { var l = find(code); return l ? l.locale : 'en-GB'; }

  var API = { LANGUAGES: LANGUAGES, find: find, fromSystem: fromSystem, resolve: resolve, localeFor: localeFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.HR_LANGUAGES = API;
})(this);
