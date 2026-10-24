const view = require('@codemirror/view'); const state = require('@codemirror/state');
const P = Element.prototype;
P.addClass = function (c) { this.classList.add(c); }; P.removeClass = function (c) { this.classList.remove(c); };
P.toggleClass = function (c, on) { this.classList.toggle(c, !!on); };
P.setCssProps = function (o) { for (const k in o) this.style.setProperty(k, o[k]); };
P.instanceOf = function (C) { return this instanceof C; };
P.empty = function () { this.replaceChildren(); };
P.createEl = function (tag, o = {}) { const e = document.createElement(tag); if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; this.appendChild(e); return e; };
P.createDiv = function (o = {}) { return this.createEl('div', o); };
P.createSpan = function (o = {}) { const e = this.createEl('span', o); if (o.attr) for (const k in o.attr) e.setAttribute(k, o.attr[k]); return e; };
window.__notices = []; window.__clip = []; window.__settings = []; window.__web = {}; window.__files = {}; window.__notes = {}; window.__writes = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (v) => { window.__clip.push(v); } }, configurable: true });
class Notice { constructor(m) { window.__notices.push(m); } hide() {} }
class Plugin {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; this.cmds = {}; this.exts = []; this.processors = []; this.ribbon = []; this.events = []; this.saved = null; this.tab = null; }
    async loadData() { return window.__data || null; } async saveData(d) { this.saved = JSON.parse(JSON.stringify(d)); }
    addSettingTab(t) { this.tab = t; } registerEvent(e) { this.events.push(e); } addCommand(c) { this.cmds[c.id] = c; } addRibbonIcon(i, t, f) { this.ribbon.push([i, t, f]); }
    registerEditorExtension(e) { this.exts.push(e); } registerMarkdownPostProcessor(f) { this.processors.push(f); }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); } }
// A settings control that accepts any chained call; callbacks are kept for the tests to fire
function control(kind, setting, cb) {
    const state = { kind, value: '', options: [] };
    const p = new Proxy(state, {
        get(target, k) {
            if (k in target) return target[k];
            if (k === 'setValue') return (v) => { target.value = v; return p; };
            if (k === 'addOption') return (v, l) => { target.options.push([v, l]); return p; };
            if (k === 'onChange' || k === 'onClick') return (f) => { target.cb = f; return p; };
            if (k === 'setButtonText') return (x) => { target.text = x; return p; };
            if (k === 'inputEl') return (target.inputEl = target.inputEl || document.createElement('input'));
            return () => p;
        },
        set(target, k, v) { target[k] = v; return true; },
    });
    setting.controls.push([kind, p]); cb(p); return setting;
}
class Setting {
    constructor(el) { this.el = el; this.name = ''; this.desc = ''; this.heading = false; this.controls = []; this.settingEl = document.createElement('div'); this.settingEl.toggle = () => {}; window.__settings.push(this); }
    setName(n) { this.name = n; return this; } setDesc(d) { this.desc = d; return this; } setHeading() { this.heading = true; return this; }
    addToggle(cb) { return control('toggle', this, cb); } addText(cb) { return control('text', this, cb); } addTextArea(cb) { return control('text', this, cb); }
    addDropdown(cb) { return control('dropdown', this, cb); } addButton(cb) { return control('button', this, cb); } addExtraButton(cb) { return control('extra', this, cb); }
    addSlider(cb) { return control('slider', this, cb); }
}
class Modal { constructor(app) { this.app = app; } open() {} close() {} }
class MarkdownView {}
class TFile { constructor(path = 'Note.md') { this.path = path; this.extension = path.split('.').pop(); } }
const MarkdownRenderer = { render: async (app, content, el) => { el.innerHTML = window.__rendered || ''; } };
window.createDiv = (o = {}) => { const e = document.createElement('div'); if (o.cls) e.className = o.cls; return e; };
const stub = { Plugin, PluginSettingTab, Setting, Modal, Notice, MarkdownView, TFile, MarkdownRenderer, editorLivePreviewField: state.StateField.define({ create: () => true, update: (v) => v }),
    requestUrl: async ({ url }) => {
        if (window.__web.offline) throw new Error('offline');
        let m = url.match(/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/latest/);
        if (m) { const rel = window.__web[m[1] + ':release']; if (!rel) throw new Error('Request failed, status 404'); return { json: rel }; }
        m = url.match(/github\.com\/([^/]+\/[^/]+)\/releases\/download\/[^/]+\/(.+)$/);
        if (m) { const body = window.__web[m[1] + ':' + m[2]]; if (body === undefined) throw new Error('404 ' + url); return { text: body }; }
        m = url.match(/api\.github\.com\/repos\/([^/]+\/[^/]+)\/commits\//); if (m) return { json: { sha: 'abc' } };
        m = url.match(/api\.github\.com\/repos\/([^/]+\/[^/]+)$/); if (m) return { json: { default_branch: 'main' } };
        m = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/[^/]+\/([A-Za-z.]+)\?/);
        const body = m && window.__web[m[1] + ':' + m[2]]; if (body === undefined) throw new Error('404 ' + url);
        return { text: body };
    } };
