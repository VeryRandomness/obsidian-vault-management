const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
const { releaseWeb } = require('./helpers.cjs');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };
(async () => {
    const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 800, height: 700 } });
    pg.on('pageerror', (e) => { failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body></body>'); await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    const code = fs.readFileSync(R + '/main.js', 'utf8');
    const boot = (data) => pg.evaluate(async ([c, d]) => { const p = window.__make(c, d); await p.onload(); return { cmds: Object.keys(p.cmds).sort(), procs: p.processors.length, exts: p.exts.length, ribbon: p.ribbon.map((r) => r[0]), tab: !!p.tab, hotkey: p.cmds['cycle-bullet'] && p.cmds['cycle-bullet'].hotkeys, settings: p.settings, layout: p.layout.length }; }, [code, data]);

    // 1. everything on by default
    let r = await boot(null);
    ok(JSON.stringify(r.cmds) === JSON.stringify(['bulk-edit-properties', 'check-for-update', 'check-theme-update', 'copy-color-at-cursor', 'cycle-bullet', 'export-current-note-to-pdf', 'lines-to-links', 'new-html-file', 'new-note-from-template', 'undo-last-bulk-edit']), 'commands: ' + r.cmds);
    ok(r.procs === 2 && r.exts === 2 && JSON.stringify(r.ribbon) === '["list-checks","file-output"]' && r.tab, `processors ${r.procs}, extensions ${r.exts}, ribbon ${r.ribbon}, tab ${r.tab}`);
    ok(JSON.stringify(r.hotkey) === '[{"modifiers":["Shift","Alt"],"key":"8"}]', 'Shift+Alt+8 hotkey kept');
    ok(r.layout === 6, 'startup tasks registered (PDF library check, text covers x2, new-note button, themes, self-update): ' + r.layout);
    ok(r.settings.themes.length === 1 && r.settings.themes[0].repo === 'VeryRandomness/obsidian-nordic-days-and-nights', 'default theme list');
    console.log('1. all features on by default: ' + r.cmds.length + ' commands');

    // 2. every feature off: only the updater remains
    r = await boot({ features: { bullets: false, colorInline: false, bulkProperties: false, lineLinks: false, mdToPdf: false, textCovers: false, newNoteButton: false, htmlEditor: false, themeUpdates: false } });
    ok(JSON.stringify(r.cmds) === '["check-for-update"]' && r.procs === 0 && r.exts === 0 && r.ribbon.length === 0, 'all off: ' + JSON.stringify(r));
    r = await boot({ features: { bullets: false } });
    ok(!r.cmds.includes('cycle-bullet') && r.cmds.includes('copy-color-at-cursor') && r.cmds.includes('bulk-edit-properties') && r.procs === 1, 'only bullets off: ' + r.cmds);
    console.log('2. feature switches: ok');

    // 3. settings: new layout, and the files of the plugins this replaces
    const m = (d) => pg.evaluate((x) => window.__exports.__test.mergeSettings(x), d);
    let s = await m(null); ok(s.color.namedColors && s.color.codeBlocks && s.color.copyOnClick && s.color.inlineStyle === 'swatch' && !('badgeMode' in s.color), 'defaults: ' + JSON.stringify(s.color));
    s = await m({ badgeMode: true }); ok(s.color.inlineStyle === 'badge' && s.color.namedColors === true && !('badgeMode' in s.color), 'old Color Inline Plus data.json (badgeMode true) -> badge: ' + JSON.stringify(s.color));
    s = await m({ badgeMode: false }); ok(s.color.inlineStyle === 'swatch', 'old badgeMode false -> swatch');
    s = await m({ color: { badgeMode: true, namedColors: true } }); ok(s.color.inlineStyle === 'badge' && !('badgeMode' in s.color), 'badgeMode inside the color section (our own earlier data.json) -> badge: ' + JSON.stringify(s.color));
    s = await m({ color: { inlineStyle: 'block', badgeMode: true } }); ok(s.color.inlineStyle === 'block', 'a saved inlineStyle wins over the old flag');
    s = await m({ color: { inlineStyle: 'huge' } }); ok(s.color.inlineStyle === 'swatch', 'an unknown style falls back to swatch');
    s = await m({ themes: [{ repo: 'a/b', branch: '', enabled: true, name: 'X', version: '1' }] }); ok(s.themes.length === 1 && s.themes[0].repo === 'a/b' && s.features.bullets, 'old Theme Auto-Update data.json keeps the theme list');
    s = await m({ color: { inlineStyle: 'badge', namedColors: false }, features: { bulkProperties: false } }); ok(s.color.inlineStyle === 'badge' && !s.color.namedColors && s.color.codeBlocks && !s.features.bulkProperties && s.features.bullets, 'new layout merges with defaults');
    s = await m({ themes: 'nonsense', color: null }); ok(Array.isArray(s.themes) && s.themes.length === 1, 'bad values fall back');
    console.log('3. settings migration: ok');

    // 4. bullets: Live Preview (real CodeMirror) + inline color together, and Reading view
    await boot(null);
    const doc = ['- plain', '+ plus', '- |-> arrow with `#ff8800` code', '- => moved', '- ? question', '  - |-> nested', '- [ ] ? task', '```js', '- |-> in code', '```', '- |->no space', '* star'].join('\n');
    const lp = await pg.evaluate(async (d) => { const v = await window.__lp(d, 0); return [...v.dom.querySelectorAll('.cm-line')].map((l) => [l.className.replace(/cm-line|cm-active/g, '').trim(), l.textContent, l.querySelectorAll('.s-color-inline-mark').length]); }, doc);
    const want = [['', '- plain'], ['bv-plus', '+ plus'], ['bv-arrow', '- arrow with `#ff8800` code'], ['bv-moved', '- moved'], ['bv-question', '- question'], ['bv-arrow', '  - nested'], ['', '- [ ] ? task'], ['', '```js'], ['', '- |-> in code'], ['', '```'], ['', '- |->no space'], ['', '* star']];
    want.forEach(([cls, text], i) => ok(lp[i] && lp[i][0] === cls && lp[i][1] === text, `LP line ${i}: expected ${JSON.stringify([cls, text])} got ${JSON.stringify(lp[i])}`));
    ok(lp[2][2] === 1, 'inline color mark on the arrow bullet line too');
    const rd = await pg.evaluate(() => {
        const el = document.createElement('div'); el.innerHTML = '<ul><li data-line="0">plain</li><li data-line="1">plus</li><li data-line="2">|-&gt; arrow <code>#0a8</code></li><li data-line="3">=&gt; moved</li><li data-line="4">? question</li><li data-line="5">* star</li></ul>';
        window.__run(el, '- plain\n+ plus\n- |-> arrow `#0a8`\n- => moved\n- ? question\n* star');
        return [[...el.querySelectorAll('li')].map((l) => l.className + '|' + l.firstChild.textContent.slice(0, 7)), el.querySelectorAll('code.s-color-inline').length];
    });
    ok(JSON.stringify(rd[0]) === '["|plain","bv-plus|plus","bv-arrow|arrow ","bv-moved|moved","bv-question|questio","|* star"]', 'Reading view bullets: ' + JSON.stringify(rd[0]));
    ok(rd[1] === 1, 'Reading view: color swatch alongside bullets');
    console.log('4. bullets (Live Preview + Reading view) next to color swatches: ok');

    // 5. bullet cycling + hotkey command, and the Bulk Properties logic
    const cyc = await pg.evaluate(() => {
        const t = window.__exports.__test.bullets; const lines = ['- hi']; let cursor = { line: 0, ch: 4 }; const seen = [];
        const ed = { getLine: (n) => lines[n], listSelections: () => [{ anchor: cursor, head: cursor }], getCursor: () => cursor, somethingSelected: () => false,
            replaceRange: (txt, f, to) => { lines[f.line] = lines[f.line].slice(0, f.ch) + txt + lines[f.line].slice(to.ch); }, setCursor: (p) => { cursor = p; } };
        for (let i = 0; i < 6; i++) { window.__p.cmds['cycle-bullet'].editorCallback(ed); seen.push(lines[0]); }
        return seen;
    });
    ok(JSON.stringify(cyc) === '["+ hi","- |-> hi","- => hi","- ? hi","- hi","+ hi"]', 'cycle: ' + JSON.stringify(cyc));
    const bulk = await pg.evaluate(() => {
        const t = window.__exports.__test.bulk; const S = (a) => new Set(a); const out = [];
        out.push(t.changed(['Inprogress', 'Books'], S(['Inprogress']), 'change', 'In Progress'));
        out.push(t.changed(['Recipe', 'Clipping'], S(['Clipping']), 'remove', ''));
        out.push(t.changed(7, S(['7']), 'change', '8'));
        const fm = { title: 'x', category: 'Fiction', publisher: 'p', categories: ['Fiction', 'Drama'] }; const conflict = t.rename(fm, 'category', 'Categories'); out.push([Object.keys(fm), conflict]);
        const fm2 = { a: 1, stars: '8/10', Rating: '9' }; out.push([t.rename(fm2, 'stars', 'Rating'), fm2]);
        return out;
    });
    ok(JSON.stringify(bulk) === JSON.stringify([['In Progress', 'Books'], ['Recipe'], 8, [['title', 'Categories', 'publisher', 'categories'], false], [true, { a: 1, Rating: '9' }]]), 'bulk logic: ' + JSON.stringify(bulk));
    const links = await pg.evaluate(() => {
        const t = window.__exports.__test.lineLinks;
        const lines = ['Apples', '  - Pears ', '1. Plums', '- [ ] Figs', '> Kiwi', '## Limes', '', 'Has [[a link]] already', 'Mango'];
        // two selections: "Apples" to "Kiwi", and "ng" inside "Mango"; then a bare cursor on "## Limes"
        let sels = [{ anchor: { line: 8, ch: 2 }, head: { line: 8, ch: 4 } }, { anchor: { line: 4, ch: 6 }, head: { line: 0, ch: 0 } }]; let cursor = { line: 5, ch: 1 };
        const pos = (p) => lines.slice(0, p.line).join('\n').length + (p.line ? 1 : 0) + p.ch;
        const ed = { somethingSelected: () => sels.length > 0, listSelections: () => sels, getCursor: () => cursor, getLine: (n) => lines[n],
            getRange: (f, to) => lines.join('\n').slice(pos(f), pos(to)),
            replaceRange: (txt, f, to) => { const all = lines.join('\n'); lines.splice(0, lines.length, ...(all.slice(0, pos(f)) + txt + all.slice(pos(to))).split('\n')); } };
        window.__p.cmds['lines-to-links'].editorCallback(ed);
        sels = []; window.__p.cmds['lines-to-links'].editorCallback(ed);
        return [lines, t.linkLine('[[Done]]'), t.linkLine('   ')];
    });
    ok(JSON.stringify(links) === JSON.stringify([['[[Apples]]', '  - [[Pears]]', '1. [[Plums]]', '- [ ] [[Figs]]', '> [[Kiwi]]', '## [[Limes]]', '', 'Has [[a link]] already', 'Ma[[ng]]o'], '[[Done]]', '   ']), 'lines to links: ' + JSON.stringify(links));
    console.log('5. bullet cycling, bulk property logic, lines to links: ok');

    // 6. theme updates
    const th = await pg.evaluate(async (c) => {
        const out = {}; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const p = window.__make(c, { themes: [{ repo: 'o/bad', branch: '', enabled: true }, { repo: 'o/off', branch: '', enabled: false }, { repo: 'o/good', branch: '', enabled: true }, { repo: 'o/evil', branch: '', enabled: true }] }); await p.onload();
        window.__web = { 'o/good:theme.css': 'body{}', 'o/good:manifest.json': JSON.stringify({ name: 'Good', version: '1.0.0' }), 'o/evil:theme.css': 'x', 'o/evil:manifest.json': JSON.stringify({ name: '../etc', version: '1' }) };
        window.__notices.length = 0; await p.themes.checkAll(false);
        out.afterFirst = Object.keys(window.__files).sort(); out.n1 = [...window.__notices];
        out.saved = p.saved.themes.map((t) => [t.repo, t.name, t.version]);
        window.__notices.length = 0; const before = JSON.stringify(window.__files); await p.themes.checkAll(true); out.upToDate = JSON.stringify(window.__files) === before; out.n2 = [...window.__notices];
        window.__web['o/good:theme.css'] = 'body{color:red}'; window.__web['o/good:manifest.json'] = JSON.stringify({ name: 'Good', version: '1.1.0' }); window.__notices.length = 0;
        window.__reloaded = null; window.__p.app.customCss.theme = 'Good'; await p.themes.checkAll(false); out.updated = window.__files['.obsidian/themes/Good/theme.css']; out.n3 = [...window.__notices]; out.reloaded = window.__reloaded;
        const pl = window.__exports.__test.themes.parseLink; out.links = ['owner/repo', 'https://github.com/o/r', 'https://github.com/o/r/tree/dev', 'https://github.com/o/r.git', 'nope', ''].map((x) => pl(x));
        return out;
    }, code);
    ok(JSON.stringify(th.afterFirst) === '[".obsidian/themes/Good/manifest.json",".obsidian/themes/Good/theme.css"]', 'bad theme did not stop the good one; evil name refused: ' + JSON.stringify(th.afterFirst));
    ok(th.n1.some((n) => /Good installed 1\.0\.0/.test(n)), 'install notice: ' + JSON.stringify(th.n1));
    ok(th.saved.some((t) => t[0] === 'o/good' && t[1] === 'Good' && t[2] === '1.0.0'), 'saved name/version: ' + JSON.stringify(th.saved));
    ok(th.upToDate && th.n2.some((n) => /up to date/.test(n)), 'second check: up to date, nothing rewritten');
    ok(th.updated === 'body{color:red}' && th.reloaded === 'Good' && th.n3.some((n) => /updated to 1\.1\.0/.test(n)), 'update installed and theme reloaded');
    ok(JSON.stringify(th.links) === '[{"repo":"owner/repo","branch":""},{"repo":"o/r","branch":""},{"repo":"o/r","branch":"dev"},{"repo":"o/r","branch":""},null,null]', 'parseLink: ' + JSON.stringify(th.links));
    console.log('6. theme updates: install, up to date, update + reload, failures isolated, bad names refused');

    // 7. self-update from the latest release
    const up = await pg.evaluate(async ([c, sets]) => {
        const p = window.__make(c, null); await p.onload(); const out = {}; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const run = async (web) => { window.__web = web; window.__notices.length = 0; window.__writes.length = 0; for (const k of Object.keys(window.__files)) delete window.__files[k]; window.__files['.obsidian/plugins/vr-vault-management/manifest.json'] = JSON.stringify({ id: 'vr-vault-management', version: '1.0.0' }); window.__writes.length = 0; await p.cmds['check-for-update'].callback(); await sleep(650); return { files: Object.keys(window.__files).sort(), writes: [...window.__writes].map((w) => w.split('/').pop()), n: [...window.__notices] }; };
        out.same = await run(sets.same); out.newer = await run(sets.newer); out.other = await run(sets.other); out.offline = await run({ offline: true });
        window.__web = { offline: true }; window.__notices.length = 0; for (const f of p.layout) await f(); out.startupOffline = [...window.__notices];
        return out;
    }, [code, (() => {
        const R = 'VeryRandomness/obsidian-vault-management'; const man = (o) => JSON.stringify(Object.assign({ id: 'vr-vault-management', version: '1.0.0' }, o));
        return { same: releaseWeb(R, '1.0.0', { 'manifest.json': man({}), 'main.js': 'X' }),
            newer: releaseWeb(R, '1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': 'NEW', 'styles.css': 'CSS' }),
            other: releaseWeb(R, '9.0.0', { 'manifest.json': man({ id: 'writing-mode', version: '9.0.0' }), 'main.js': 'EVIL' }) };
    })()]);
    ok(up.same.files.length === 1 && up.same.n.some((n) => /up to date/.test(n)), 'same version: nothing written');
    ok(up.newer.files.length === 3 && up.newer.n.some((n) => /updated to 1\.0\.1/.test(n)), 'newer release installed: ' + JSON.stringify(up.newer));
    ok(up.newer.writes[up.newer.writes.length - 1] === 'manifest.json', 'the manifest is written last: ' + JSON.stringify(up.newer.writes));
    const rl = await pg.evaluate(() => window.__reload); ok(JSON.stringify(rl) === '["d vr-vault-management","e vr-vault-management"]', 'plugin reloaded after the update: ' + JSON.stringify(rl));
    ok(up.other.files.length === 1 && up.other.n.some((n) => /different plugin id/.test(n)), 'other plugin id refused: ' + JSON.stringify(up.other));
    ok(up.offline.n.some((n) => /Update check failed/.test(n)) && up.startupOffline.length === 0, 'offline: manual says so, startup silent: ' + JSON.stringify(up.startupOffline));
    console.log('7. self-update from the latest release: same, newer (manifest last), other id refused, offline: ok');

    // 8. settings page
    const tab = await pg.evaluate(async (c) => {
        const p = window.__make(c, { badgeMode: true }); await p.onload(); window.__updated = 0; p.tab.display();
        const S = window.__settings; const out = {};
        out.headings = S.filter((s) => s.heading).map((s) => s.name);
        const find = (name) => S.find((s) => s.name === name);
        const dd = find('Inline color style').controls[0][1]; out.styleNow = dd.value; out.styleOptions = dd.options.map((o) => o[0]); out.classesBefore = ['s-color-inline-badge', 's-color-inline-block'].map((c) => document.body.classList.contains(c));
        await dd.cb('block'); out.styleSaved = p.saved.color.inlineStyle; out.classesBlock = ['s-color-inline-badge', 's-color-inline-block'].map((c) => document.body.classList.contains(c));
        await dd.cb('swatch'); out.classesSwatch = ['s-color-inline-badge', 's-color-inline-block'].map((c) => document.body.classList.contains(c));
        await dd.cb('badge'); out.classesBadge = ['s-color-inline-badge', 's-color-inline-block'].map((c) => document.body.classList.contains(c)); out.noBadgeKey = !('badgeMode' in p.saved.color);
        // switch a feature off, a color setting off
        await find('Bullet variants').controls[0][1].cb(false); out.featureSaved = p.saved.features.bullets;
        await find('Named colors').controls[0][1].cb(false); out.colorSaved = p.saved.color.namedColors; out.refreshed = window.__updated;
        // themes section: one row, then try adding a bad link
        out.themeRows = S.filter((s) => /Nordic|obsidian-nordic/.test(s.name + s.desc)).length;
        const add = S.find((s) => s.name === 'Add a theme'); add.controls[0][1].cb('not a link'); window.__notices.length = 0; await add.controls[1][1].cb(); out.badLink = [...window.__notices];
        out.version = S.some((s) => /Vault Management 1\.0\.0/.test(s.name));
        window.__p.themes = null; window.__settings.length = 0; p.tab.display(); out.themesOff = window.__settings.some((s) => /Turned off under Features/.test(s.desc));
        return out;
    }, code);
    const MAIN = ['Features', 'Color swatches', 'Bullet variants', 'Bulk properties', 'MD to PDF export', 'Text covers', 'New note from template', 'HTML editor', 'Theme updates', 'Plugin updates'];
    ok(JSON.stringify(tab.headings.filter((h) => MAIN.includes(h))) === JSON.stringify(MAIN), 'main sections in order: ' + JSON.stringify(tab.headings));
    ok(['How to see text covers', 'Content', 'Appearance', 'Remote covers', 'Cache', 'Debug'].every((h) => tab.headings.includes(h)), 'text cover settings sections shown: ' + JSON.stringify(tab.headings));
    ok(tab.styleNow === 'badge' && JSON.stringify(tab.styleOptions) === '["swatch","badge","block"]', 'old badge setting shows as Colored badge: ' + JSON.stringify([tab.styleNow, tab.styleOptions]));
    ok(JSON.stringify(tab.classesBefore) === '[true,false]' && JSON.stringify(tab.classesBlock) === '[false,true]' && JSON.stringify(tab.classesSwatch) === '[false,false]' && JSON.stringify(tab.classesBadge) === '[true,false]', 'body classes follow the style: ' + JSON.stringify([tab.classesBefore, tab.classesBlock, tab.classesSwatch, tab.classesBadge]));
    ok(tab.styleSaved === 'block' && tab.noBadgeKey, 'style saved, no old badgeMode key written');
    ok(tab.featureSaved === false && tab.colorSaved === false && tab.refreshed >= 1, 'toggles save and refresh the views: ' + JSON.stringify([tab.featureSaved, tab.colorSaved, tab.refreshed]));
    ok(tab.themeRows >= 1, 'theme list rendered');
    ok(tab.badLink.some((n) => /doesn't look like a GitHub repo link/.test(n)), 'bad theme link refused: ' + JSON.stringify(tab.badLink));
    ok(tab.version && tab.themesOff, 'version line shown; themes off message');
    console.log('8. settings page: sections, toggles save + refresh, theme list, bad link: ok');

    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nMERGED-PLUGIN TESTS PASS');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
