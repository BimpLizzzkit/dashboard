(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else if (v !== false && v != null) e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
};
const uid = () => 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const KEY = 'dashboard-state',
    VERSION = 1;
const TYPES = {
    note: 'Текстовая заметка',
    counter: 'Счётчик',
    todo: 'Список задач',
    chart: 'График',
};
const DEFAULTS = {
    note: { text: '' },
    counter: { value: 0, step: 1 },
    todo: { items: [] },
    chart: { values: [] },
};
const validWidget = (w) =>
    w &&
    typeof w.id === 'string' &&
    typeof w.title === 'string' &&
    Object.hasOwn(TYPES, w.type) &&
    w.data &&
    typeof w.data === 'object';
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const sanitize = {
    note: (d) => ({ text: typeof d.text === 'string' ? d.text : '' }),
    counter: (d) => ({ value: num(d.value, 0), step: num(d.step, 1) > 0 ? num(d.step, 1) : 1 }),
    todo: (d) => ({
        items: Array.isArray(d.items)
            ? d.items
                  .filter((i) => i && typeof i.text === 'string')
                  .map((i) => ({ text: i.text, done: i.done === true }))
            : [],
    }),
    chart: (d) => ({
        values: Array.isArray(d.values)
            ? d.values.filter((v) => Number.isFinite(v) && v >= 0).slice(0, 20)
            : [],
    }),
};

function restoreWidgets(list) {
    const seen = new Set();
    return list.filter(validWidget).flatMap((w) => {
        if (seen.has(w.id)) return [];
        seen.add(w.id);
        return [
            {
                id: w.id,
                type: w.type,
                title: w.title.trim() || TYPES[w.type],
                collapsed: w.collapsed === true,
                data: sanitize[w.type](w.data),
            },
        ];
    });
}

const Store = {
    state: { version: VERSION, theme: 'light', widgets: [] },
    load() {
        try {
            const s = JSON.parse(localStorage.getItem(KEY));
            if (!s || s.version !== VERSION || !Array.isArray(s.widgets)) throw new Error('schema');
            this.state = {
                version: VERSION,
                theme: s.theme === 'dark' ? 'dark' : 'light',
                widgets: restoreWidgets(s.widgets),
            };
        } catch {
            this.state.widgets = [];
            this.state.theme = matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light';
        }
    },
    save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(this.state));
        } catch {}
    },
};
const save = () => Store.save();
const find = (id) => Store.state.widgets.find((w) => w.id === id);

const chartState = new Map();
const bus = { render() {} };

const Toast = {
    show(msg, kind = '') {
        const t = el('div', { class: 'toast ' + kind }, msg);
        $('#toasts').append(t);
        setTimeout(() => t.remove(), 3000);
    },
};

const FOCUSABLE = 'button,input,select,textarea,[href],[tabindex]:not([tabindex="-1"])';
const Modal = {
    open({ title, body, actions, onClose }) {
        const prev = document.activeElement,
            id = uid();
        const closeBtn = el(
            'button',
            { class: 'ib close', 'aria-label': 'Закрыть', onclick: () => close() },
            '✕',
        );
        const dlg = el(
            'div',
            {
                class: 'modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': id,
                tabindex: '-1',
            },
            closeBtn,
            el('h2', { id }, title),
            body,
            el('div', { class: 'row end' }, ...actions((v) => close(v))),
        );
        const ov = el(
            'div',
            {
                class: 'overlay',
                onmousedown: (e) => {
                    if (e.target === ov) close();
                },
            },
            dlg,
        );
        function close(v) {
            document.removeEventListener('keydown', key);
            ov.remove();
            document.body.classList.remove('lock');
            prev?.focus?.();
            onClose?.(v);
        }
        function key(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
                return;
            }
            if (e.key !== 'Tab') return;
            const f = [...dlg.querySelectorAll(FOCUSABLE)].filter((x) => !x.disabled);
            const a = f[0],
                z = f.at(-1),
                cur = document.activeElement;
            if (e.shiftKey && (cur === a || cur === dlg)) {
                e.preventDefault();
                z.focus();
            } else if (!e.shiftKey && cur === z) {
                e.preventDefault();
                a.focus();
            }
        }
        document.addEventListener('keydown', key);
        document.body.append(ov);
        document.body.classList.add('lock');
        (dlg.querySelector('[autofocus]') || dlg).focus();
    },
};
const confirmBox = (title, text, okLabel) =>
    new Promise((res) =>
        Modal.open({
            title,
            body: el('p', {}, text),
            actions: (c) => [
                el('button', { class: 'btn', onclick: () => c(false) }, 'Отмена'),
                el(
                    'button',
                    { class: 'btn danger', autofocus: true, onclick: () => c(true) },
                    okLabel,
                ),
            ],
            onClose: (v) => res(!!v),
        }),
    );