const mods = { obsidian: stub, '@codemirror/view': view, '@codemirror/state': state };
window.__make = (code, data) => {
    window.__data = data || null; window.__settings.length = 0;
    const module = { exports: {} }; new Function('module', 'exports', 'require', code)(module, module.exports, (n) => mods[n]);
    window.__exports = module.exports;
    const layout = [];
    const files = window.__files = {};
    const app = { workspace: { on() { return {}; }, getLeavesOfType: () => [], getActiveFile: () => window.__active || null, onLayoutReady: (f) => layout.push(f), iterateAllLeaves() {}, updateOptions() { window.__updated = (window.__updated || 0) + 1; } },
        metadataCache: { on() { return {}; }, getFileCache: (f) => (window.__notes[f.path] ? { frontmatter: window.__notes[f.path].fm } : null), getFirstLinkpathDest: (t) => (t === 'Other' ? { path: 'Other.md' } : null) },
        fileManager: { processFrontMatter: async (f, cb) => { const n = window.__notes[f.path]; if (!n) throw new Error('no such note ' + f.path); if (n.fail) throw new Error('write failed'); const fm = n.fm; cb(fm); } },
        vault: { configDir: '.obsidian', on() { return {}; }, getMarkdownFiles: () => [], getFileByPath: (p) => (window.__notes[p] ? { path: p, extension: 'md', basename: p.replace(/\.md$/, '') } : null), getName: () => 'Test Vault', cachedRead: async () => '# note', getAbstractFileByPath: () => null, createBinary: async (p, b) => { window.__pdf = { path: p, bytes: new Uint8Array(b) }; }, modifyBinary: async () => {}, adapter: { read: async (f) => { if (!(f in files)) throw new Error('ENOENT'); return files[f]; }, write: async (f, t) => { files[f] = t; window.__writes.push(f); }, exists: async (f) => f in files || Object.keys(files).some((k) => k.startsWith(f + '/')), mkdir: async () => {} } },
        customCss: { theme: '', setTheme(n) { this.theme = n; window.__reloaded = n; } }, plugins: { disablePlugin: async (x) => { window.__reload = (window.__reload || []).concat('d ' + x); }, enablePlugin: async (x) => { window.__reload = (window.__reload || []).concat('e ' + x); } } };
    const p = new module.exports.default(app, { id: 'vr-vault-management', name: 'Vault Management', version: '1.0.0', dir: '.obsidian/plugins/vr-vault-management' });
    p.layout = layout; window.__p = p; return p;
};
window.__run = (el, src) => window.__p.processors.forEach((f) => f(el, { getSectionInfo: () => (src === undefined ? null : { text: src, lineStart: 0 }) }));
window.__lp = async (doc, cursorPos) => {
    const p = window.__p; const host = document.createElement('div'); host.style.cssText = 'width:700px;height:600px'; document.body.appendChild(host);
    const v = new view.EditorView({ state: state.EditorState.create({ doc, extensions: [stub.editorLivePreviewField, p.exts] }), parent: host });
    if (cursorPos !== undefined) v.dispatch({ selection: { anchor: cursorPos } });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__view = v; return v;
};
