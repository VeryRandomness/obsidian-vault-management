'use strict';
/* Bullet Variants: only changes how bullets look, never the file.
     + text      a plus sign
     - |-> text  the arrow (down, then right)
     - => text   moved (a right arrow)
     - ? text    a question mark
   Live Preview: a line decoration restyles the bullet, and the typed token
   is hidden until the cursor is on that line. Reading view: a post
   processor does the same to the rendered list item. The "Cycle bullet
   style" command (Shift+Alt+8) changes the typed marker to the next one. */
import { Notice, editorLivePreviewField } from 'obsidian';
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const TOKENS = { '|->': 'arrow', '=>': 'moved', '?': 'question' };
/* [quote prefix and indent] - [space] token (then a space or the line end) [spaces] */
const TOKEN_LINE = /^((?:>\s?)*\s*)-(\s+)(\|->|=>|\?)(?=\s|$)(\s*)/;
const PLUS_LINE = /^(?:>\s?)*\s*\+\s/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const HIDE = Decoration.replace({});

/* the variant of a source line: {kind, from, to} (from/to = the token and
   the spaces after it, as offsets in the line) or null */
function classify(text) {
    const m = TOKEN_LINE.exec(text);
    if (m) {
        const from = m[1].length + 1 + m[2].length;
        return { kind: TOKENS[m[3]], from, to: from + m[3].length + m[4].length };
    }
    if (PLUS_LINE.test(text))
        return { kind: 'plus' };
    return null;
}

class BulletView {
    constructor(view) {
        this.build(view);
        this.lp = view.state.field(editorLivePreviewField, false);
    }

    update(u) {
        const lp = u.state.field(editorLivePreviewField, false);
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || lp !== this.lp) {
            this.lp = lp;
            this.build(u.view);
        }
    }

    build(view) {
        const all = new RangeSetBuilder();
        const atomic = new RangeSetBuilder();
        if (view.state.field(editorLivePreviewField, false) !== false) {
            const doc = view.state.doc;
            const ranges = view.visibleRanges;
            const end = ranges.reduce((a, r) => Math.max(a, r.to), 0);
            const inView = (line) => ranges.some((r) => line.to >= r.from && line.from <= r.to);
            /* lines the cursor or selection is on show the typed token */
            const active = new Set();
            for (const r of view.state.selection.ranges)
                for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++)
                    active.add(n);
            let n = 1;
            if (doc.line(1).text.trim() === '---') { /* skip the properties */
                for (let i = 2; i <= doc.lines; i++) {
                    if (doc.line(i).text.trim() === '---') {
                        n = i + 1;
                        break;
                    }
                }
            }
            let fence = '';
            for (; n <= doc.lines; n++) {
                const line = doc.line(n);
                if (line.from > end)
                    break;
                const f = FENCE.exec(line.text);
                if (f) { /* code blocks are left alone */
                    if (!fence)
                        fence = f[1][0];
                    else if (f[1][0] === fence)
                        fence = '';
                    continue;
                }
                if (fence || !inView(line))
                    continue;
                const hit = classify(line.text);
                if (!hit)
                    continue;
                all.add(line.from, line.from, Decoration.line({ class: 'bv-' + hit.kind }));
                if (hit.to !== undefined && !active.has(n)) {
                    all.add(line.from + hit.from, line.from + hit.to, HIDE);
                    atomic.add(line.from + hit.from, line.from + hit.to, HIDE);
                }
            }
        }
        this.decorations = all.finish();
        this.atomic = atomic.finish();
    }
}

const bulletPlugin = ViewPlugin.fromClass(BulletView, {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => (view.plugin(p) || {}).atomic || Decoration.none)
});

/* Reading view */
function firstTextNode(li) {
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeValue.trim() === '')
            continue;
        const p = n.parentElement;
        /* the item's own first words, not a link, code or a sub-list */
        return p && (p === li || p.tagName === 'P') && p.closest('li') === li ? n : null;
    }
    return null;
}

function tokenOf(node) {
    const m = /^\s*(\|->|=>|\?)(\s+|$)/.exec(node.nodeValue);
    if (!m || (!m[2] && node.nextSibling))
        return null;
    return { kind: TOKENS[m[1]], length: m[0].length };
}

