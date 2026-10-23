'use strict';
/* Bulk Properties: pick a property, tick some of its values, then change,
   remove or delete them in every note that has them. Or rename a property
   (merging into one that already exists). Notes are edited with
   processFrontMatter, Obsidian's own safe way to rewrite properties. */
import { Modal, Notice, Setting } from 'obsidian';

const EMPTY = '\u0000empty'; /* the key for "no value" */
const PREVIEW_MAX = 50;

function isEmpty(v) {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function asList(v) {
    return isEmpty(v) ? [] : Array.isArray(v) ? v : [v];
}

function key(v) {
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/* the keys of a value: one per list item, or EMPTY */
function valueKeys(v) {
    const items = asList(v).filter((x) => !isEmpty(x));
    return items.length ? items.map(key) : [EMPTY];
}

/* typed text in the same type as the value it replaces */
function coerce(text, like) {
    const t = text.trim();
    if (typeof like === 'number' && t !== '' && !isNaN(Number(t)))
        return Number(t);
    if (typeof like === 'boolean' && /^(true|false)$/i.test(t))
        return /^true$/i.test(t);
    return t;
}

function dedupe(list) {
    const seen = new Set();
    return list.filter((x) => {
        const k = key(x);
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
}

/* every property in the vault: name -> {files, values: key -> {label, files}} */
function collect(app) {
    const props = new Map();
    for (const file of app.vault.getMarkdownFiles()) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm)
            continue;
        for (const [name, v] of Object.entries(fm)) {
            if (name === 'position')
                continue;
            if (!props.has(name))
                props.set(name, { files: [], values: new Map() });
            const p = props.get(name);
            p.files.push(file);
            const items = asList(v).filter((x) => !isEmpty(x));
            for (const k of valueKeys(v)) {
                if (!p.values.has(k)) {
                    const item = items.find((x) => key(x) === k);
                    p.values.set(k, { label: k === EMPTY ? '(empty)' : key(item), files: [] });
                }
                const entry = p.values.get(k);
                if (!entry.files.includes(file))
                    entry.files.push(file);
            }
        }
    }
    return props;
}

/* the value after changing or removing the selected values */
function changed(v, selected, action, text) {
    if (action === 'remove' || (action === 'change' && text.trim() === '')) {
        if (Array.isArray(v)) {
            const rest = v.filter((x) => !selected.has(key(x)));
            return rest.length ? rest : null;
        }
        return null;
    }
    if (Array.isArray(v)) {
        const out = v.map((x) => (selected.has(key(x)) ? coerce(text, x) : x));
        if (selected.has(EMPTY) && v.length === 0)
            out.push(text.trim());
        return dedupe(out);
    }
    return coerce(text, v);
}

/* two values for one property: lists are combined, otherwise the target
   keeps its value and the note is reported as a conflict */
function merge(target, source) {
    if (isEmpty(source))
        return { value: target === undefined ? null : target };
    if (isEmpty(target))
        return { value: source };
    if (Array.isArray(target) || Array.isArray(source))
        return { value: dedupe(asList(target).concat(asList(source))) };
    if (key(target) === key(source))
        return { value: target };
    return { value: target, conflict: true };
}

/* rename `from` to `to` in place, keeping the property's position */
function rename(fm, from, to) {
    const m = merge(fm[to], fm[from]);
    const entries = Object.entries(fm);
    for (const k of Object.keys(fm))
        delete fm[k];
    let placed = false;
    for (const [k, v] of entries) {
        if (k === from || k === to) {
            if (!placed)
                fm[to] = m.value;
            placed = true;
            continue;
        }
        fm[k] = v;
    }
    return !!m.conflict;
}

class BulkModal extends Modal {
    constructor(app) {
        super(app);
        this.props = collect(app);
        this.modalEl.addClass('bulk-props');
    }

    onOpen() {
        this.titleEl.setText('Bulk edit properties');
        this.pickProperty();
    }

    onClose() {
        this.contentEl.empty();
    }

    /* step 1: the property */
    pickProperty() {
        const el = this.contentEl;
        el.empty();
        const input = el.createEl('input', { type: 'text', placeholder: 'Property name…', cls: 'bulk-props-search' });
        const list = el.createDiv({ cls: 'bulk-props-list' });
        const names = [...this.props.keys()].sort((a, b) =>
            this.props.get(b).files.length - this.props.get(a).files.length || a.localeCompare(b));
        let shown = [];
        const draw = () => {
            const q = input.value.trim().toLowerCase();
            shown = names.filter((n) => n.toLowerCase().includes(q));
            list.empty();
            for (const name of shown) {
                const row = list.createDiv({ cls: 'bulk-props-row is-clickable' });
                row.createSpan({ text: name, cls: 'bulk-props-name' });
                row.createSpan({ text: this.props.get(name).files.length + ' notes', cls: 'bulk-props-count' });
                row.onclick = () => this.pickValues(name);
            }
            if (!shown.length)
                list.createDiv({ text: 'No property matches.', cls: 'bulk-props-none' });
        };
        input.oninput = draw;
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && shown.length)
                this.pickValues(shown[0]);
        };
        draw();
        input.focus();
    }

    /* step 2: the values */
    pickValues(name) {
        const p = this.props.get(name);
        const el = this.contentEl;
        el.empty();
        this.header(el, 'Property: ' + name + ' · ' + p.files.length + ' notes', () => this.pickProperty());
        new Setting(el)
            .setName('Rename or merge this property')
            .setDesc('Give every note’s “' + name + '” a new name.')
            .addButton((b) => b.setButtonText('Rename…').onClick(() => this.renameProperty(name)));

        const input = el.createEl('input', { type: 'text', placeholder: 'Search values…', cls: 'bulk-props-search' });
        const tools = el.createDiv({ cls: 'bulk-props-tools' });
        const list = el.createDiv({ cls: 'bulk-props-list' });
        const footer = el.createDiv({ cls: 'bulk-props-footer' });
        const summary = footer.createSpan();
        const next = footer.createEl('button', { text: 'Next', cls: 'mod-cta' });

        const selected = new Set();
        const entries = [...p.values.entries()].sort((a, b) =>
            b[1].files.length - a[1].files.length || a[1].label.localeCompare(b[1].label));
        let shown = [];
        const affected = () => {
            const files = new Set();
            for (const k of selected)
                for (const f of p.values.get(k).files)
                    files.add(f);
            return [...files];
        };
        const update = () => {
            const n = affected().length;
            summary.setText(selected.size + ' value' + (selected.size === 1 ? '' : 's') + ' ticked · ' + n + ' note' + (n === 1 ? '' : 's'));
            next.disabled = !selected.size;
        };
        const draw = () => {
            const q = input.value.trim().toLowerCase();
            shown = entries.filter(([, v]) => v.label.toLowerCase().includes(q));
            list.empty();
            for (const [k, v] of shown) {
                const row = list.createEl('label', { cls: 'bulk-props-row' });
                const box = row.createEl('input', { type: 'checkbox' });
                box.checked = selected.has(k);
                box.onchange = () => {
                    box.checked ? selected.add(k) : selected.delete(k);
                    update();
                };
                row.createSpan({ text: v.label, cls: 'bulk-props-name' + (k === EMPTY ? ' is-empty' : '') });
                row.createSpan({ text: v.files.length + ' notes', cls: 'bulk-props-count' });
            }
            if (!shown.length)
                list.createDiv({ text: 'No value matches.', cls: 'bulk-props-none' });
        };
        const all = tools.createEl('button', { text: 'Tick all shown' });
        all.onclick = () => { shown.forEach(([k]) => selected.add(k)); draw(); update(); };
        const none = tools.createEl('button', { text: 'Clear' });
        none.onclick = () => { selected.clear(); draw(); update(); };
        input.oninput = draw;
        next.onclick = () => this.pickAction(name, new Set(selected), affected());
        draw();
        update();
        input.focus();
    }

    /* step 3: what to do with the ticked values */
    pickAction(name, selected, files) {
        const p = this.props.get(name);
        const el = this.contentEl;
        el.empty();
        this.header(el, 'Property: ' + name, () => this.pickValues(name));
        const labels = [...selected].map((k) => p.values.get(k).label);
        el.createDiv({ text: 'Ticked: ' + labels.join(', '), cls: 'bulk-props-ticked' });

        let action = 'change', text = '';
        let valueSetting;
        new Setting(el).setName('Action').addDropdown((d) => d
            .addOption('change', 'Change to…')
            .addOption('remove', 'Remove these values')
            .addOption('delete', 'Delete the property from these notes')
            .setValue(action)
            .onChange((v) => {
                action = v;
                valueSetting.settingEl.toggle(v === 'change');
            }));
        valueSetting = new Setting(el)
            .setName('New value')
            .setDesc('In a list, only the ticked items change. Leave empty to clear them.')
            .addText((t) => {
                t.setPlaceholder('New value').onChange((v) => { text = v; });
                setTimeout(() => t.inputEl.focus(), 0);
            });

        this.preview(el, files);
        this.applyButton(el, files.length, async () => {
            let n = 0, failed = 0;
            for (const file of files) {
                try {
                    await this.app.fileManager.processFrontMatter(file, (fm) => {
                        if (!(name in fm))
                            return;
                        if (action === 'delete')
                            delete fm[name];
                        else
                            fm[name] = changed(fm[name], selected, action, text);
                    });
                    n++;
                } catch (e) {
                    console.error('Bulk Properties:', file.path, e);
                    failed++;
                }
            }
            new Notice('Bulk Properties: updated ' + n + ' note' + (n === 1 ? '' : 's') +
                (failed ? ', ' + failed + ' failed (see console)' : ''));
        });
    }

    /* rename or merge a property */
    renameProperty(name) {
        const p = this.props.get(name);
        const el = this.contentEl;
        el.empty();
        this.header(el, 'Rename property: ' + name, () => this.pickValues(name));
        const listId = 'bulk-props-names';
        const datalist = el.createEl('datalist', { attr: { id: listId } });
        for (const n of this.props.keys())
            if (n !== name)
                datalist.createEl('option', { value: n });
        const input = el.createEl('input', {
            type: 'text', placeholder: 'New property name…', cls: 'bulk-props-search', attr: { list: listId }
        });
        const note = el.createDiv({ cls: 'bulk-props-ticked' });
        const update = () => {
            const to = input.value.trim();
            const both = to && this.props.has(to)
                ? p.files.filter((f) => this.props.get(to).files.includes(f)).length : 0;
            note.setText(!to ? '' : to === name ? 'That is the same name.'
                : both ? both + ' of these notes already have “' + to + '”. Lists are combined; if both have different single values, “' + to + '” keeps its own.'
                : this.props.has(to) ? 'Merges into the existing “' + to + '” property.' : '');
        };
        input.oninput = update;
        this.preview(el, p.files);
        this.applyButton(el, p.files.length, async () => {
            const to = input.value.trim();
            if (!to || to === name) {
                new Notice('Bulk Properties: type a different property name.');
                return false;
            }
            let n = 0, failed = 0;
            const conflicts = [];
            for (const file of p.files) {
                try {
                    await this.app.fileManager.processFrontMatter(file, (fm) => {
                        if (name in fm && rename(fm, name, to))
                            conflicts.push(file.basename);
                    });
                    n++;
                } catch (e) {
                    console.error('Bulk Properties:', file.path, e);
                    failed++;
                }
            }
            new Notice('Bulk Properties: renamed in ' + n + ' note' + (n === 1 ? '' : 's') +
                (failed ? ', ' + failed + ' failed (see console)' : '') +
                (conflicts.length ? '. Kept “' + to + '” where values differed: ' + conflicts.join(', ') : ''),
                conflicts.length ? 0 : 5000);
        });
        input.focus();
    }

    header(el, text, back) {
        const h = el.createDiv({ cls: 'bulk-props-header' });
        const b = h.createEl('button', { text: '← Back' });
        b.onclick = back;
        h.createSpan({ text, cls: 'bulk-props-title' });
    }

    preview(el, files) {
        el.createDiv({ text: 'Notes that will change (' + files.length + '):', cls: 'bulk-props-label' });
        const list = el.createDiv({ cls: 'bulk-props-list bulk-props-preview' });
        for (const f of files.slice(0, PREVIEW_MAX))
            list.createDiv({ text: f.path.replace(/\.md$/, ''), cls: 'bulk-props-file' });
        if (files.length > PREVIEW_MAX)
            list.createDiv({ text: '…and ' + (files.length - PREVIEW_MAX) + ' more', cls: 'bulk-props-none' });
    }

    applyButton(el, count, run) {
        const footer = el.createDiv({ cls: 'bulk-props-footer' });
        footer.createSpan({ text: 'This cannot be undone with Ctrl+Z.' });
        const b = footer.createEl('button', { text: 'Apply to ' + count + ' note' + (count === 1 ? '' : 's'), cls: 'mod-warning' });
        b.onclick = async () => {
            b.disabled = true;
            const ok = await run();
            if (ok === false) {
                b.disabled = false;
                return;
            }
            this.close();
        };
    }
}

export function setupBulk(plugin) {
    const open = () => new BulkModal(plugin.app).open();
    plugin.addCommand({ id: 'bulk-edit-properties', name: 'Bulk edit properties', callback: open });
    plugin.addRibbonIcon('list-checks', 'Bulk edit properties', open);
}

/* for tests outside Obsidian */
export const _test = { changed, merge, rename, valueKeys, EMPTY, key };
