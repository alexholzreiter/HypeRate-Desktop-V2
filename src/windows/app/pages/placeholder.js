// Pages that are not in the new window yet point to the previous one, where everything still works.

import { h } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

export function placeholder(id, titleKey) {
  return {
    id,
    render: () => h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, t(titleKey))),
      h('div', { class: 'card todo' },
        h('p', { class: 'label' }, t('todo_label')),
        h('p', { class: 'muted', style: { margin: 0, maxWidth: '560px' } }, t('todo_text')),
        h('button', { class: 'btn', onclick: () => window.electronAPI.switchUi(false) }, t('todo_cta')))),
  };
}
