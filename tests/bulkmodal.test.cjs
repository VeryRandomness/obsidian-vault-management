// Bulk properties dialog on a phone: the keyboard must be dismissable.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };
(async () => {
    const b = await chromium.launch(); const pg = await b.newPage();
    pg.on('pageerror', (e) => { failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body></body>'); await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    const code = fs.readFileSync(R + '/main.js', 'utf8');
    const r = await pg.evaluate(async (code) => {
        const p = window.__make(code, null);
        const f = (n, fm) => ({ path: n, basename: n, extension: 'md', fm });
        const files = [f('a.md', { status: 'x', tags: ['t'] }), f('b.md', { status: 'y' })];
        p.app.vault.getMarkdownFiles = () => files;
        p.app.metadataCache.getFileCache = (file) => ({ frontmatter: file.fm });
        await p.onload();
        p.cmds['bulk-edit-properties'].callback();
        const m = window.__modal, out = {};
        const tap = (el) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        const search = m.contentEl.querySelector('input.bulk-props-search');
        out.hint = search.getAttribute('enterkeyhint');
        search.focus(); out.focused = document.activeElement === search;
        tap(m.titleEl); out.titleTap = document.activeElement === search;           // empty space: keyboard goes
        search.focus(); tap(search); out.inputTap = document.activeElement === search;   // inside the box: stays
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); out.enter = document.activeElement === search;
        // rename screen
        // (Return on the property list already opened the first property, as it always did)
        out.onValues = /Property: /.test(m.contentEl.textContent);
        const ren = window.__settings.filter((s) => s.name === 'Rename or merge this property').pop(); ren && ren.controls[0][1].cb();
        const inp = m.contentEl.querySelector('input[list]');
        out.renameFound = !!inp; if (inp) {
            out.renameHint = inp.getAttribute('enterkeyhint'); inp.focus();
            tap(m.contentEl); out.renameTap = document.activeElement === inp;
            inp.focus(); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); out.renameEnter = document.activeElement === inp;
            out.valueKept = true;
        }
        return out;
    }, code);
    ok(r.hint === 'done', 'search box shows a Done key: ' + r.hint);
    ok(r.focused && r.titleTap === false, 'tapping empty space puts the box away');
    ok(r.inputTap === true, 'tapping the box itself keeps it');
    ok(r.enter === false, 'Return puts the box away');
    ok(r.onValues, 'Return on the list still opens the first match');
    ok(r.renameFound, 'rename screen reached');
    ok(r.renameHint === 'done' && r.renameTap === false && r.renameEnter === false, 'rename box: Done key, tap away, Return: ' + JSON.stringify(r));
    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : 'BULK DIALOG TESTS PASS'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
