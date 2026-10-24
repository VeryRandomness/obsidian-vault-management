// Text covers: starting up, staying out of the way of the standalone plugin,
// importing its settings once, and the cover-text cache file.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };
const DIR = '.obsidian/plugins/vr-vault-management';
const FP = JSON.stringify({ v: 1, contentProperty: 'textCover', defaultToTitle: false, fallbackToBody: true });
(async () => {
    const b = await chromium.launch(); const pg = await b.newPage();
    pg.on('pageerror', (e) => { failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body></body>'); await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    const code = fs.readFileSync(R + '/main.js', 'utf8');
    // boot with `data` as the saved settings and `files` as the vault's files
    const boot = (data, files) => pg.evaluate(async ([c, d, f]) => {
        const p = window.__make(c, d); for (const k of Object.keys(window.__files)) delete window.__files[k]; Object.assign(window.__files, f);
        window.__notices.length = 0; window.__writes.length = 0; await p.onload();
        return { active: p.textCover && p.textCover.active, events: p.events.length, settings: p.settings.textCover, saved: p.saved && p.saved.textCover, notices: [...window.__notices], cacheSize: p.textCover && p.textCover.cacheSize, wrote: [...window.__writes] };
    }, [code, data, files]);

    // 1. a fresh install: defaults, nothing imported, nothing to save yet but the defaults
    let r = await boot(null, {});
    ok(r.active === true && r.events > 0, 'starts up and listens for changes: ' + JSON.stringify([r.active, r.events]));
    ok(r.settings.contentProperty === 'textCover' && r.settings.coversFolder === 'Covers' && r.settings.autoDownloadCovers === true && r.settings.maxChars === 300, 'default settings: ' + JSON.stringify(r.settings));
    console.log('1. fresh install uses the defaults');

    // 2. switched on next to the standalone plugin: stays idle, says why
    const baseline = (await boot({ features: { textCovers: false } }, {})).events;
    r = await boot(null, { '.obsidian/community-plugins.json': JSON.stringify(['templater-obsidian', 'text-cover-generator']) });
    ok(r.active === false && r.events === baseline, 'idle, registers nothing: ' + JSON.stringify([r.active, r.events, baseline]));
    ok(r.notices.some((n) => /Text Cover Generator plugin is on/.test(n)), 'tells you why: ' + JSON.stringify(r.notices));
    ok(r.settings === undefined, 'does not touch settings while idle');
    r = await boot(null, { '.obsidian/community-plugins.json': JSON.stringify(['templater-obsidian']) });
    ok(r.active === true, 'active once the standalone plugin is off');
    console.log('2. idle while the standalone plugin is on, active when it is off');

    // 3. the first run imports the standalone plugin's settings and cache, once
    const legacy = { settings: { contentProperty: 'myCover', maxChars: 123, coversFolder: '0 Media/Covers', debugMode: true }, cache: { fingerprint: JSON.stringify({ v: 1, contentProperty: 'myCover', defaultToTitle: false, fallbackToBody: true }), entries: { 'a.md': { text: 'hello', mtime: 1 }, 'b.md': { text: null, mtime: 2 } } } };
    r = await boot(null, { '.obsidian/plugins/text-cover-generator/data.json': JSON.stringify(legacy) });
    ok(r.settings.contentProperty === 'myCover' && r.settings.maxChars === 123 && r.settings.coversFolder === '0 Media/Covers' && r.settings.debugMode === true, 'settings imported: ' + JSON.stringify(r.settings));
    ok(r.settings.defaultBg && r.settings.padding, 'settings the old file did not have get their defaults');
    ok(r.saved && r.saved.maxChars === 123, 'import saved into the plugin settings: ' + JSON.stringify(r.saved));
    ok(r.cacheSize === 1, 'the old cache was reused (1 cover text, 1 known-empty): ' + r.cacheSize);
    // the oldest file shape: just the settings object
    r = await boot(null, { '.obsidian/plugins/text-cover-generator/data.json': JSON.stringify({ contentProperty: 'oldest', maxChars: 77 }) });
    ok(r.settings.contentProperty === 'oldest' && r.settings.maxChars === 77, 'the oldest file shape is imported too: ' + JSON.stringify(r.settings));
    // already has its own settings: the old file is ignored
    r = await boot({ textCover: { maxChars: 50 } }, { '.obsidian/plugins/text-cover-generator/data.json': JSON.stringify(legacy) });
    ok(r.settings.maxChars === 50 && r.settings.contentProperty === 'textCover' && !r.saved, 'own settings win over the old file, and nothing is rewritten: ' + JSON.stringify([r.settings, r.saved]));
    ok(r.cacheSize === 0, 'old cache not imported over own settings');
    // a broken old file changes nothing
    r = await boot(null, { '.obsidian/plugins/text-cover-generator/data.json': '{not json' });
    ok(r.active === true && r.settings.maxChars === 300, 'a broken old file is ignored');
    console.log('3. one-time import of the standalone plugin settings and cache');

    // 4. the cache lives in its own file, read at start (same settings) and ignored when settings changed
    r = await boot(null, { [DIR + '/text-cover-cache.json']: JSON.stringify({ fingerprint: FP, entries: { 'x.md': { text: 'kept', mtime: 5 } } }) });
    ok(r.cacheSize === 1, 'cache file with matching settings is reused: ' + r.cacheSize);
    r = await boot(null, { [DIR + '/text-cover-cache.json']: JSON.stringify({ fingerprint: 'other', entries: { 'x.md': { text: 'stale', mtime: 5 } } }) });
    ok(r.cacheSize === 0, 'cache built under other settings is thrown away: ' + r.cacheSize);
    const wrote = await pg.evaluate(async (c) => {
        const p = window.__make(c, null); window.__files[ 'x' ] = 1; delete window.__files.x; await p.onload();
        window.__writes.length = 0; await p.textCover.buildCache(); await new Promise((r) => setTimeout(r, 2400));
        const f = window.__files['.obsidian/plugins/vr-vault-management/text-cover-cache.json'];
        return { writes: window.__writes.filter((w) => /text-cover-cache/.test(w)).length, content: f && JSON.parse(f), dataJsonWritten: window.__writes.some((w) => /data\.json/.test(w)) };
    }, code);
    ok(wrote.writes >= 1 && wrote.content && typeof wrote.content.fingerprint === 'string' && typeof wrote.content.entries === 'object', 'cache saved to its own file: ' + JSON.stringify(wrote));
    console.log('4. cache file: reused, discarded when settings changed, written separately from settings');

    // 5. the pure helpers (cover URL upgrades, ISBNs, file names)
    const h = await pg.evaluate(() => {
        const t = window.__exports.__test.textCover;
        return {
            amazon: t.upgradedUrls('http://books.example/cover._SX98_.jpg'), openlib: t.upgradedUrls('https://covers.openlibrary.org/b/id/1-M.jpg'),
            itunes: t.upgradedUrls('https://is1.mzstatic.com/image/100x100bb.jpg'), none: t.upgradedUrls('https://example.com/a.jpg'),
            isbns: t.isbnsOf({ isbn13: '978-0-553-44813-9', isbn10: '0553448137' }), badIsbn: t.isbnsOf({ isbn13: '12345' }),
            name: t.sanitizeFilename('a/b:c*d?'), extUrl: [t.extensionFromUrl('https://x/y.JPG?z=1'), t.extensionFromUrl('https://x/y')], extType: [t.extensionFromContentType('image/jpeg'), t.extensionFromContentType('text/html')],
        };
    });
    ok(JSON.stringify(h.amazon) === '["https://books.example/cover.jpg"]' && JSON.stringify(h.openlib) === '["https://covers.openlibrary.org/b/id/1-L.jpg"]' && JSON.stringify(h.itunes) === '["https://is1.mzstatic.com/image/1200x1200bb.jpg"]' && h.none.length === 0, 'larger cover URLs: ' + JSON.stringify([h.amazon, h.openlib, h.itunes, h.none]));
    ok(JSON.stringify(h.isbns) === '["9780553448139","0553448137"]' && h.badIsbn.length === 0, 'ISBNs: ' + JSON.stringify(h.isbns));
    ok(h.name === 'a-b-c-d-' && JSON.stringify(h.extUrl) === '[".jpg",null]' && JSON.stringify(h.extType) === '[".jpg",null]', 'file name and extension helpers: ' + JSON.stringify([h.name, h.extUrl, h.extType]));
    console.log('5. URL upgrade, ISBN and file helpers');

    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nTEXT COVER TESTS PASS');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