const fetchChartData = () =>
    new Promise((res, rej) =>
        setTimeout(
            () =>
                Math.random() < 0.3
                    ? rej(new Error('network'))
                    : res(Array.from({ length: 6 }, () => 10 + Math.floor(Math.random() * 90))),
            500 + Math.random() * 500,
        ),
    );
async function loadChart(id) {
    chartState.set(id, 'loading');
    bus.render();
    try {
        const v = await fetchChartData();
        const w = find(id);
        if (!w) return;
        w.data.values = v;
        chartState.delete(id);
        save();
    } catch {
        if (!find(id)) return;
        chartState.set(id, 'error');
    }
    bus.render();
}

const R = {
    note(w) {
        const d = w.data,
            box = el('div');
        const view = () =>
            box.replaceChildren(
                el(
                    'div',
                    {
                        class: 'note',
                        tabindex: '0',
                        title: 'Двойной клик — редактировать',
                        ondblclick: edit,
                        onkeydown: (e) => {
                            if (e.key === 'Enter') edit();
                        },
                    },
                    d.text || el('span', { class: 'mute' }, 'Двойной клик, чтобы написать…'),
                ),
            );
        const edit = () => {
            const ta = el('textarea', { rows: 5, 'aria-label': 'Текст заметки' });
            ta.value = d.text;
            ta.onblur = () => {
                d.text = ta.value;
                save();
                view();
            };
            ta.onkeydown = (e) => {
                if (e.key === 'Escape') {
                    ta.onblur = null;
                    view();
                }
            };
            box.replaceChildren(ta);
            ta.focus();
        };
        view();
        return box;
    },
    counter(w) {
        const d = w.data,
            out = el('output', { class: 'big', 'aria-live': 'polite' }, String(d.value));
        const bump = (s) => {
            d.value = +(d.value + s * d.step).toFixed(6);
            out.textContent = d.value;
            save();
        };
        const step = el('input', {
            type: 'number',
            min: '0',
            step: 'any',
            value: d.step,
            onchange: (e) => {
                const v = parseFloat(e.target.value);
                if (v > 0) {
                    d.step = v;
                    save();
                } else e.target.value = d.step;
            },
        });
        return el(
            'div',
            { class: 'counter' },
            el(
                'button',
                { class: 'btn round', 'aria-label': 'Уменьшить', onclick: () => bump(-1) },
                '−',
            ),
            out,
            el(
                'button',
                { class: 'btn round', 'aria-label': 'Увеличить', onclick: () => bump(1) },
                '+',
            ),
            el('label', { class: 'step' }, 'Шаг', step),
        );
    },
    todo(w) {
        const d = w.data,
            ul = el('ul', { class: 'tasks' });
        const input = el('input', {
            'aria-label': 'Новая задача',
            placeholder: 'Новая задача',
            maxlength: 120,
        });
        const item = (it) =>
            el(
                'li',
                { class: it.done ? 'done' : '' },
                el(
                    'label',
                    {},
                    el('input', {
                        type: 'checkbox',
                        checked: !!it.done,
                        onchange: (e) => {
                            it.done = e.target.checked;
                            save();
                            e.target.closest('li').classList.toggle('done', it.done);
                        },
                    }),
                    el('span', {}, it.text),
                ),
                el(
                    'button',
                    {
                        class: 'x',
                        'aria-label': 'Удалить задачу',
                        onclick: () => {
                            d.items = d.items.filter((i) => i !== it);
                            save();
                            draw();
                            input.focus();
                        },
                    },
                    '✕',
                ),
            );
        const draw = () => ul.replaceChildren(...d.items.map(item));
        const form = el(
            'form',
            {
                class: 'row',
                onsubmit: (e) => {
                    e.preventDefault();
                    const t = input.value.trim();
                    if (!t) return;
                    d.items.push({ text: t, done: false });
                    input.value = '';
                    save();
                    draw();
                },
            },
            input,
            el('button', { class: 'btn' }, 'Добавить'),
        );
        draw();
        return el('div', {}, form, ul);
    },
    chart(w) {
        const d = w.data,
            st = chartState.get(w.id);
        if (st === 'loading')
            return el(
                'div',
                { class: 'skel', role: 'status', 'aria-label': 'Загрузка данных' },
                ...[40, 70, 55, 85, 30, 60].map((h) => el('i', { style: `height:${h}%` })),
            );
        if (st === 'error')
            return el(
                'div',
                { class: 'errbox', role: 'alert' },
                el('p', {}, 'Не удалось загрузить данные.'),
                el('button', { class: 'btn', onclick: () => loadChart(w.id) }, 'Повторить'),
            );
        const max = Math.max(1, ...d.values);
        const bars = el(
            'div',
            {
                class: 'bars',
                role: 'img',
                'aria-label': 'Столбчатый график: ' + d.values.join(', '),
            },
            ...d.values.map((v) =>
                el(
                    'div',
                    { class: 'bar' },
                    el('b', { style: `height:${(v / max) * 100}%`, 'data-v': v }),
                ),
            ),
        );
        const inp = el('input', {
            'aria-label': 'Значения через запятую',
            value: d.values.join(', '),
            placeholder: '5, 12, 8',
        });
        const form = el(
            'form',
            {
                class: 'row',
                onsubmit: (e) => {
                    e.preventDefault();
                    const vals = inp.value
                        .split(/[,;\s]+/)
                        .filter(Boolean)
                        .map(Number);
                    if (
                        !vals.length ||
                        vals.length > 20 ||
                        vals.some((n) => !isFinite(n) || n < 0)
                    ) {
                        Toast.show('Введите от 1 до 20 чисел, не меньше нуля', 'err');
                        return;
                    }
                    d.values = vals;
                    save();
                    bus.render();
                },
            },
            inp,
            el('button', { class: 'btn' }, 'Обновить'),
        );
        return el(
            'div',
            {},
            d.values.length ? bars : el('p', { class: 'mute' }, 'Нет данных'),
            form,
        );
    },
};