function restyle(el, ctx) {
    const info = ctx.getSectionInfo(el);
    const src = info ? info.text.split('\n') : null;
    for (const li of el.querySelectorAll('ul > li')) {
        if (li.classList.contains('task-list-item') || /\bbv-/.test(li.className))
            continue;
        const line = src && li.dataset.line !== undefined ? src[info.lineStart + Number(li.dataset.line)] : undefined;
        const hit = line === undefined ? null : classify(line);
        if (hit && hit.kind === 'plus') {
            li.classList.add('bv-plus');
            continue;
        }
        if (line !== undefined && !hit)
            continue; /* the source says this is a plain bullet */
        const node = firstTextNode(li);
        const tok = node && tokenOf(node);
        if (!tok || (hit && hit.kind !== tok.kind))
            continue;
        node.nodeValue = node.nodeValue.slice(tok.length);
        li.classList.add('bv-' + tok.kind);
    }
}

/* Cycling: plain -> + -> |-> -> => -> ? -> plain */
const ORDER = ['plain', 'plus', 'arrow', 'moved', 'question'];
const MARK = { plain: '- ', plus: '+ ', arrow: '- |-> ', moved: '- => ', question: '- ? ' };
const LIST_LINE = /^((?:>\s?)*\s*)([-+*])(\s+)((?:\|->|=>|\?)(?:\s+|$))?/;
const RULE = /^\s*(?:>\s?)*([-*_])(\s*\1){2,}\s*$/;

/* the marker of a list line: {kind, start, end} (the marker, its space and
   any token, as offsets in the line), or null for anything else: other
   lines, numbered lists, tasks and horizontal rules */
function parseMarker(text) {
    if (RULE.test(text))
        return null;
    const m = LIST_LINE.exec(text);
    if (!m)
        return null;
    const tok = m[2] === '-' ? m[4] : undefined;
    const start = m[1].length;
    const end = start + 1 + m[3].length + (tok ? tok.length : 0);
    if (!tok && /^\[[^\]]\](\s|$)/.test(text.slice(end)))
        return null;
    return { kind: tok ? TOKENS[tok.trim()] : m[2] === '+' ? 'plus' : 'plain', start, end };
}

function cycleBullets(editor) {
    const lines = new Set();
    for (const s of editor.listSelections()) {
        const a = Math.min(s.anchor.line, s.head.line), b = Math.max(s.anchor.line, s.head.line);
        for (let n = a; n <= b; n++)
            lines.add(n);
    }
    const hits = [...lines].sort((x, y) => x - y)
        .map((line) => ({ line, hit: parseMarker(editor.getLine(line)) })).filter((x) => x.hit);
    if (!hits.length) {
        new Notice('Bullet Variants: no bullet on this line.');
        return;
    }
    /* one target for the whole selection, from its first bullet */
    const mark = MARK[ORDER[(ORDER.indexOf(hits[0].hit.kind) + 1) % ORDER.length]];
    const cur = editor.listSelections().length === 1 ? editor.getCursor('head') : null;
    const sel = cur && editor.somethingSelected() ? null : cur;
    for (const { line, hit } of hits)
        editor.replaceRange(mark, { line, ch: hit.start }, { line, ch: hit.end });
    const own = sel && hits.find((x) => x.line === sel.line);
    if (own && sel.ch >= own.hit.start) { /* keep the cursor where it was in the text */
        const ch = sel.ch <= own.hit.end ? own.hit.start + mark.length
            : sel.ch + mark.length - (own.hit.end - own.hit.start);
        editor.setCursor({ line: sel.line, ch });
    }
}

export function setupBullets(plugin) {
    plugin.registerEditorExtension(bulletPlugin);
    plugin.registerMarkdownPostProcessor(restyle);
    plugin.addCommand({
        id: 'cycle-bullet',
        name: 'Cycle bullet style',
        hotkeys: [{ modifiers: ['Shift', 'Alt'], key: '8' }],
        editorCallback: (editor) => cycleBullets(editor)
    });
}

/* for tests outside Obsidian */
export const _test = { classify, restyle, parseMarker, cycleBullets, MARK, ORDER };
