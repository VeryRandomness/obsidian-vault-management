// The self-updater: it installs the latest GitHub release, and nothing else.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
const { releaseWeb } = require('./helpers.cjs');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };
const REPO = 'VeryRandomness/obsidian-vault-management', DIR = '.obsidian/plugins/vr-vault-management';
const man = (o) => JSON.stringify(Object.assign({ id: 'vr-vault-management', version: '1.0.0' }, o));
(async () => {
    const b = await chromium.launch(); const pg = await b.newPage();
    pg.on('pageerror', (e) => { failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body></body>'); await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    const code = fs.readFileSync(R + '/main.js', 'utf8');
    // installed version 1.0.0; `web` is what GitHub serves; returns files written (in order), what is on disk, and the notices
    const run = (web, { manual = true } = {}) => pg.evaluate(async ([c, w, dir, manual]) => {
        const p = window.__make(c, null); await p.onload();
        for (const k of Object.keys(window.__files)) delete window.__files[k];
        window.__files[dir + '/manifest.json'] = JSON.stringify({ id: 'vr-vault-management', version: '1.0.0' }); window.__files[dir + '/main.js'] = 'OLD';
        window.__web = w; window.__notices.length = 0; window.__writes.length = 0; window.__reload = [];
        if (manual) await p.cmds['check-for-update'].callback(); else for (const f of p.layout.slice(-1)) await f();
        await new Promise((r) => setTimeout(r, 650));
        return { writes: window.__writes.map((x) => x.split('/').pop()), files: { ...window.__files }, n: [...window.__notices], reload: window.__reload };
    }, [code, web, DIR, manual]);

    let r = await run(releaseWeb(REPO, '1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': 'NEW', 'styles.css': 'CSS', 'lib.js': 'LIB' }));
    ok(JSON.stringify(r.writes) === '["main.js","styles.css","lib.js","manifest.json"]', 'installs everything, manifest last: ' + JSON.stringify(r.writes));
    ok(r.files[DIR + '/main.js'] === 'NEW' && JSON.parse(r.files[DIR + '/manifest.json']).version === '1.0.1' && r.reload.length === 2, 'new files on disk, plugin reloaded');
    console.log('1. a newer release installs, manifest written last');

    r = await run(releaseWeb(REPO, '1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': 'NEW' }));
    ok(JSON.stringify(r.writes) === '["main.js","manifest.json"]', 'styles.css and lib.js are optional: ' + JSON.stringify(r.writes));
    r = await run(releaseWeb(REPO, 'v1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': 'NEW' }));
    ok(r.writes.length === 2, 'a tag with a leading v is fine: ' + JSON.stringify(r.n));
    console.log('2. optional files, v-prefixed tags');

    for (const [label, web, expect] of [
        ['same version', releaseWeb(REPO, '1.0.0', { 'manifest.json': man({}), 'main.js': 'X' }), /up to date/],
        ['older release', releaseWeb(REPO, '0.9.0', { 'manifest.json': man({ version: '0.9.0' }), 'main.js': 'X' }), /up to date/],
        ['no release published', { [REPO + ':manifest.json']: man({ version: '9.9.9' }), [REPO + ':main.js']: 'MAIN BRANCH' }, /no release|404/],
        ['tag and manifest disagree', releaseWeb(REPO, '2.0.0', { 'manifest.json': man({ version: '2.0.1' }), 'main.js': 'X' }), /contains version/],
        ['another plugin\'s id', releaseWeb(REPO, '9.0.0', { 'manifest.json': man({ id: 'writing-mode', version: '9.0.0' }), 'main.js': 'EVIL' }), /different plugin id/],
        ['main.js missing from the release', releaseWeb(REPO, '1.0.1', { 'manifest.json': man({ version: '1.0.1' }) }), /has no main\.js/],
        ['main.js empty', releaseWeb(REPO, '1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': '  ' }), /empty/],
        ['a listed file fails to download', (() => { const w = releaseWeb(REPO, '1.0.1', { 'manifest.json': man({ version: '1.0.1' }), 'main.js': 'NEW', 'lib.js': 'LIB' }); delete w[REPO + ':lib.js']; return w; })(), /404/],
        ['offline', { offline: true }, /Update check failed/],
    ]) {
        r = await run(web);
        ok(r.writes.length === 0, `${label}: nothing written, got ${JSON.stringify(r.writes)}`);
        ok(r.files[DIR + '/main.js'] === 'OLD' && JSON.parse(r.files[DIR + '/manifest.json']).version === '1.0.0', `${label}: installed files untouched`);
        ok(r.n.some((x) => expect.test(x)), `${label}: notice says why: ${JSON.stringify(r.n)}`);
    }
    console.log('3. nothing is written for: same/older version, no release (main branch ignored), mismatched tag, other id, missing/empty/failed files, offline');

    r = await run({ offline: true }, { manual: false });
    ok(r.n.length === 0 && r.writes.length === 0, 'startup check that fails is silent: ' + JSON.stringify(r.n));
    console.log('4. a failing startup check is silent');

    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nUPDATER TESTS PASS');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