let dragId = null;
const clearOver = () =>
    document.querySelectorAll('.over').forEach((n) => n.classList.remove('over'));
function reorder(from, to) {
    const a = Store.state.widgets,
        i = a.findIndex((w) => w.id === from),
        j = a.findIndex((w) => w.id === to);
    if (i < 0 || j < 0 || i === j) return;
    a.splice(j, 0, a.splice(i, 1)[0]);
    save();
    bus.render();
}
function bindDrag(grip, art, w) {
    grip.addEventListener('dragstart', (e) => {
        dragId = w.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', w.id);
        e.dataTransfer.setDragImage(art, 20, 20);
        setTimeout(() => art.classList.add('dragging'));
    });
    grip.addEventListener('dragend', () => {
        dragId = null;
        clearOver();
        art.classList.remove('dragging');
    });
    let target = null;
    const under = (t) => document.elementFromPoint(t.clientX, t.clientY)?.closest('.card');
    grip.addEventListener('touchstart', () => art.classList.add('dragging'), { passive: true });
    grip.addEventListener(
        'touchmove',
        (e) => {
            e.preventDefault();
            clearOver();
            target = under(e.touches[0]);
            if (target && target !== art) target.classList.add('over');
        },
        { passive: false },
    );
    grip.addEventListener('touchend', () => {
        art.classList.remove('dragging');
        clearOver();
        if (target && target !== art) reorder(w.id, target.dataset.id);
        target = null;
    });
}

function initGrid(grid) {
    grid.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        clearOver();
        const t = e.target.closest('.card');
        if (t && t.dataset.id !== dragId) t.classList.add('over');
    });
    grid.addEventListener('drop', (e) => {
        if (!dragId) return;
        e.preventDefault();
        const t = e.target.closest('.card');
        clearOver();
        if (t) reorder(dragId, t.dataset.id);
    });
}

function card(w) {
    const bid = 'b_' + w.id;
    const grip = el(
        'span',
        {
            class: 'grip',
            role: 'button',
            tabindex: '0',
            draggable: 'true',
            'aria-label': 'Перетащить виджет (стрелки меняют порядок)',
            onkeydown: (e) => {
                const k = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
                if (!k) return;
                e.preventDefault();
                const a = Store.state.widgets,
                    i = a.indexOf(w),
                    j = i + k;
                if (j < 0 || j >= a.length) return;
                [a[i], a[j]] = [a[j], a[i]];
                save();
                render();
                $(`[data-id="${w.id}"] .grip`).focus();
            },
        },
        '⠿',
    );
    const art = el(
        'article',
        { class: 'card' + (w.collapsed ? ' collapsed' : ''), 'data-id': w.id },
        el(
            'header',
            {},
            grip,
            el('input', {
                class: 'title',
                'aria-label': 'Заголовок виджета',
                value: w.title,
                maxlength: 60,
                onchange: (e) => {
                    const t = e.target.value.trim();
                    if (!t) {
                        e.target.value = w.title;
                        Toast.show('Заголовок не может быть пустым', 'err');
                        return;
                    }
                    w.title = t;
                    save();
                },
            }),
            el(
                'button',
                {
                    class: 'ib',
                    'aria-expanded': String(!w.collapsed),
                    'aria-controls': bid,
                    'aria-label': w.collapsed ? 'Развернуть' : 'Свернуть',
                    onclick: () => {
                        w.collapsed = !w.collapsed;
                        save();
                        render();
                    },
                },
                w.collapsed ? '▸' : '▾',
            ),
            el(
                'button',
                { class: 'ib', 'aria-label': 'Удалить виджет', onclick: () => removeWidget(w.id) },
                '✕',
            ),
        ),
        el('div', { class: 'body', id: bid, hidden: w.collapsed }, R[w.type](w)),
    );
    bindDrag(grip, art, w);
    return art;
}
const FOCUSABLE_IN_CARD = 'input, button, textarea, .grip, .note';

