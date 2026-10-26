// New note from template: reading a base's filters, both template engines, locking
// templates to a base, and the toolbar button (with its fallback).
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };
const LIBRARY = fs.readFileSync(path.join(__dirname, 'fixtures', '03 - Library.base'), 'utf8');
const COMMAND = fs.readFileSync(path.join(__dirname, 'fixtures', '01 - Command Center.base'), 'utf8');

(async () => {
    const b = await chromium.launch(); const pg = await b.newPage();
    pg.on('pageerror', (e) => { failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body></body>'); await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    const code = fs.readFileSync(R + '/main.js', 'utf8');

    // A vault with templates in "0 Media/Templates", two bases, and either engine.
    // window.__vm holds what happened: notes created, files opened, Templater calls.
    await pg.evaluate(([LIBRARY, COMMAND]) => {
        window.__setup = async (code, { engine = 'core', data = null } = {}) => {
            const p = window.__make(code, data);
            const vm = window.__vm = { created: [], opened: [], templaterCalls: [] };
            const tf = (path) => ({ path, extension: path.split('.').pop(), basename: path.split('/').pop().replace(/\.[^.]+$/, ''), name: path.split('/').pop() });
            const T = '0 Media/Templates/';
            const templates = {
                [T + 'Recipe.md']: '---\nDesignation: Recipe\ncover:\n---\nIngredients for {{title}}\n',
                [T + 'Quotes.md']: '---\nDesignation:\ntags:\n---\n> quote\n',
                [T + 'School.md']: 'Made {{date}} at {{time}}, due {{date:DD/MM}}\n',
            };
            const bases = { 'Library.base': LIBRARY, 'Command.base': COMMAND };
            window.__notes = {};
            const fmOf = (text) => { const m = /^---\n([\s\S]*?)\n---/.exec(text); return m ? (window.__yaml(m[1]) || {}) : {}; };
            const app = p.app;
            app.vault.getMarkdownFiles = () => [...Object.keys(templates), 'Other note.md', ...Object.keys(window.__notes)].map(tf);
            app.vault.read = async (f) => templates[f.path];
            app.vault.cachedRead = async (f) => bases[f.path] ?? '';
            app.vault.getRoot = () => ({ path: '/', isRoot: true });
            app.vault.getAbstractFileByPath = (p) => (window.__notes[p] || p === 'Other note.md' ? tf(p) : null);
            app.vault.create = async (path, content) => { vm.created.push({ path, content }); window.__notes[path] = { fm: fmOf(content), content }; return tf(path); };
            app.workspace.getLeaf = () => ({ openFile: async (f) => { vm.opened.push(f.path); } });
            app.internalPlugins = { getPluginById: (id) => (id === 'templates' && engine === 'core' ? { enabled: true, instance: { options: { folder: '0 Media/Templates', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' } } } : { enabled: false }) };
            const templater = { settings: { templates_folder: '0 Media/Templates' }, templater: { create_new_note_from_template: async (tpl, folder, name, open) => {
                vm.templaterCalls.push({ tpl: tpl.path, folder: folder.path, name, open });
                const path = name + '.md'; window.__notes[path] = { fm: fmOf(templates[tpl.path]), content: templates[tpl.path] }; return tf(path);
            } } };
            app.plugins.enabledPlugins = new Set(engine === 'templater' ? ['templater-obsidian'] : []);
            app.plugins.plugins = engine === 'templater' ? { 'templater-obsidian': templater } : {};
            window.moment = () => ({ format: (f) => 'NOW<' + f + '>' });
            // a Bases tab showing a base and one of its views, with the toolbar Obsidian draws
            window.__leaf = (basePath, viewName, toolbar = true) => {
                const containerEl = document.createElement('div');
                // the same nesting Obsidian 1.13 builds: .bases-header > .bases-toolbar > items, "New" last
                if (toolbar) containerEl.innerHTML = '<div class="bases-header"><div class="bases-toolbar"><div class="bases-toolbar-item bases-toolbar-views-menu"></div><div class="bases-toolbar-item bases-toolbar-results-menu"></div><div class="bases-toolbar-item bases-toolbar-new-item-menu"></div></div></div><div class="bases-search-row"></div><div class="bases-view"></div>';
                else containerEl.innerHTML = '<div class="bases-view"></div>';
                document.body.appendChild(containerEl);
                return { view: { containerEl, file: tf(basePath), getViewType: () => 'bases', getState: () => ({ viewName }) } };
            };
            await p.onload();
            return p;
        };
    }, [LIBRARY, COMMAND]);
    await pg.evaluate(() => { window.__yaml = (s) => { const out = {}; let key = null; for (const line of s.split('\n')) { const m = /^([^\s:][^:]*):\s*(.*)$/.exec(line); if (m) { key = m[1]; out[key] = m[2] === '' ? null : m[2]; } else if (key && /^\s+-\s+/.test(line)) { if (!Array.isArray(out[key])) out[key] = []; out[key].push(line.replace(/^\s+-\s+/, '')); } } return out; }; });
    // the modal's controls
    const modal = () => pg.evaluate(() => { const m = window.__modal; if (!m) return null; return { title: m.titleEl.textContent, rows: [...m.contentEl.querySelectorAll('.vm-new-note-row')].map((r) => r.querySelector('.vm-new-note-name').textContent + (r.querySelector('.is-locked') ? ' [locked]' : '')), text: m.contentEl.textContent, buttons: [...m.contentEl.querySelectorAll('button')].map((x) => x.textContent || x.getAttribute('aria-label')) }; });
    const click = (sel, i = 0) => pg.evaluate(([sel, i]) => { const el = window.__modal.contentEl.querySelectorAll(sel)[i]; if (!el) throw new Error('nothing matches ' + sel); el.click(); }, [sel, i]);
    const clickText = (text) => pg.evaluate((text) => { const el = [...window.__modal.contentEl.querySelectorAll('button')].find((x) => x.textContent === text); if (!el) throw new Error('no button ' + text); el.click(); }, text);
    const typeName = (name) => pg.evaluate((name) => { const i = window.__modal.contentEl.querySelector('input'); i.value = name; }, name);
    const settle = () => pg.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    const t = (fn, ...a) => pg.evaluate(([fn, a]) => window.__exports.__test.newNote[fn](...a), [fn, a]);

    await pg.evaluate((c) => { window.__make(c, null); }, code);

    // 1. reading filters
    const pf = async (s) => JSON.stringify(await t('parseFilter', s));
    ok(await pf('Designation == ["Books"]') === '[{"key":"Designation","op":"eq","value":["Books"]}]', 'eq list: ' + await pf('Designation == ["Books"]'));
    ok(await pf('Designation.contains("Restaurant Rating")') === '[{"key":"Designation","op":"contains","value":"Restaurant Rating"}]', 'contains');
    ok(await pf('note.Rating == 5') === '[{"key":"Rating","op":"eq","value":5}]', 'note. prefix and numbers');
    ok(await pf('note["Date Created"] == "2026"') === '[{"key":"Date Created","op":"eq","value":"2026"}]', 'property names with spaces');
    ok(await pf('file.hasTag("book", "#read")') === '[{"key":"tags","op":"contains","value":"book"},{"key":"tags","op":"contains","value":"read"}]', 'tags: ' + await pf('file.hasTag("book", "#read")'));
    for (const s of ['!file.inFolder("0 Media/Templates")', 'file.ext != "base"', 'file.folder != "x"', 'file.name == "x"', 'formula.x == 1', 'Rating > 5', 'Designation == someFunction()', '', 'junk']) ok(await pf(s) === '[]', 'ignored: ' + s);
    const br = (base, view) => pg.evaluate(([base, view]) => JSON.stringify(window.__exports.__test.newNote.baseRequirements(base, view)), [base, view]);
    const lib = { views: [{ name: 'Table', filters: { and: ['Designation == ["Books"]', '!file.inFolder("0 Media/Templates")'] } }] };
    const cmd = { views: [{ name: 'Master', filters: { and: ['file.ext != "base"'] } }, { name: 'In Progress', filters: { and: ['Designation == ["In Progress"]'] } }, { name: 'Fleeting', filters: { and: ['Designation == ["Fleeting Note"]', 'file.folder != "x"'] } }] };
    ok(await br(lib, 'Table') === '[{"key":"Designation","op":"eq","value":["Books"]}]', 'Library: Designation Books');
    ok(await br(cmd, 'Master') === '[]' && await br(cmd, 'In Progress') === '[{"key":"Designation","op":"eq","value":["In Progress"]}]' && await br(cmd, 'Fleeting') === '[{"key":"Designation","op":"eq","value":["Fleeting Note"]}]', 'Command Center: per view');
    ok(await br(cmd, undefined) === '[]', 'no view name: the first view');
    ok(await br({ filters: { and: ['note.Status == "Open"'] }, views: [{ name: 'A', filters: { or: ['Designation == ["Verses"]'] } }] }, 'A') === '[{"key":"Status","op":"eq","value":"Open"},{"key":"Designation","op":"eq","value":["Verses"]}]', 'base filters plus a single-branch or');
    ok(await br({ views: [{ name: 'A', filters: { or: ['A == 1', 'B == 2'] } }] }, 'A') === '[]', 'an or with two branches asks nothing');
    ok(await br({ views: [{ name: 'A', filters: { not: ['A == 1'] } }] }, 'A') === '[]', 'not asks nothing');
    ok(await br({ views: [{ name: 'A', filters: { and: [{ and: ['A == 1'] }, 'file.hasTag("x")'] } }] }, 'A') === '[{"key":"A","op":"eq","value":1},{"key":"tags","op":"contains","value":"x"}]', 'nested and');
    console.log('1. filters: eq, contains, tags, names with spaces; file/formula/not/or-of-two ignored; per view');

    // 2. filling a note in
    const ap = (fm, reqs) => pg.evaluate(([fm, reqs]) => { const c = window.__exports.__test.newNote.applyRequirements(fm, reqs); return JSON.stringify([fm, c]); }, [fm, reqs]);
    const eqBooks = [{ key: 'Designation', op: 'eq', value: ['Books'] }];
    ok(await ap({ Designation: null }, eqBooks) === '[{"Designation":["Books"]},[]]', 'empty -> set');
    ok(await ap({}, eqBooks) === '[{"Designation":["Books"]},[]]', 'missing -> set');
    ok(await ap({ Designation: ['Books'] }, eqBooks) === '[{"Designation":["Books"]},[]]', 'already right -> unchanged');
    ok(await ap({ Designation: 'Recipe' }, eqBooks) === '[{"Designation":"Recipe"},["Designation"]]', 'template value kept, reported');
    const has = (v) => [{ key: 'tags', op: 'contains', value: v }];
    ok(await ap({ tags: ['a'] }, has('b')) === '[{"tags":["a","b"]},[]]' && await ap({ tags: null }, has('b')) === '[{"tags":["b"]},[]]' && await ap({ tags: ['b'] }, has('b')) === '[{"tags":["b"]},[]]', 'contains adds once');
    ok(await ap({ tags: 'other' }, has('b')) === '[{"tags":"other"},["tags"]]', 'contains on a different single value is reported');
    console.log('2. filling in properties: set when empty, add to lists, never overwrite');

    // 3. core Templates fill-in
    const filled2 = await pg.evaluate(() => window.__exports.__test.newNote.fillCoreTemplate('A {{title}} {{ date }} {{time}} {{date:DD/MM}}', 'My Note', 'YYYY', 'HH', { format: (f) => '<' + f + '>' }));
    ok(filled2 === 'A My Note <YYYY> <HH> <DD/MM>', 'title, date, time, custom formats: ' + filled2);
    console.log('3. core template placeholders');

    // 4. core Templates, end to end from a Library tab
    let p = await pg.evaluate(async (c) => { const p = await window.__setup(c, { engine: 'core' }); window.__lib = window.__leaf('Library.base', 'Table'); await p.newNote.open(window.__lib); return true; }, code);
    let m = await modal();
    ok(m && /New note · Library · Table/.test(m.title), 'title names the base and view: ' + (m && m.title));
    ok(m && JSON.stringify(m.rows) === '["Quotes","Recipe","School"]', 'all templates in the template folder, nothing else: ' + JSON.stringify(m && m.rows));
    ok(m && /Adds Designation: Books/.test(m.text), 'shows what it will add');
    await click('.vm-new-note-row', 2); m = await modal();
    ok(/Template: School/.test(m.text) && /Created in the vault root/.test(m.text), 'name step');
    await typeName('Essay: draft 1'); await clickText('Create'); await settle();
    let vm = await pg.evaluate(() => JSON.parse(JSON.stringify(window.__vm)));
    ok(vm.created.length === 1 && vm.created[0].path === 'Essay draft 1.md', 'created in the root, with the colon taken out of the name: ' + JSON.stringify(vm.created.map((x) => x.path)));
    ok(/Made NOW<YYYY-MM-DD> at NOW<HH:mm>, due NOW<DD\/MM>/.test(vm.created[0].content), 'placeholders filled: ' + vm.created[0].content);
    ok(JSON.stringify(await pg.evaluate(() => window.__notes['Essay draft 1.md'].fm)) === '{"Designation":["Books"]}', 'Library properties added');
    ok(JSON.stringify(vm.opened) === '["Essay draft 1.md"]' && !(await modal()), 'opened in a new tab, picker closed');
    // a name that is taken gets a number
    await pg.evaluate(async () => { await window.__p.newNote.open(window.__lib); });
    await click('.vm-new-note-row', 2); await typeName('Other note'); await clickText('Create'); await settle();
    vm = await pg.evaluate(() => JSON.parse(JSON.stringify(window.__vm)));
    ok(vm.created[1].path === 'Other note 1.md', 'taken name gets a number: ' + vm.created[1].path);
    console.log('4. core Templates: picker, name, root folder, placeholders, base properties, opens the note');

    // 5. template conflicts with the view: kept, and you are told
    await pg.evaluate(async () => { window.__notices.length = 0; await window.__p.newNote.open(window.__lib); });
    await click('.vm-new-note-row', 1); await typeName('Soup'); await clickText('Create'); await settle();
    const soup = await pg.evaluate(() => [window.__notes['Soup.md'].fm, [...window.__notices]]);
    ok(soup[0].Designation === 'Recipe' && soup[1].some((n) => /sets Designation differently/.test(n)), 'conflict kept and reported: ' + JSON.stringify(soup));
    console.log('5. a template that disagrees with the view keeps its value, with a notice');

    // 6. locking templates to a base
    await pg.evaluate(async () => { await window.__p.newNote.open(window.__lib); });
    await click('.vm-new-note-lock', 0); await settle(); await click('.vm-new-note-lock', 1); await settle();
    m = await modal();
    ok(JSON.stringify(m.rows) === '["Quotes [locked]","Recipe [locked]","School"]' && m.buttons.includes('Show only locked templates'), 'locking keeps the full list on screen: ' + JSON.stringify(m.rows));
    let saved = await pg.evaluate(() => window.__p.saved.newNote.locks);
    ok(JSON.stringify(saved) === '{"Library.base":["0 Media/Templates/Quotes.md","0 Media/Templates/Recipe.md"]}', 'locks saved per base: ' + JSON.stringify(saved));
    await pg.evaluate(() => window.__modal.close());
    await pg.evaluate(async () => { await window.__p.newNote.open(window.__lib); }); m = await modal();
    ok(JSON.stringify(m.rows) === '["Quotes [locked]","Recipe [locked]"]', 'next time, only the locked ones are listed: ' + JSON.stringify(m.rows));
    ok(m.buttons.includes('Show all 3 templates'), 'show-all switch: ' + JSON.stringify(m.buttons));
    await clickText('Show all 3 templates'); m = await modal();
    ok(JSON.stringify(m.rows) === '["Quotes [locked]","Recipe [locked]","School"]' && m.buttons.includes('Show only locked templates'), 'show all: ' + JSON.stringify(m.rows));
    await clickText('Show only locked templates'); m = await modal();
    await click('.vm-new-note-lock', 0); await settle(); m = await modal();
    ok(JSON.stringify(m.rows) === '["Recipe [locked]"]', 'unlocking from the locked list edits the choice: ' + JSON.stringify(m.rows));
    await pg.evaluate(() => window.__modal.close());
    // one locked template: straight to the name, "Choose another" goes back to the full list
    await pg.evaluate(async () => { await window.__p.newNote.open(window.__lib); }); m = await modal();
    ok(/Template: Recipe/.test(m.text) && m.rows.length === 0, 'one locked template skips the list');
    await clickText('Choose another'); m = await modal();
    ok(m.rows.length === 3, 'choose another lists everything');
    await pg.evaluate(() => window.__modal.close());
    await pg.evaluate(async () => { window.__p.settings.newNote.skipSingle = false; await window.__p.newNote.open(window.__lib); }); m = await modal();
    ok(JSON.stringify(m.rows) === '["Recipe [locked]"]', 'skip switched off: the list, with the one locked template');
    await pg.evaluate(() => window.__modal.close());
    // another base has its own locks; renaming a base or a template follows the lock
    await pg.evaluate(async () => { const cmd = window.__leaf('Command.base', 'Fleeting'); await window.__p.newNote.open(cmd); });
    m = await modal(); ok(m.rows.length === 3 && !m.rows.some((r) => /locked/.test(r)) && /Adds Designation: Fleeting Note/.test(m.text), 'locks are per base; Fleeting view properties');
    await pg.evaluate(() => window.__modal.close());
    await pg.evaluate(async () => { for (const fn of window.__vaultHandlers.rename) await fn({ path: '0 Media/Templates/Dinner.md' }, '0 Media/Templates/Recipe.md'); for (const fn of window.__vaultHandlers.rename) await fn({ path: 'Books.base' }, 'Library.base'); });
    saved = await pg.evaluate(() => window.__p.settings.newNote.locks);
    ok(JSON.stringify(saved) === '{"Books.base":["0 Media/Templates/Dinner.md"]}', 'renames follow the locks: ' + JSON.stringify(saved));
    console.log('6. locking: per base, only locked shown, show all, unlock, skip one, renames followed');

    // 7. Templater, when it is on
    await pg.evaluate(async (c) => { const p = await window.__setup(c, { engine: 'templater' }); window.__lib = window.__leaf('Library.base', 'Table'); await p.newNote.open(window.__lib); }, code);
    await click('.vm-new-note-row', 0); await typeName('Wisdom'); await clickText('Create'); await settle();
    vm = await pg.evaluate(() => JSON.parse(JSON.stringify(window.__vm)));
    ok(JSON.stringify(vm.templaterCalls) === '[{"tpl":"0 Media/Templates/Quotes.md","folder":"/","name":"Wisdom","open":false}]', 'Templater makes it, in the root, without opening: ' + JSON.stringify(vm.templaterCalls));
    ok(vm.created.length === 0 && JSON.stringify(await pg.evaluate(() => window.__notes['Wisdom.md'].fm.Designation)) === '["Books"]' && JSON.stringify(vm.opened) === '["Wisdom.md"]', 'then the base properties are added and it is opened');
    console.log('7. Templater used when it is on');

    // 8. neither engine
    await pg.evaluate(async (c) => { const p = await window.__setup(c, { engine: 'none' }); await p.newNote.open(window.__leaf('Library.base', 'Table')); }, code);
    m = await modal(); ok(/Turn on Templater or the core Templates plugin/.test(m.text) && m.rows.length === 0, 'explains what to turn on');
    await pg.evaluate(() => window.__modal.close());
    console.log('8. no template engine: a clear message');

    // 9. the command
    await pg.evaluate(async (c) => { const p = await window.__setup(c, { engine: 'core' }); window.__lib = window.__leaf('Library.base', 'Table'); p.app.workspace.getMostRecentLeaf = () => window.__lib; p.cmds['new-note-from-template'].callback(); }, code); await settle();
    m = await modal(); ok(/Library · Table/.test(m.title), 'command uses the base you are in');
    await pg.evaluate(() => { window.__modal.close(); window.__p.app.workspace.getMostRecentLeaf = () => ({ view: { getViewType: () => 'markdown' } }); window.__p.cmds['new-note-from-template'].callback(); }); await settle();
    m = await modal(); ok(m.title === 'New note from template' && !/Adds/.test(m.text) && !(await pg.evaluate(() => !!window.__modal.contentEl.querySelector('.vm-new-note-lock'))), 'outside a base: plain picker, no locks');
    await pg.evaluate(() => window.__modal.close());
    console.log('9. command: in a base and outside one');

    // 10. the toolbar button
    const tb = await pg.evaluate(async () => {
        const out = {}; const nn = window.__p.newNote;
        const leaf = window.__leaf('Library.base', 'Table');
        nn.decorate(leaf); nn.decorate(leaf);
        const items = [...leaf.view.containerEl.querySelectorAll('.bases-toolbar > *')].map((e) => e.className);
        out.order = items; out.count = leaf.view.containerEl.querySelectorAll('.vm-new-from-template').length;
        out.label = leaf.view.containerEl.querySelector('.vm-new-from-template .text-button-label').textContent;
        leaf.view.containerEl.querySelector('.vm-new-from-template .text-icon-button').click();
        await new Promise((r) => setTimeout(r, 50));
        out.opened = !!window.__modal && /Library · Table/.test(window.__modal.titleEl.textContent); window.__modal && window.__modal.close();
        // no built-in New button: appended to the toolbar
        const leaf2 = window.__leaf('Library.base', 'Table'); leaf2.view.containerEl.querySelector('.bases-toolbar-new-item-menu').remove(); nn.decorate(leaf2);
        out.appended = leaf2.view.containerEl.querySelector('.bases-toolbar').lastElementChild.classList.contains('vm-new-from-template');
        // no toolbar at all: a floating button, replaced once a toolbar appears
        const leaf3 = window.__leaf('Library.base', 'Table', false); nn.decorate(leaf3);
        out.fab = !!leaf3.view.containerEl.querySelector('.vm-new-from-template-fab');
        leaf3.view.containerEl.insertAdjacentHTML('afterbegin', '<div class="bases-header"><div class="bases-toolbar"></div></div>'); nn.decorate(leaf3);
        out.fabGone = !leaf3.view.containerEl.querySelector('.vm-new-from-template-fab') && !!leaf3.view.containerEl.querySelector('.bases-toolbar .vm-new-from-template');
        // still loading (no view yet): nothing added
        const leaf4 = window.__leaf('Library.base', 'Table', false); leaf4.view.containerEl.innerHTML = ''; nn.decorate(leaf4);
        out.loading = leaf4.view.containerEl.children.length === 0;
        nn.unload(); out.unloaded = document.querySelectorAll('.vm-new-from-template, .vm-new-from-template-fab').length;
        return out;
    });
    ok(JSON.stringify(tb.order) === '["bases-toolbar-item bases-toolbar-views-menu","bases-toolbar-item bases-toolbar-results-menu","bases-toolbar-item bases-toolbar-new-item-menu","bases-toolbar-item vm-new-from-template"]', 'right after Bases\' own New: ' + JSON.stringify(tb.order));
    ok(tb.count === 1, 'added once: ' + tb.count);
    ok(tb.label === 'Template', 'labelled: ' + tb.label);
    ok(tb.opened, 'clicking it opens the picker for that base');
    ok(tb.appended && tb.fab && tb.fabGone && tb.loading, 'fallbacks: ' + JSON.stringify(tb));
    ok(tb.unloaded === 0, 'removed when the plugin unloads');
    console.log('10. toolbar button next to New; appended without it; floating button without a toolbar; removed on unload');

    // 11. switched off, and settings
    const off = await pg.evaluate(async (c) => { const p = await window.__setup(c, { data: { features: { newNoteButton: false } } }); return [!!p.cmds['new-note-from-template'], p.newNote]; }, code);
    ok(off[0] === false && off[1] === null, 'off: no command, no button');
    const ms = (d) => pg.evaluate((d) => JSON.stringify(window.__exports.__test.mergeSettings(d).newNote), d);
    ok(await ms(null) === '{"skipSingle":true,"locks":{}}', 'defaults');
    ok(await ms({ newNote: { skipSingle: false, locks: { 'a.base': ['t.md', 5], 'b.base': 'bad' } } }) === '{"skipSingle":false,"locks":{"a.base":["t.md"]}}', 'bad saved values dropped');
    console.log('11. feature switch and saved settings');

    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nNEW NOTE TESTS PASS');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
