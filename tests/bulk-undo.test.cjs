// Bulk Properties: the undo log, and undoing an edit.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };
(async () => {
    const b = await chromium.launch(); const pg = await b.newPage();
    pg.on('pageerror', (e) => { failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body></body>'); await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    await pg.evaluate((c) => { window.__make(c, null); }, fs.readFileSync(R + '/main.js', 'utf8'));
    const out = await pg.evaluate(async () => {
        const t = window.__exports.__test.bulk; const res = {};
        const build = (notes) => {
            const disk = {};
            const plugin = { manifest: { dir: 'P' }, app: {
                fileManager: { processFrontMatter: async (f, cb) => { const n = notes[f.path]; if (!n) throw new Error('missing'); if (n.fail) throw new Error('boom'); cb(n.fm); } },
                vault: { getFileByPath: (p) => (notes[p] ? { path: p, extension: 'md', basename: p } : null), adapter: { read: async (p) => { if (!(p in disk)) throw new Error('ENOENT'); return disk[p]; }, write: async (p, x) => { disk[p] = x; } } } } };
            return { app: plugin.app, log: new t.UndoLog(plugin), disk };
        };
        const files = (notes, names) => names.map((n) => ({ path: n, extension: 'md', basename: n }));
        const copy = (x) => JSON.parse(JSON.stringify(x));

        // 1. an edit is logged for the notes it really changed, and undone exactly (values, list items, key order)
        let notes = { 'a.md': { fm: { title: 'A', Designation: ['Inprogress', 'Books'], tags: ['x'] } }, 'b.md': { fm: { Designation: 'Inprogress', stars: '8/10' } }, 'c.md': { fm: { title: 'C' } } };
        const orig = copy(notes); let { app, log, disk } = build(notes);
        const sel = new Set(['Inprogress']);
        let r = await t.applyEdit(app, files(notes, ['a.md', 'b.md', 'c.md']), (fm) => { if (!('Designation' in fm)) return; fm.Designation = t.changed(fm.Designation, sel, 'change', 'In Progress'); }, 'Changed “Designation”', log);
        res.changed = r.changed; res.after = copy(notes);
        const entry = await log.last(); res.entryFiles = entry.files.map((f) => f.path); res.desc = entry.description;
        await t.undoLast(app, log);
        res.restored = JSON.stringify(notes) === JSON.stringify(orig); res.orderA = Object.keys(notes['a.md'].fm).join(','); res.logAfter = (await log.read()).length; res.notice1 = window.__notices.slice(-1)[0];

        // 2. delete property + rename: key order comes back
        notes = { 'a.md': { fm: { a: 1, b: 2, c: 3 } }, 'b.md': { fm: { x: 'old', y: 'keep', Cat: ['k'] } } };
        const o2 = copy(notes); ({ app, log } = build(notes));
        await t.applyEdit(app, files(notes, ['a.md']), (fm) => { delete fm.b; fm.d = 4; }, 'Deleted b', log);
        res.afterDelete = Object.keys(notes['a.md'].fm).join(',');
        await t.undoLast(app, log); res.orderDeleteUndone = Object.keys(notes['a.md'].fm).join(',') + '|' + JSON.stringify(notes['a.md'].fm);
        await t.applyEdit(app, files(notes, ['b.md']), (fm) => { t.rename(fm, 'x', 'Cat'); }, 'Renamed x', log);
        res.afterRename = JSON.stringify(notes['b.md'].fm);
        await t.undoLast(app, log); res.renameUndone = JSON.stringify(notes['b.md'].fm) === JSON.stringify(o2['b.md'].fm) && Object.keys(notes['b.md'].fm).join(',') === 'x,y,Cat';

        // 3. a note edited after the bulk edit is left alone; a deleted note is skipped
        notes = { 'a.md': { fm: { p: 'one' } }, 'b.md': { fm: { p: 'one' } }, 'c.md': { fm: { p: 'one' } } }; ({ app, log } = build(notes));
        await t.applyEdit(app, files(notes, ['a.md', 'b.md', 'c.md']), (fm) => { fm.p = 'two'; }, 'p one -> two', log);
        notes['b.md'].fm.p = 'typed by hand'; delete notes['c.md'];
        window.__notices.length = 0; await t.undoLast(app, log);
        res.partial = [notes['a.md'].fm.p, notes['b.md'].fm.p, 'c.md' in notes]; res.partialNotice = window.__notices[0];

        // 4. nothing to undo; undo twice
        window.__notices.length = 0; await t.undoLast(app, log); res.nothing = window.__notices[0];

        // 5. only the last 10 edits are kept
        notes = { 'a.md': { fm: { n: 0 } } }; ({ app, log } = build(notes));
        for (let i = 1; i <= 12; i++) await t.applyEdit(app, files(notes, ['a.md']), (fm) => { fm.n = i; }, 'edit ' + i, log);
        const l = await log.read(); res.kept = [l.length, l[0].description.split(' (')[0], l[l.length - 1].description.split(' (')[0]];

        // 6. a failing note keeps the entry for another try
        notes = { 'a.md': { fm: { v: 1 } }, 'b.md': { fm: { v: 1 } } }; ({ app, log } = build(notes));
        await t.applyEdit(app, files(notes, ['a.md', 'b.md']), (fm) => { fm.v = 2; }, 'v 1 -> 2', log);
        notes['b.md'].fail = true; await t.undoLast(app, log);
        res.failKept = [(await log.read()).length, notes['a.md'].fm.v];
        notes['b.md'].fail = false; await t.undoLast(app, log);
        res.failRetried = [(await log.read()).length, notes['a.md'].fm.v, notes['b.md'].fm.v];

        // 7. a note that fails during the edit is counted, not logged
        notes = { 'a.md': { fm: { v: 1 }, fail: true }, 'b.md': { fm: { v: 1 } } }; ({ app, log } = build(notes));
        r = await t.applyEdit(app, files(notes, ['a.md', 'b.md']), (fm) => { fm.v = 9; }, 'v -> 9', log);
        res.editFail = [r.changed, r.failed, (await log.last()).files.map((f) => f.path)];

        // 8. an edit that changes nothing logs nothing; the snapshot is a deep copy
        notes = { 'a.md': { fm: { v: 1, list: ['a'] } } }; ({ app, log } = build(notes));
        r = await t.applyEdit(app, files(notes, ['a.md']), () => {}, 'nothing', log); res.noop = [r.changed, (await log.read()).length];
        const snap = t.snapshot(notes['a.md'].fm); notes['a.md'].fm.list.push('b'); res.deep = JSON.stringify(snap[1]);
        return res;
    });
    ok(out.changed === 2 && JSON.stringify(out.entryFiles) === '["a.md","b.md"]', 'logged only the notes that changed: ' + JSON.stringify([out.changed, out.entryFiles]));
    ok(/Changed “Designation” \(2 notes\)/.test(out.desc), 'description has the count: ' + out.desc);
    ok(JSON.stringify(out.after['a.md'].fm.Designation) === '["In Progress","Books"]' && out.after['b.md'].fm.Designation === 'In Progress', 'the edit itself worked');
    ok(out.restored && out.orderA === 'title,Designation,tags' && out.logAfter === 0, 'undo restores every value and the key order, and drops the log entry: ' + JSON.stringify([out.restored, out.orderA, out.logAfter]));
    ok(/restored 2 notes/.test(out.notice1), 'notice: ' + out.notice1);
    ok(out.afterDelete === 'a,c,d' && out.orderDeleteUndone === 'a,b,c|{"a":1,"b":2,"c":3}', 'delete undone, original order back: ' + JSON.stringify([out.afterDelete, out.orderDeleteUndone]));
    ok(out.renameUndone, 'rename undone: ' + out.afterRename);
    ok(JSON.stringify(out.partial) === '["one","typed by hand",false]', 'a note edited since is not overwritten: ' + JSON.stringify(out.partial));
    ok(/restored 1 note, left 2 that changed since or no longer exist/.test(out.partialNotice), 'partial notice: ' + out.partialNotice);
    ok(out.nothing === 'Bulk Properties: nothing to undo.', 'second undo: ' + out.nothing);
    ok(JSON.stringify(out.kept) === '[10,"edit 3","edit 12"]', 'only the last 10 edits are kept: ' + JSON.stringify(out.kept));
    ok(JSON.stringify(out.failKept) === '[1,1]', 'a failed undo keeps the entry (and restores the others): ' + JSON.stringify(out.failKept));
    ok(JSON.stringify(out.failRetried) === '[0,1,1]', 'the retry finishes the job: ' + JSON.stringify(out.failRetried));
    ok(out.editFail[0] === 1 && out.editFail[1] === 1 && JSON.stringify(out.editFail[2]) === '["b.md"]', 'a failing note is counted and not logged: ' + JSON.stringify(out.editFail));
    ok(JSON.stringify(out.noop) === '[0,0]' && out.deep === '["list",["a"]]', 'no-op logs nothing; snapshots are deep copies: ' + JSON.stringify([out.noop, out.deep]));
    console.log('bulk undo: logging, exact restore, order, skip-if-edited, cap of 10, failure retry');
    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nBULK UNDO TESTS PASS');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