function render() {
    const ws = Store.state.widgets;

    const active = document.activeElement;
    const owner = active?.closest?.('.card');
    const memo = owner && {
        id: owner.dataset.id,
        index: [...owner.querySelectorAll(FOCUSABLE_IN_CARD)].indexOf(active),
    };

    $('#grid').replaceChildren(...ws.map(card));
    $('#grid').hidden = !ws.length;
    $('#empty').hidden = ws.length > 0;
    $('#count').textContent = 'Виджетов: ' + ws.length;

    if (memo && memo.index >= 0) {
        const fresh = $(`.card[data-id="${memo.id}"]`);
        fresh?.querySelectorAll(FOCUSABLE_IN_CARD)[memo.index]?.focus();
    }
}
function addWidget(type, title) {
    const w = { id: uid(), type, title, collapsed: false, data: structuredClone(DEFAULTS[type]) };
    Store.state.widgets.push(w);
    save();
    render();
    Toast.show('Виджет добавлен');
    if (type === 'chart') loadChart(w.id);
}
function removeWidget(id) {
    Store.state.widgets = Store.state.widgets.filter((w) => w.id !== id);
    chartState.delete(id);
    save();
    render();
    Toast.show('Виджет удалён');
}
function addDialog() {
    const title = el('input', {
        id: 'nt',
        maxlength: 60,
        autofocus: true,
        placeholder: 'Например, План на неделю',
    });
    const err = el('p', { class: 'err', role: 'alert' });
    const form = el(
        'div',
        {},
        el('label', { for: 'nt' }, 'Заголовок'),
        title,
        err,
        el(
            'fieldset',
            {},
            el('legend', {}, 'Тип виджета'),
            ...Object.entries(TYPES).map(([k, v], i) =>
                el(
                    'label',
                    { class: 'opt' },
                    el('input', { type: 'radio', name: 'type', value: k, checked: i === 0 }),
                    v,
                ),
            ),
        ),
    );
    let go;
    Modal.open({
        title: 'Новый виджет',
        body: form,
        actions: (close) => {
            go = () => {
                const t = title.value.trim();
                if (!t) {
                    err.textContent = 'Введите заголовок';
                    title.setAttribute('aria-invalid', 'true');
                    title.focus();
                    return;
                }
                const type = form.querySelector('input[name=type]:checked').value;
                close();
                addWidget(type, t);
            };
            return [
                el('button', { class: 'btn', onclick: () => close() }, 'Отмена'),
                el('button', { class: 'btn primary', onclick: () => go() }, 'Добавить'),
            ];
        },
    });
    title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
    });
}
async function resetDashboard() {
    if (!Store.state.widgets.length) {
        Toast.show('Дашборд уже пуст');
        return;
    }
    if (
        !(await confirmBox(
            'Сбросить дашборд?',
            'Все виджеты будут удалены. Это действие нельзя отменить.',
            'Сбросить',
        ))
    )
        return;
    Store.state.widgets = [];
    chartState.clear();
    save();
    render();
    Toast.show('Сброс выполнен');
}
function applyTheme() {
    const dark = Store.state.theme === 'dark';
    document.documentElement.dataset.theme = Store.state.theme;
    $('#theme').setAttribute('aria-checked', String(dark));
}

bus.render = render;
Store.load();
applyTheme();
render();
$('#add').onclick = $('#add2').onclick = addDialog;
$('#reset').onclick = resetDashboard;
$('#theme').onclick = () => {
    Store.state.theme = Store.state.theme === 'dark' ? 'light' : 'dark';
    save();
    applyTheme();
};
initGrid($('#grid'));

})();
