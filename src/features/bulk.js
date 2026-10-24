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

/* Undo. Before a bulk edit changes a note, its properties are saved, before and
   after, in a log file next to the plugin (the last UNDO_KEEP edits). Undoing
   puts the saved properties back, in their original order, but only in notes
   that still look exactly as the edit left them, so nothing written since is lost. */
const UNDO_KEEP = 10;

function snapshot(fm) {
    return Object.entries(fm).map(([k, v]) => [k, JSON.parse(JSON.stringify(v === undefined ? null : v))]);
}

function sameSnapshot(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function applySnapshot(fm, entries) {
    for (const k of Object.keys(fm))
        delete fm[k];
    for (const [k, v] of entries)
        fm[k] = v;
}

function show(v) {
    return Array.isArray(v) ? v.join(', ') : isEmpty(v) ? '(empty)' : String(v);
}

class UndoLog {
    constructor(plugin) {
        this.plugin = plugin;
    }

    get path() {
        return this.plugin.manifest.dir + '/bulk-undo.json';
    }

    async read() {
        try {
            const list = JSON.parse(await this.plugin.app.vault.adapter.read(this.path));
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    async write(list) {
        await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(list));
    }

    async add(entry) {
        const list = await this.read();
        list.push(entry);
        await this.write(list.slice(-UNDO_KEEP));
    }

    async last() {
        const list = await this.read();
        return list[list.length - 1] || null;
    }

    async dropLast() {
        const list = await this.read();
        list.pop();
        await this.write(list);
    }
}

/* Runs `edit(fm, file)` on each note's properties and logs what changed, for undo */
async function applyEdit(app, files, edit, description, log) {
    const records = [];
    let failed = 0;
    for (const file of files) {
        try {
            let rec = null;
            await app.fileManager.processFrontMatter(file, (fm) => {
                const before = snapshot(fm);
                edit(fm, file);
                const after = snapshot(fm);
                if (!sameSnapshot(before, after))
                    rec = { path: file.path, before, after };
            });
            if (rec)
                records.push(rec);
        } catch (e) {
            console.error('Bulk Properties:', file.path, e);
            failed++;
        }
    }
    if (records.length)
        await log.add({ time: Date.now(), description: description + ' (' + records.length + ' note' + (records.length === 1 ? '' : 's') + ')', files: records });
    return { changed: records.length, failed };
}

async function undoLast(app, log) {
    const entry = await log.last();
    if (!entry) {
        new Notice('Bulk Properties: nothing to undo.');
        return;
    }
    let restored = 0, skipped = 0, failed = 0;
    for (const rec of entry.files) {
        const file = app.vault.getFileByPath ? app.vault.getFileByPath(rec.path) : app.vault.getAbstractFileByPath(rec.path);
        if (!file || !file.extension) {
            skipped++; /* deleted or renamed since */
            continue;
        }
        try {
            let did = false;
            await app.fileManager.processFrontMatter(file, (fm) => {
                if (!sameSnapshot(snapshot(fm), rec.after))
                    return; /* edited since: leave it alone */
                applySnapshot(fm, rec.before);
                did = true;
            });
            did ? restored++ : skipped++;
        } catch (e) {
            console.error('Bulk Properties:', rec.path, e);
            failed++;
        }
    }
    if (!failed)
        await log.dropLast();
    new Notice('Bulk Properties: undid “' + entry.description + '”: restored ' + restored + ' note' + (restored === 1 ? '' : 's') +
        (skipped ? ', left ' + skipped + ' that changed since or no longer exist' : '') +
        (failed ? ', ' + failed + ' failed (see console); run the undo again to retry' : '') + '.', skipped || failed ? 0 : 5000);
}

class BulkModal extends Modal {
    constructor(app, log) {
        super(app);
        this.log = log;
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
        this.log.last().then((entry) => {
            if (!entry || !this.contentEl.contains(input))
                return;
            const row = this.contentEl.createDiv({ cls: 'bulk-props-footer' });
            row.createSpan({ text: 'Last bulk edit: ' + entry.description });
            const b = row.createEl('button', { text: 'Undo it' });
            b.onclick = async () => {
                b.disabled = true;
                await undoLast(this.app, this.log);
                this.close();
            };
        });
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
                draw();
            }));
        valueSetting = new Setting(el)
            .setName('New value')
            .setDesc('In a list, only the ticked items change. Leave empty to clear them.')
            .addText((t) => {
                t.setPlaceholder('New value').onChange((v) => { text = v; draw(); });
                setTimeout(() => t.inputEl.focus(), 0);
            });

        const holder = el.createDiv();
        const draw = () => {
            holder.empty();
            this.preview(holder, files, (file) => {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                if (!fm || !(name in fm))
                    return '';
                if (action === 'delete')
                    return show(fm[name]) + ' → (deleted)';
                return show(fm[name]) + ' → ' + show(changed(fm[name], selected, action, text));
            });
        };
        draw();
        this.applyButton(el, files.length, async () => {
            const what = action === 'delete' ? 'Deleted “' + name + '”'
                : action === 'remove' ? 'Removed ' + labels.join(', ') + ' from “' + name + '”'
                : 'Changed “' + name + '”: ' + labels.join(', ') + ' → ' + (text.trim() || '(empty)');
            const r = await applyEdit(this.app, files, (fm) => {
                if (!(name in fm))
                    return;
                if (action === 'delete')
                    delete fm[name];
                else
                    fm[name] = changed(fm[name], selected, action, text);
            }, what, this.log);
            new Notice('Bulk Properties: updated ' + r.changed + ' note' + (r.changed === 1 ? '' : 's') +
                (r.failed ? ', ' + r.failed + ' failed (see console)' : '') + '. To undo, run “Undo last bulk edit”.');
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
        const holder = el.createDiv();
        const draw = () => {
            holder.empty();
            this.preview(holder, p.files, (file) => {
                const to = input.value.trim();
                if (!to || to === name)
                    return '';
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                return name + ' → ' + to + (fm && to in fm ? ' (merges with the existing value)' : '');
            });
        };
        input.oninput = () => { update(); draw(); };
        draw();
        this.applyButton(el, p.files.length, async () => {
            const to = input.value.trim();
            if (!to || to === name) {
                new Notice('Bulk Properties: type a different property name.');
                return false;
            }
            const conflicts = [];
            const r = await applyEdit(this.app, p.files, (fm, file) => {
                if (name in fm && rename(fm, name, to))
                    conflicts.push(file.basename);
            }, 'Renamed “' + name + '” to “' + to + '”', this.log);
            new Notice('Bulk Properties: renamed in ' + r.changed + ' note' + (r.changed === 1 ? '' : 's') +
                (r.failed ? ', ' + r.failed + ' failed (see console)' : '') +
                (conflicts.length ? '. Kept “' + to + '” where values differed: ' + conflicts.join(', ') : '') +
                '. To undo, run “Undo last bulk edit”.',
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

    preview(el, files, describe) {
        el.createDiv({ text: 'Notes that will change (' + files.length + '):', cls: 'bulk-props-label' });
        const list = el.createDiv({ cls: 'bulk-props-list bulk-props-preview' });
        for (const f of files.slice(0, PREVIEW_MAX)) {
            const change = describe ? describe(f) : '';
            list.createDiv({ text: f.path.replace(/\.md$/, '') + (change ? ': ' + change : ''), cls: 'bulk-props-file' });
        }
        if (files.length > PREVIEW_MAX)
            list.createDiv({ text: '…and ' + (files.length - PREVIEW_MAX) + ' more', cls: 'bulk-props-none' });
    }

    applyButton(el, count, run) {
        const footer = el.createDiv({ cls: 'bulk-props-footer' });
        footer.createSpan({ text: 'Ctrl+Z will not undo this: use Undo last bulk edit.' });
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
    const log = new UndoLog(plugin);
    const open = () => new BulkModal(plugin.app, log).open();
    plugin.addCommand({ id: 'bulk-edit-properties', name: 'Bulk edit properties', callback: open });
    plugin.addCommand({ id: 'undo-last-bulk-edit', name: 'Undo last bulk edit', callback: () => undoLast(plugin.app, log) });
    plugin.addRibbonIcon('list-checks', 'Bulk edit properties', open);
}

/* for tests outside Obsidian */
export const _test = { changed, merge, rename, valueKeys, EMPTY, key, snapshot, sameSnapshot, applySnapshot, applyEdit, undoLast, UndoLog };
