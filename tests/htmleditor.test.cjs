// HTML editor: the preview's link mapping (run for real in a sandboxed frame), the
// editor view (loading, editing, saving, layouts, images folder), and the feature.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };

// A page that, like many small sites, builds most of itself with JavaScript
const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Test page</title>
<link rel="icon" href="/favicon.svg">
<style>.hero { background: url(/img/hero.jpg); }</style>
</head>
<body>
<img id="static" src="/img/photo.jpg?v=2">
<img id="relative" src="img/photo.jpg">
<img id="web" src="https://example.com/a.png">
<img id="set" srcset="img/photo.jpg 1x, /img/hero.jpg 2x">
<div id="inline" style="background-image: url('img/hero.jpg')"></div>
<div id="app"></div>
<script>
  var CONFIG = { photo: '/img/photo.jpg', missing: '/img/none.jpg' };
  var app = document.getElementById('app');
  var img = document.createElement('img'); img.id = 'scripted'; img.src = CONFIG.photo; app.appendChild(img);
  var gone = document.createElement('img'); gone.id = 'missing'; gone.src = CONFIG.missing; app.appendChild(gone);
  setTimeout(function () { var later = document.createElement('img'); later.id = 'later'; later.setAttribute('src', 'img/hero.jpg'); app.appendChild(later); }, 30);
