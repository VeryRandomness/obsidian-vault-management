import { editorLivePreviewField } from "obsidian";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { Host } from "../settings";

// Comparison symbols: >= and <= are shown as ≥ and ≤. Only the look changes;
// the note keeps what you typed. In Live Preview each pair is drawn as one
// character (the cursor steps over it and Backspace removes both), and a
// selection over it shows the typed text. Code, math, the properties and
// Source mode are left alone. Reading view shows the same symbols.

const SYMBOL: Record<string, string> = { ">=": "≥", "<=": "≤" };
// not part of a longer arrow or operator such as <=>, <== or >>=
const PAIR = /(?<![<>=])[<>]=(?![=>])/g;
const FENCE = /^\s*(`{3,}|~{3,})/;
// inline code and inline math, as [from, to) offsets in a line
const SKIP = /(`+)[\s\S]*?\1|\$[^$\s](?:[^$]*[^$\s])?\$/g;
const QUOTE = /^[\s>]*$/;

class SymbolWidget extends WidgetType {
	constructor(readonly text: string) {
		super();
	}
	eq(other: SymbolWidget): boolean {
		return other.text === this.text;
	}
	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "vm-symbol";
		span.textContent = this.text;
		return span;
	}
}
const WIDGETS = Object.fromEntries(Object.entries(SYMBOL).map(([k, v]) => [k, Decoration.replace({ widget: new SymbolWidget(v) })]));

// the pairs to show as symbols in one line of source: [offset, pair]
function findPairs(text: string): [number, string][] {
	const skip: [number, number][] = [];
	for (const m of text.matchAll(SKIP)) skip.push([m.index, m.index + m[0].length]);
	const out: [number, string][] = [];
	for (const m of text.matchAll(PAIR)) {
		const at = m.index;
		if (skip.some(([a, b]) => at >= a && at < b)) continue;
		// a ">" with only quote marks before it starts a quote, not a comparison
		if (m[0][0] === ">" && QUOTE.test(text.slice(0, at))) continue;
		out.push([at, m[0]]);
	}
	return out;
}

class SymbolView {
	decorations: DecorationSet = Decoration.none;
	lp: boolean | undefined;

	constructor(view: EditorView) {
		this.lp = view.state.field(editorLivePreviewField, false);
		this.build(view);
	}

	update(u: ViewUpdate): void {
		const lp = u.state.field(editorLivePreviewField, false);
		if (u.docChanged || u.selectionSet || u.viewportChanged || lp !== this.lp) {
			this.lp = lp;
			this.build(u.view);
		}
	}

	build(view: EditorView): void {
		const out = new RangeSetBuilder<Decoration>();
		if (view.state.field(editorLivePreviewField, false) !== false) {
			const { doc, selection } = view.state;
			const ranges = view.visibleRanges;
			const end = ranges.reduce((a, r) => Math.max(a, r.to), 0);
			const inView = (from: number, to: number) => ranges.some((r) => to >= r.from && from <= r.to);
			const selected = (from: number, to: number) => selection.ranges.some((r) => !r.empty && r.from < to && r.to > from);
			let n = 1;
			if (doc.line(1).text.trim() === "---") {
				// skip the properties
				for (let i = 2; i <= doc.lines; i++) {
					if (doc.line(i).text.trim() === "---") {
						n = i + 1;
						break;
					}
				}
			}
			let fence = "";
			let math = false;
			for (; n <= doc.lines; n++) {
				const line = doc.line(n);
				if (line.from > end) break;
				const f = FENCE.exec(line.text);
				if (f) {
					// code blocks are left alone
					if (!fence) fence = f[1]![0]!;
					else if (f[1]![0] === fence) fence = "";
					continue;
				}
				if (fence) continue;
				// math blocks too
				const blocks = (line.text.match(/\$\$/g) || []).length;
				if (math || blocks) {
					if (blocks % 2) math = !math;
					continue;
				}
				if (!inView(line.from, line.to)) continue;
				for (const [at, pair] of findPairs(line.text)) {
					const from = line.from + at;
					if (!selected(from, from + 2)) out.add(from, from + 2, WIDGETS[pair]!);
				}
			}
		}
		this.decorations = out.finish();
	}
}

const symbolPlugin = ViewPlugin.fromClass(SymbolView, {
	decorations: (v) => v.decorations,
	provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
});

// Reading view: every text node outside code and math
function restyle(el: HTMLElement): void {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const hits: Text[] = [];
	for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
		if (!/[<>]=/.test(n.nodeValue ?? "")) continue;
		if (n.parentElement?.closest("code, pre, .math, mjx-container, script, style")) continue;
		hits.push(n);
	}
	for (const n of hits) n.nodeValue = (n.nodeValue ?? "").replace(PAIR, (m) => SYMBOL[m] ?? m);
}

export function setupSymbols(plugin: Host): void {
	plugin.registerEditorExtension(symbolPlugin);
	plugin.registerMarkdownPostProcessor(restyle);
}

/* for tests outside Obsidian */
export const _test = { findPairs, restyle };
