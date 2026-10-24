const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
const { releaseWeb } = require('./helpers.cjs');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };
(async () => {
    const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 900, height: 800 } });
    pg.on('pageerror', (e) => { failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body></body>'); await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    const code = fs.readFileSync(R + '/main.js', 'utf8'), lib = fs.readFileSync(R + '/lib.js', 'utf8');
    const DIR = '.obsidian/plugins/vr-vault-management', REPO = 'VeryRandomness/obsidian-vault-management';
    // a fresh plugin instance; `files` is what is in the plugin folder; `web` is what GitHub serves
    // expose the fake TFile the plugin's instanceof checks use (the harness stub class)
    const rendered = '<h1>Title</h1><p>Some text with a <a href="https://example.com/page">web link</a> and <a class="internal-link" data-href="Other" href="Other">a note link</a>.</p><ul><li>one</li><li>two</li></ul>';
    const exportNow = () => pg.evaluate(async (html) => { window.__rendered = html; window.__notices.length = 0; window.__pdf = null; window.__p.cmds['export-current-note-to-pdf'].checkCallback(false); for (let i = 0; i < 80 && !window.__pdf && !window.__notices.some((n) => /failed/.test(n)); i++) await new Promise((r) => setTimeout(r, 100)); return { pdf: window.__pdf && { path: window.__pdf.path, head: String.fromCharCode(...window.__pdf.bytes.slice(0, 5)), size: window.__pdf.bytes.length, text: new TextDecoder('latin1').decode(window.__pdf.bytes) }, notices: [...window.__notices] }; }, rendered);

    const makeP = (files, web) => pg.evaluate(async ([c, f, w]) => {
        const p = window.__make(c, null); for (const k of Object.keys(window.__files)) delete window.__files[k]; Object.assign(window.__files, f);
        window.__web = w; window.__notices.length = 0; window.__pdf = null;
        // the plugin only checks .extension and passes the file along
        window.__active = { path: 'Note.md', extension: 'md', basename: 'Note' };
        await p.onload(); return true;
    }, [code, files, web]);

    // 1. lib.js present: a real export, start to finish
    await makeP({ [DIR + '/lib.js']: lib }, {});
    let r = await exportNow();
    ok(r.pdf && r.pdf.path === 'Note.pdf' && r.pdf.head === '%PDF-', 'a PDF was written next to the note: ' + JSON.stringify(r.notices) + ' ' + JSON.stringify(r.pdf && { p: r.pdf.path, h: r.pdf.head }));
    ok(r.pdf && r.pdf.size > 2000, 'PDF has content (' + (r.pdf && r.pdf.size) + ' bytes)');
    ok(r.pdf && /\/URI/.test(r.pdf.text) && /example\.com\/page/.test(r.pdf.text), 'web link kept as a clickable link');
    ok(r.pdf && /obsidian:\/\/open\?vault=Test%20Vault&file=Other/.test(r.pdf.text), 'note link became an obsidian:// link');
    ok(r.notices.some((n) => n === 'Exported to Note.pdf'), 'success notice: ' + JSON.stringify(r.notices));
    console.log('1. real export with lib.js present: PDF', r.pdf && r.pdf.size, 'bytes, links kept');

    // 2. updated by an OLD updater: lib.js missing, GitHub has it. The startup check fetches it
    await makeP({}, releaseWeb(REPO, '1.3.0', { 'lib.js': lib }));
    const startup = await pg.evaluate(async () => { for (const f of window.__p.layout) { try { await f(); } catch (e) {} } return Object.keys(window.__files); });
    ok(startup.includes(DIR + '/lib.js'), 'startup downloaded the missing lib.js: ' + JSON.stringify(startup));
    ok(await pg.evaluate((d) => window.__files[d + '/lib.js'].length, DIR) === lib.length, 'downloaded file is the whole library');
    r = await exportNow(); ok(r.pdf && r.pdf.head === '%PDF-', 'export works after the startup download: ' + JSON.stringify(r.notices));
    console.log('2. missing lib.js is fetched at startup, then export works');

    // 3. exporting before the startup fetch ran: the export itself downloads it
    await makeP({}, releaseWeb(REPO, '1.3.0', { 'lib.js': lib }));
    r = await exportNow();
    ok(r.pdf && r.pdf.head === '%PDF-', 'export downloaded lib.js on demand: ' + JSON.stringify(r.notices));
    ok(await pg.evaluate((d) => d + '/lib.js' in window.__files, DIR), 'lib.js saved for next time');
    console.log('3. first export downloads lib.js on demand');

    // 4. no lib.js and offline: a clear message, no crash, and it recovers once online
    await makeP({}, { offline: true });
    r = await exportNow();
    ok(!r.pdf && r.notices.some((n) => /PDF export failed: the PDF library \(lib\.js\) is missing/.test(n)), 'clear error offline: ' + JSON.stringify(r.notices));
    await pg.evaluate((w) => { window.__web = w; }, releaseWeb(REPO, '1.3.0', { 'lib.js': lib }));
    r = await exportNow(); ok(r.pdf && r.pdf.head === '%PDF-', 'retry works once online: ' + JSON.stringify(r.notices));
    console.log('4. offline: clear message; recovers on retry');

    // 5. the updater installs lib.js with a newer version
    await makeP({ [DIR + '/manifest.json']: JSON.stringify({ id: 'vr-vault-management', version: '1.0.0' }) }, {
        ...releaseWeb(REPO, '9.0.0', { 'manifest.json': JSON.stringify({ id: 'vr-vault-management', version: '9.0.0' }), 'main.js': 'NEWMAIN', 'styles.css': 'CSS', 'lib.js': 'NEWLIB' }) });
    const upd = await pg.evaluate(async () => { await window.__p.cmds['check-for-update'].callback(); await new Promise((r) => setTimeout(r, 700)); return Object.keys(window.__files).sort(); });
    ok(JSON.stringify(upd) === JSON.stringify([DIR + '/lib.js', DIR + '/main.js', DIR + '/manifest.json', DIR + '/styles.css']), 'updater wrote all four files: ' + JSON.stringify(upd));
    console.log('5. self-update installs lib.js with the rest');

    // 6. the command only shows for a markdown note
    await makeP({ [DIR + '/lib.js']: lib }, {});
    const vis = await pg.evaluate(() => { const c = window.__p.cmds['export-current-note-to-pdf']; const out = []; window.__active = { path: 'Note.md', extension: 'md' }; out.push(c.checkCallback(true)); window.__active = { path: 'pic.png', extension: 'png' }; out.push(c.checkCallback(true)); window.__active = null; out.push(c.checkCallback(true)); return out; });
    ok(JSON.stringify(vis) === '[true,false,false]', 'command availability: ' + JSON.stringify(vis));
    const rib = await pg.evaluate(() => { window.__active = { path: 'pic.png', extension: 'png' }; window.__notices.length = 0; window.__p.ribbon.find((x) => x[0] === 'file-output')[2](); return [...window.__notices]; });
    ok(rib.includes('Open a markdown note first.'), 'ribbon icon on a non-note: ' + JSON.stringify(rib));
    console.log('6. command only for markdown notes; ribbon message otherwise');

    // 7. switched off: no command, no ribbon icon, no library download
    const off = await pg.evaluate(async (c) => { const p = window.__make(c, { features: { mdToPdf: false } }); for (const k of Object.keys(window.__files)) delete window.__files[k]; window.__web = {}; await p.onload(); for (const f of p.layout) { try { await f(); } catch (e) {} } return [!!p.cmds['export-current-note-to-pdf'], p.ribbon.some((x) => x[0] === 'file-output'), 'x/lib.js' in window.__files]; }, code);
    ok(JSON.stringify(off) === '[false,false,false]', 'feature off: ' + JSON.stringify(off));
    console.log('7. feature off: nothing registered, nothing downloaded');

    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nPDF TESTS PASS');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
