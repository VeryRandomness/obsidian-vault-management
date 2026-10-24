const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), a = require('assert');
const R = path.join(__dirname, '..'), B = path.join(__dirname, '.build');
let failures = 0; const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } };
(async () => {
    const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 800, height: 700 } });
    pg.on('pageerror', (e) => { failures++; console.log('PAGEERROR', e.message); });
    await pg.setContent('<body><style>.s-color-inline-swatch,.s-color-inline-cb{display:inline-block}</style></body>');
    await pg.addScriptTag({ content: fs.readFileSync(B + '/bundle.js', 'utf8') });
    const code = fs.readFileSync(R + '/main.js', 'utf8');
    await pg.evaluate(async (c) => { const p = window.__make(c, null); await p.onload(); }, code);
    console.log('browser:', await pg.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0]));

    // ---------- 1. what counts as a color (inline code, Reading view) ----------
    const valid = ['#fff', '#FFF', '#ff8800', '#ff880080', '#f808', 'rgb(255, 0, 0)', 'RGB(255,0,0)', 'rgba(0,255,255,0.5)', 'rgb(255 0 0 / 50%)',
        'hsl(120, 100%, 50%)', 'hsl(120deg 100% 50%)', 'hsla(32,100%,50%,0.8)', 'hwb(194 0% 0%)', 'lab(50% 40 59.5)', 'lch(52% 72 56)',
        'oklab(59% 0.1 0.1)', 'oklch(70% 0.2 150)', 'color(display-p3 1 0 0)', 'color-mix(in srgb, red 50%, blue)',
        'red', 'Red', 'RebeccaPurple', 'darkslategray', 'transparent'];
    const invalid = ['notacolor', 'red;background:url(x)', '#ggg', '#12345', '#1234567', 'inherit', 'initial', 'currentcolor', 'canvastext', 'var(--x)',
        'rgb(var(--r) 0 0)', 'rgb(1,2)', 'rgb(a,b,c)', 'color: red', '', '  ', 'redd', 'hsl(', '--red', '.red', 'light-dark(red, blue)'];
    const res = await pg.evaluate(([v, i]) => {
        const run = (t) => { const el = document.createElement('div'); const c = document.createElement('code'); c.textContent = t; el.appendChild(c); window.__run(el); return { cls: c.classList.contains('s-color-inline'), sw: c.style.getPropertyValue('--color-swatch'), txt: c.style.getPropertyValue('--color-swatch-text'), n: c.querySelectorAll('.s-color-inline-swatch').length }; };
        return { v: v.map((t) => [t, run(t)]), i: i.map((t) => [t, run(t)]) };
    }, [valid, invalid]);
    for (const [t, r] of res.v) ok(r.cls && r.n === 1 && r.sw === t, `should be a color: ${JSON.stringify(t)} -> ${JSON.stringify(r)}`);
    for (const [t, r] of res.i) ok(!r.cls && r.n === 0, `should NOT be a color: ${JSON.stringify(t)}`);
    console.log(`1. colors: ${res.v.length} valid accepted, ${res.i.length} invalid rejected`);
    const txt = Object.fromEntries(res.v.map(([t, r]) => [t, r.txt]));
    ok(txt['#fff'] === '#000' && txt['#000'] === undefined, 'white background -> black text');
    ok(txt['transparent'] === 'var(--code-normal)' && txt['rgba(0,255,255,0.5)'] !== undefined, 'transparent keeps theme text');
    const dark = await pg.evaluate(() => { const el = document.createElement('div'); const c = document.createElement('code'); c.textContent = 'navy'; el.appendChild(c); window.__run(el); return c.style.getPropertyValue('--color-swatch-text'); });
    ok(dark === '#fff', 'navy -> white text, got ' + dark);

    // ---------- 2. named colors setting ----------
    const named = await pg.evaluate(() => { window.__p.settings.color.namedColors = false; const el = document.createElement('div'); el.innerHTML = '<code>red</code><code>#f00</code><code>oklch(70% 0.2 150)</code>'; window.__run(el); window.__p.settings.color.namedColors = true; return [...el.querySelectorAll('code')].map((c) => c.classList.contains('s-color-inline')); });
    ok(JSON.stringify(named) === '[false,true,true]', 'named off: only the name is ignored ' + JSON.stringify(named));
    console.log('2. named colors setting: ok');

    // ---------- 3. Reading view code blocks (highlighted pieces) ----------
    const blk = await pg.evaluate(async () => {
        const el = document.createElement('div');
        el.innerHTML = '<pre class="language-css"><code class="language-css"><span class="token selector">.a</span> <span class="token punctuation">{</span>\n  <span class="token property">color</span><span class="token punctuation">:</span> red<span class="token punctuation">;</span>\n  <span class="token property">background</span><span class="token punctuation">:</span> <span class="token function">rgb</span><span class="token punctuation">(</span><span class="token number">255</span><span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">,</span> <span class="token number">0</span><span class="token punctuation">)</span><span class="token punctuation">;</span>\n  <span class="token property">border-color</span><span class="token punctuation">:</span> <span class="token color">#0a8</span><span class="token punctuation">;</span>\n  <span class="token property">font-family</span><span class="token punctuation">:</span> gold-sans<span class="token punctuation">;</span>\n<span class="token punctuation">}</span>\n</code></pre><pre class="language-js"><code class="language-js">const a = "#f00"; // red #add feature\nconst b = 0xff0000; const c = "rgb(0, 128, 255)"; const red = 1;\n</code></pre><p><code>plain</code></p>';
        document.body.appendChild(el); const before = [...el.querySelectorAll('pre > code')].map((c) => c.textContent);
        window.__run(el); await new Promise((r) => setTimeout(r, 1500));
        const after = [...el.querySelectorAll('pre > code')].map((c) => c.textContent);
        const sw = [...el.querySelectorAll('pre > code')].map((c) => [...c.querySelectorAll('.s-color-inline-cb')].map((s) => [s.dataset.value, s.nextSibling && s.nextSibling.textContent.slice(0, 6), s.style.getPropertyValue('--color-swatch')]));
        // running the processor again must not add more
        window.__run(el); await new Promise((r) => setTimeout(r, 100));
        const again = [...el.querySelectorAll('.s-color-inline-cb')].length;
        return { before, after, sw, again };
    });
    ok(JSON.stringify(blk.before) === JSON.stringify(blk.after), 'code block text unchanged');
    ok(JSON.stringify(blk.sw[0].map((x) => x[0])) === JSON.stringify(['red', 'rgb(255, 0, 0)', '#0a8']), 'css block colors: ' + JSON.stringify(blk.sw[0].map((x) => x[0])));
    ok(JSON.stringify(blk.sw[1].map((x) => x[0])) === JSON.stringify(['#f00', 'rgb(0, 128, 255)']), 'js block colors (no names, no #add, no 0xff0000): ' + JSON.stringify(blk.sw[1].map((x) => x[0])));
    ok(blk.again === blk.sw[0].length + blk.sw[1].length, 'idempotent');
    console.log('3. code blocks (Reading view):', JSON.stringify(blk.sw.map((l) => l.map((x) => x[0]))));

    // ---------- 4. Live Preview with real CodeMirror ----------
    const doc = ['---', 'title: `red` x', '---', 'Inline `#ff8800` and `oklch(70% 0.2 150)` and `red` and `notacolor` here.', '', '```css', '.a { color: red; background: #fff; border: 1px solid rgb(0 0 0 / .1); }', '.red { margin: 0 } --blue: 1; tan-gent: x;', '```', '', '```js', "const c = '#abc'; // #add no", 'const d = `red`;', '```', '', 'After `rebeccapurple` and `` `x` ``.'].join('\n');
    await pg.evaluate(() => { window.__p.settings.color.codeBlocks = true; });
    const lp = await pg.evaluate(async (d) => { const v = await window.__lp(d, 0); return [...v.dom.querySelectorAll('.cm-line')].map((l) => ({ text: l.textContent, marks: [...l.querySelectorAll('.s-color-inline-mark')].map((m) => m.textContent), widgets: [...l.querySelectorAll('.s-color-inline-cb')].map((w) => w.dataset.value) })); }, doc);
    const line = (needle) => lp.find((l) => l.text.includes(needle)) || {};
    ok(line('Inline').marks.join('|') === '#ff8800|oklch(70% 0.2 150)|red', 'inline marks: ' + line('Inline').marks.join('|'));
    ok(line('title:').marks.length === 0, 'front matter untouched');
    ok(line('.a {').widgets.join('|') === 'red|#fff|rgb(0 0 0 / .1)', 'css line widgets: ' + line('.a {').widgets.join('|'));
    ok(line('.red {').widgets.length === 0, '.red / --blue / tan-gent are not colors: ' + line('.red {').widgets.join('|'));
    ok(line("const c").widgets.join('|') === '#abc', 'js quoted hex ok, #add ignored: ' + line('const c').widgets.join('|'));
    ok(line('const d').widgets.length === 0 && line('const d').marks.length === 0, 'backticks inside a code block are not inline code');
    ok(line('After').marks.join('|') === 'rebeccapurple', 'inline after fences: ' + line('After').marks.join('|'));
    console.log('4. Live Preview: marks + widgets ok');
    // settings off
    const off = await pg.evaluate(async (d) => { window.__p.settings.color.codeBlocks = false; window.__p.settings.color.namedColors = false; window.__p.colorInline.refreshViews(); const v = await window.__lp(d, 0); const r = { w: v.dom.querySelectorAll('.s-color-inline-cb').length, m: [...v.dom.querySelectorAll('.s-color-inline-mark')].map((x) => x.textContent) }; window.__p.settings.color.codeBlocks = true; window.__p.settings.color.namedColors = true; window.__p.colorInline.refreshViews(); return r; }, doc);
    ok(off.w === 0 && off.m.join('|') === '#ff8800|oklch(70% 0.2 150)', 'code blocks off + named off: ' + JSON.stringify(off));
    console.log('   settings off: no widgets, names ignored: ok');

    // ---------- 5. copy ----------
    const copies = await pg.evaluate(async (d) => {
        const out = {}; window.__clip.length = 0; window.__notices.length = 0;
        // Reading: click the swatch of inline code, a code-block swatch; badge mode: click the code
        const el = document.createElement('div'); el.innerHTML = '<p><code>#12ab34</code> <code>teal</code></p><pre class="language-css"><code class="language-css">a { color: hotpink; }</code></pre>'; document.body.appendChild(el);
        window.__run(el); await new Promise((r) => setTimeout(r, 50));
        el.querySelector('.s-color-inline-swatch').click(); await new Promise((r) => setTimeout(r, 20)); out.readingSwatch = [...window.__clip];
        el.querySelector('code:not(pre code)').click(); await new Promise((r) => setTimeout(r, 20)); out.codeClickSwatchMode = [...window.__clip];
        window.__p.settings.color.inlineStyle = 'badge'; el.querySelectorAll('code:not(pre code)')[1].click(); await new Promise((r) => setTimeout(r, 20)); out.badge = [...window.__clip]; window.__p.settings.color.inlineStyle = 'block'; el.querySelectorAll('code:not(pre code)')[1].click(); await new Promise((r) => setTimeout(r, 20)); out.blockText = [...window.__clip].length; el.querySelectorAll('.s-color-inline-swatch')[1].click(); await new Promise((r) => setTimeout(r, 20)); out.blockSwatch = [...window.__clip]; window.__p.settings.color.inlineStyle = 'swatch';
        el.querySelector('.s-color-inline-cb').click(); await new Promise((r) => setTimeout(r, 20)); out.readingBlock = [...window.__clip];
        window.__p.settings.color.copyOnClick = false; el.querySelector('.s-color-inline-swatch').click(); await new Promise((r) => setTimeout(r, 20)); out.disabled = [...window.__clip]; window.__p.settings.color.copyOnClick = true;
        // Live Preview: plain click on inline code does nothing, ctrl+click copies, widget click copies
        await window.__lp(d, 0); const v = window.__view; window.__clip.length = 0;
        const mark = v.dom.querySelector('.s-color-inline-mark');
        mark.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 20)); out.lpPlain = [...window.__clip];
        mark.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })); await new Promise((r) => setTimeout(r, 20)); out.lpCtrl = [...window.__clip];
        v.dom.querySelector('.s-color-inline-cb').click(); await new Promise((r) => setTimeout(r, 20)); out.lpWidget = [...window.__clip];
        out.notices = [...window.__notices]; return out;
    }, doc);
    ok(JSON.stringify(copies.readingSwatch) === '["#12ab34"]', 'reading swatch copies: ' + JSON.stringify(copies.readingSwatch));
    ok(copies.codeClickSwatchMode.length === 1, 'plain click on the code text (swatch mode) does not copy');
    ok(copies.badge[copies.badge.length - 1] === 'teal', 'badge mode: click on badge copies: ' + JSON.stringify(copies.badge));
    ok(copies.blockText === copies.badge.length && copies.blockSwatch[copies.blockSwatch.length - 1] === 'teal', 'big square style: clicking the text does not copy, clicking the square does: ' + JSON.stringify([copies.blockText, copies.blockSwatch]));
    ok(copies.readingBlock[copies.readingBlock.length - 1] === 'hotpink', 'code block swatch copies: ' + JSON.stringify(copies.readingBlock));
    ok(copies.disabled.length === copies.readingBlock.length, 'copy on click off: nothing copied');
    ok(copies.lpPlain.length === 0, 'LP plain click does not copy');
    ok(JSON.stringify(copies.lpCtrl) === '["#ff8800"]', 'LP ctrl+click copies: ' + JSON.stringify(copies.lpCtrl));
    ok(copies.lpWidget[copies.lpWidget.length - 1] === 'red', 'LP code-block swatch click copies: ' + JSON.stringify(copies.lpWidget));
    ok(copies.notices.some((n) => n === 'Copied #ff8800'), 'notice shown');
    console.log('5. click to copy: ok');

    // ---------- 6. command: copy color at cursor ----------
    const cmd = await pg.evaluate(async (d) => {
        const lines = d.split('\n'); const out = [];
        const run = (line, ch) => { window.__clip.length = 0; window.__notices.length = 0; window.__p.cmds['copy-color-at-cursor'].editorCallback({ getCursor: () => ({ line, ch }), getLine: (n) => lines[n] }); return new Promise((r) => setTimeout(() => r([[...window.__clip], [...window.__notices]]), 30)); };
        out.push(await run(3, 14)); // inside `#ff8800`
        out.push(await run(3, 1));  // plain text
        out.push(await run(6, 12)); // on `red` in the css block
        out.push(await run(6, 60)); // on rgb(0 0 0 / .1)
        out.push(await run(11, 3)); // js line, no color at 3
        out.push(await run(1, 8));  // front matter
        return out;
    }, doc);
    ok(cmd[0][0][0] === '#ff8800', 'cmd on inline code: ' + JSON.stringify(cmd[0]));
    ok(cmd[1][0].length === 0 && cmd[1][1][0] === 'No color at the cursor.', 'cmd on plain text: ' + JSON.stringify(cmd[1]));
    ok(cmd[2][0][0] === 'red', 'cmd on css name: ' + JSON.stringify(cmd[2]));
    ok(cmd[3][0][0] === 'rgb(0 0 0 / .1)', 'cmd on css function: ' + JSON.stringify(cmd[3]));
    ok(cmd[4][0].length === 0 && cmd[5][0].length === 0, 'cmd with no color / in front matter does nothing');
    console.log('6. command copy at cursor: ok');

    // ---------- 7. settings stay upgrade-safe ----------
    const st = await pg.evaluate(async (c) => { const p = window.__make(c, { badgeMode: true }); await p.onload(); return p.settings.color; }, code);
    ok(st.inlineStyle === 'badge' && st.namedColors === true && st.codeBlocks === true && st.copyOnClick === true, 'old data.json (badgeMode only) keeps badgeMode and gets new defaults: ' + JSON.stringify(st));
    console.log('7. old settings file still works: ok');

    await b.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL TESTS PASS');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