</script>
</body>
</html>
`;

(async () => {
    const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1000, height: 700 } });
    // the errors section 6b puts in its test page on purpose are expected; anything else counts
    const EXPECTED = [/Unexpected identifier 'missing'/, /nosuchFunction is not defined/];
    pg.on('pageerror', (e) => { if (EXPECTED.some((r) => r.test(e.message))) return; failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body></body>'); await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    const code = fs.readFileSync(R + '/main.js', 'utf8');
    await pg.evaluate((c) => { window.__make(c, null); }, code);

    // 1. building the preview document
    const map = await pg.evaluate(() => window.__exports.__test.html.assetMap([{ path: 'Site/favicon.svg' }, { path: 'Site/img/photo.jpg' }, { path: 'Site/img/hero.jpg' }, { path: 'Other/x.png' }, { path: 'Sites/y.png' }], 'Site/', () => 'X'));
    const keys = Object.keys(map).sort();
    ok(JSON.stringify(keys) === JSON.stringify(['./favicon.svg', './img/hero.jpg', './img/photo.jpg', '/favicon.svg', '/img/hero.jpg', '/img/photo.jpg', 'favicon.svg', 'img/hero.jpg', 'img/photo.jpg']), 'every file in the folder, three ways, nothing outside it: ' + JSON.stringify(keys));
    ok(JSON.stringify(await pg.evaluate(() => window.__exports.__test.html.assetMap([{ path: 'a.png' }], '', () => 'X'))) === '{}', 'no folder: no mapping');
    const docHead = await pg.evaluate(() => window.__exports.__test.html.previewDocument('<html><head><title>x</title></head><body></body></html>', {}, 0));
    ok(/^<html><head><script data-vm-preview>/.test(docHead) && docHead.endsWith('<title>x</title></head><body></body></html>'), 'helper goes first in <head>, page otherwise unchanged');
    const noHead = await pg.evaluate(() => window.__exports.__test.html.previewDocument('<html lang="en"><body>x</body></html>', {}, 0));
    ok(/^<html lang="en"><head><script data-vm-preview>[\s\S]*<\/script><\/head><body>x<\/body><\/html>$/.test(noHead), 'adds a <head> when there is none');
    const bare = await pg.evaluate(() => window.__exports.__test.html.previewDocument('<p>hi</p>', {}, 0));
    ok(/^<script data-vm-preview>[\s\S]*<\/script><p>hi<\/p>$/.test(bare), 'a fragment works too');
    const nasty = await pg.evaluate(() => window.__exports.__test.html.previewDocument('<head></head>', { '</script><script>alert(1)': 'x' }, 0));
    ok(!/<\/script><script>alert/.test(nasty), 'file names cannot break out of the helper script');
    console.log('1. preview document: helper first, mapping covers the folder only, safe against odd file names');

    // 2. the preview for real: sandboxed frame, scripts running, links pointed at the vault
    const result = await pg.evaluate(async (page) => {
        const fake = (p) => 'https://vault.test/' + p;
        const m = window.__exports.__test.html.assetMap(['Site/favicon.svg', 'Site/img/photo.jpg', 'Site/img/hero.jpg'].map((p) => ({ path: p })), 'Site', fake);
        // the page reports what it sees back to us (it can't be read from outside: that's the point)
        const report = `<script>window.addEventListener('load', function () { setTimeout(function () {
            var q = function (s) { var e = document.querySelector(s); return e && e.getAttribute('src'); };
            var reach = 'blocked'; try { reach = parent.document.title; } catch (e) {}
            var store = 'blocked'; try { localStorage.getItem('x'); store = 'open'; } catch (e) {}
            parent.postMessage({ report: { icon: document.querySelector('link[rel=icon]').getAttribute('href'), static: q('#static'), relative: q('#relative'), web: q('#web'),
                set: document.querySelector('#set').getAttribute('srcset'), inline: document.querySelector('#inline').getAttribute('style'), css: document.querySelector('style').textContent,
                scripted: q('#scripted'), later: q('#later'), missing: q('#missing'), reach: reach, store: store } }, '*'); }, 120); });<\/script>`;
        const src = window.__exports.__test.html.previewDocument(page.replace('</body>', report + '</body>'), m, 0);
        const frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts'); frame.srcdoc = src; document.body.appendChild(frame);
        const got = await new Promise((res) => { const on = (e) => { if (e.source === frame.contentWindow && e.data && e.data.report) { window.removeEventListener('message', on); res(e.data.report); } }; window.addEventListener('message', on); setTimeout(() => res(null), 4000); });
        frame.remove(); return got;
    }, PAGE);
    ok(result, 'the preview page ran and reported back');
    if (result) {
        ok(result.icon === 'https://vault.test/Site/favicon.svg', 'favicon link: ' + result.icon);
        ok(result.static === 'https://vault.test/Site/img/photo.jpg', 'absolute link with ?query: ' + result.static);
        ok(result.relative === 'https://vault.test/Site/img/photo.jpg', 'relative link: ' + result.relative);
        ok(result.web === 'https://example.com/a.png', 'web addresses untouched: ' + result.web);
        ok(result.set === 'https://vault.test/Site/img/photo.jpg 1x, https://vault.test/Site/img/hero.jpg 2x', 'srcset: ' + result.set);
        ok(/url\('https:\/\/vault\.test\/Site\/img\/hero\.jpg'\)/.test(result.inline), 'inline style url(): ' + result.inline);
        ok(/url\(https:\/\/vault\.test\/Site\/img\/hero\.jpg\)/.test(result.css), '<style> url(): ' + result.css);
        ok(result.scripted === 'https://vault.test/Site/img/photo.jpg', 'image added by the page\'s script: ' + result.scripted);
        ok(result.later === 'https://vault.test/Site/img/hero.jpg', 'image added later by a timer: ' + result.later);
        ok(result.missing === '/img/none.jpg', 'a file not in the folder is left as written: ' + result.missing);
        ok(result.reach === 'blocked' && result.store === 'blocked', 'sealed: the page cannot reach Obsidian or its storage: ' + JSON.stringify([result.reach, result.store]));
    }
    console.log('2. preview, for real: page scripts run, every kind of local link shown from the vault, web links untouched, sealed off');

    // 3. the editor view
    await pg.evaluate(async (c) => {
        const p = window.__make(c, null);
        const files = ['Site/favicon.svg', 'Site/img/photo.jpg', 'Site/img/hero.jpg', 'page.html'].map((x) => ({ path: x }));
        p.app.vault.getFiles = () => files;
        p.app.vault.adapter.getResourcePath = (x) => 'app://local/' + x;
        await p.onload();
        window.__openView = (file, phone) => {
            window.__isPhone = !!phone;
            const leaf = { app: p.app, file };
            const v = p.views['vm-html-editor'](leaf);
            v.file = file;
            document.body.appendChild(v.contentEl);
            return v;
        };
    }, code);
    const view = await pg.evaluate(async (page) => {
        const v = window.__v = window.__openView({ path: 'page.html', name: 'page.html', basename: 'page', extension: 'html' });
        await v.onOpen(); v.setViewData(page, true);
        const out = {};
        out.type = v.getViewType(); out.title = v.getDisplayText(); out.icon = v.getIcon();
        out.actions = v.actions.map((a) => a.title);
        out.doc = v.editor.state.doc.toString() === page;
        const tok = (c, text) => [...v.contentEl.querySelectorAll('.cm-content .' + c)].some((s) => s.textContent === text);
        out.colored = tok('tok-typeName', 'img') && tok('tok-propertyName', 'src') && tok('tok-string', '"/img/photo.jpg?v=2"');
        out.lineNumbers = !!v.contentEl.querySelector('.cm-lineNumbers');
        out.layout = v.contentEl.className;
        out.frames = v.contentEl.querySelectorAll('iframe').length;
        const f = v.contentEl.querySelector('iframe');
        out.sandbox = f.getAttribute('sandbox');
        out.srcdocHasPage = f.srcdoc.includes('<title>Test page</title>') && f.srcdoc.includes('data-vm-preview');
        out.hint = (v.contentEl.querySelector('.vm-html-hint') || {}).textContent || '';
        out.savesAfterLoad = v.saves;
        return out;
    }, PAGE);
    ok(view.type === 'vm-html-editor' && view.title === 'page' && view.icon === 'code-xml', 'view basics: ' + JSON.stringify(view));
    ok(JSON.stringify(view.actions) === '["Images folder for this page","Reload the preview","Editor and preview side by side","Preview only","Editor only"]', 'buttons: ' + JSON.stringify(view.actions));
    ok(view.doc, 'file loaded into the editor');
    ok(view.colored, 'HTML coloured');
    ok(view.lineNumbers, 'line numbers');
    ok(/is-split/.test(view.layout) && view.frames === 1 && view.sandbox === 'allow-scripts' && view.srcdocHasPage, 'opens side by side with a sandboxed preview');
    ok(/Pick the folder they're in/.test(view.hint), 'no images folder yet: says how to fix it: ' + view.hint);
    ok(view.savesAfterLoad === 0, 'loading a file does not count as an edit');

    // edit: saved, preview refreshed after a pause
    const edit = await pg.evaluate(async () => {
        const v = window.__v; const before = v.contentEl.querySelector('iframe');
        v.editor.dispatch({ changes: { from: v.editor.state.doc.toString().indexOf('Test page'), to: v.editor.state.doc.toString().indexOf('Test page') + 9, insert: 'Edited page' } });
        const immediately = v.contentEl.querySelector('iframe') === before;
        await new Promise((r) => setTimeout(r, 600));
        const f = v.contentEl.querySelector('iframe');
        return { saves: v.saves, data: v.getViewData().includes('<title>Edited page</title>'), immediately, refreshed: f !== before && f.srcdoc.includes('Edited page') };
    });
    ok(edit.saves >= 1 && edit.data, 'typing saves through Obsidian: ' + JSON.stringify(edit));
    ok(edit.immediately && edit.refreshed, 'preview waits for a pause, then refreshes: ' + JSON.stringify(edit));
    // the file changes on disk (synced from the phone): the editor follows without counting as an edit
    const external = await pg.evaluate(() => { const v = window.__v; const s = v.saves; v.setViewData(v.getViewData().replace('Edited page', 'Synced page'), false); return { doc: v.editor.state.doc.toString().includes('Synced page'), saves: v.saves - s }; });
    ok(external.doc && external.saves === 0, 'a change from elsewhere loads without a save: ' + JSON.stringify(external));
    // layouts
    const layouts = await pg.evaluate(() => {
        const v = window.__v; const out = [];
        for (const t of ['Editor only', 'Preview only', 'Editor and preview side by side']) { v.actions.find((a) => a.title === t).cb(); out.push([v.contentEl.classList.contains('is-editor'), v.contentEl.classList.contains('is-preview'), v.contentEl.classList.contains('is-split'), getComputedStyle(v.contentEl.querySelector('.vm-html-preview')).display !== 'none', getComputedStyle(v.contentEl.querySelector('.vm-html-editor')).display !== 'none']); }
        return out;
    });
    ok(JSON.stringify(layouts[0].slice(0, 3)) === '[true,false,false]' && JSON.stringify(layouts[1].slice(0, 3)) === '[false,true,false]' && JSON.stringify(layouts[2].slice(0, 3)) === '[false,false,true]', 'layout buttons: ' + JSON.stringify(layouts));
    // phone: opens on the editor
    const phone = await pg.evaluate(async (page) => { const v = window.__openView({ path: 'page.html', name: 'page.html', basename: 'page' }, true); await v.onOpen(); v.setViewData(page, true); const r = [v.currentLayout, v.contentEl.querySelectorAll('iframe').length]; window.__isPhone = false; await v.onClose(); return r; }, PAGE);
    ok(JSON.stringify(phone) === '["editor",0]', 'a phone opens on the editor, preview not built until asked: ' + JSON.stringify(phone));
    console.log('3. editor view: loads, colours, saves, refreshes the preview after a pause, follows synced changes, layouts, phone');

    // 4. images folder: picked from the view, used by the preview, remembered, follows renames
    const folder = await pg.evaluate(async () => {
        const v = window.__v; const out = {};
        v.actions.find((a) => a.title === 'Images folder for this page').cb();
        const modal = window.__fuzzy; out.modal = !!modal;
        modal.onChooseItem({ path: 'Site' });
        await new Promise((r) => setTimeout(r, 30));
        out.saved = JSON.stringify(window.__p.saved.htmlEditor.assetFolders);
        const f = v.contentEl.querySelector('iframe');
        out.mapped = f.srcdoc.includes('app://local/Site/img/photo.jpg') && f.srcdoc.includes('app://local/Site/favicon.svg');
        out.hintGone = !v.contentEl.querySelector('.vm-html-hint');
        for (const fn of window.__vaultHandlers.rename) await fn({ path: 'Media/Site' }, 'Site');
        out.afterFolderRename = JSON.stringify(window.__p.settings.htmlEditor.assetFolders);
        for (const fn of window.__vaultHandlers.rename) await fn({ path: 'web/index.html' }, 'page.html');
        out.afterPageRename = JSON.stringify(window.__p.settings.htmlEditor.assetFolders);
        return out;
    });
    ok(folder.modal && folder.saved === '{"page.html":"Site"}', 'picked and saved: ' + JSON.stringify(folder));
    ok(folder.mapped && folder.hintGone, 'preview now uses the vault files, hint gone');
    ok(folder.afterFolderRename === '{"page.html":"Media/Site"}', 'folder renamed: followed: ' + folder.afterFolderRename);
    ok(folder.afterPageRename === '{"web/index.html":"Media/Site"}', 'page renamed: followed: ' + folder.afterPageRename);
    console.log('4. images folder: picked in the view, used by the preview, saved, renames followed');

    // 5. scripts off
    const noScripts = await pg.evaluate(async () => { window.__p.settings.htmlEditor.runScripts = false; const v = window.__v; v.renderPreview(); const s = v.contentEl.querySelector('iframe').getAttribute('sandbox'); window.__p.settings.htmlEditor.runScripts = true; return s; });
    ok(noScripts === '', 'scripts off: fully sandboxed: ' + JSON.stringify(noScripts));
    console.log('5. "run scripts" off: the frame gets no permissions at all');

    // 6b. script errors: same line numbers as the file, a banner that says where, and a way there
    const errs = await pg.evaluate(async (page) => {
        const out = {}; const H = window.__exports.__test.html;
        out.sameLines = H.previewDocument(page, { 'a/b.png': 'x' }, 120).split('\n').length === page.split('\n').length;
        const lines = page.split('\n'); const at = lines.findIndex((l) => l.includes('var CONFIG')); // 0-based
        lines.splice(at + 1, 0, '  var broken = { photo: 1 missing: 2 };');
        const bad = lines.join('\n'); out.badLine = at + 2;
        const v = window.__v; v.setLayout('preview'); v.setViewData(bad, true);
        await new Promise((r) => setTimeout(r, 600));
        const box = v.contentEl.querySelector('.vm-html-error'); out.banner = box && box.textContent;
        out.count = v.contentEl.querySelectorAll('.vm-html-error').length;
        const go = box && [...box.querySelectorAll('button')].find((b) => /Go to line/.test(b.textContent));
        go && go.click();
        out.layoutAfterGo = v.currentLayout;
        const sel = v.editor.state.selection.main; out.selected = v.editor.state.sliceDoc(sel.from, sel.to);
        // fixing it clears the banner on the next refresh
        v.setViewData(page, false); await new Promise((r) => setTimeout(r, 600));
        out.afterFix = v.contentEl.querySelectorAll('.vm-html-error').length;
        // a script that throws while running (not a typo) is reported too
        v.setViewData(page.replace('var app = document.getElementById', 'nosuchFunction(); var app = document.getElementById'), false); await new Promise((r) => setTimeout(r, 600));
        out.runtime = (v.contentEl.querySelector('.vm-html-error') || {}).textContent || '';
        v.setViewData(page, false); await new Promise((r) => setTimeout(r, 300));
        return out;
    }, PAGE);
    ok(errs.sameLines, 'the preview helper adds no lines, so error lines match the file');
    ok(errs.banner && errs.banner.startsWith('Script error on line ' + errs.badLine + ':') && /Go to line/.test(errs.banner), 'banner names the right line (' + errs.badLine + '): ' + errs.banner);
    ok(errs.count === 1, 'one banner, not one per follow-on error');
    ok(errs.layoutAfterGo === 'split' && errs.selected === '  var broken = { photo: 1 missing: 2 };', 'Go to line opens the editor on that line: ' + JSON.stringify([errs.layoutAfterGo, errs.selected]));
    ok(errs.afterFix === 0, 'fixed: the banner goes away');
    ok(/Script error on line \d+: .*nosuchFunction/.test(errs.runtime), 'errors while the script runs are reported too: ' + errs.runtime);
    console.log('6b. script errors: banner with the file\'s line number, Go to line, cleared when fixed, runtime errors too');

    // 6. the feature: .html and .htm, New HTML file, another plugin already owning .html, settings
    const feat = await pg.evaluate(async (c) => {
        const out = {};
        let p = window.__make(c, null); await p.onload();
        out.ext = JSON.stringify(p.extensions && p.extensions['vm-html-editor']);
        const made = []; p.app.vault.create = async (path, text) => { made.push([path, text.slice(0, 15)]); return { path }; };
        const taken = new Set(['Untitled.html']); p.app.vault.getAbstractFileByPath = (x) => (taken.has(x) ? { path: x } : null);
        const opened = []; p.app.workspace.getLeaf = () => ({ openFile: async (f) => opened.push(f.path) });
        await p.cmds['new-html-file'].callback();
        out.made = JSON.stringify(made); out.opened = JSON.stringify(opened);
        window.__extensionsTaken = true; window.__notices.length = 0;
        p = window.__make(c, null); await p.onload(); window.__extensionsTaken = false;
        out.takenNotice = window.__notices.some((n) => /another plugin already opens \.html files/.test(n));
        p = window.__make(c, { features: { htmlEditor: false } }); await p.onload();
        out.off = [!!(p.views && p.views['vm-html-editor']), !!p.cmds['new-html-file']];
        const m = window.__exports.__test.mergeSettings;
        out.defaults = JSON.stringify(m(null).htmlEditor);
        out.bad = JSON.stringify(m({ htmlEditor: { layout: 'huge', runScripts: 'yes', assetFolders: { 'a.html': 'Site', 'b.html': 5, 'c.html': '' } } }).htmlEditor);
        return out;
    }, code);
    ok(feat.ext === '["html","htm"]', '.html and .htm open in the editor: ' + feat.ext);
    ok(feat.made === '[["Untitled 1.html","<!DOCTYPE html>"]]' && feat.opened === '["Untitled 1.html"]', 'New HTML file: a starter page with a free name, opened: ' + feat.made);
    ok(feat.takenNotice, 'another plugin owning .html: says so instead of failing');
    ok(JSON.stringify(feat.off) === '[false,false]', 'feature off: nothing registered');
    ok(feat.defaults === '{"layout":"split","runScripts":true,"assetFolders":{}}', 'defaults: ' + feat.defaults);
    ok(feat.bad === '{"layout":"split","runScripts":true,"assetFolders":{"a.html":"Site"}}', 'bad saved values dropped: ' + feat.bad);
    console.log('6. feature: .html/.htm, New HTML file, clash with another plugin, switch, saved settings');

    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nHTML EDITOR TESTS PASS');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
