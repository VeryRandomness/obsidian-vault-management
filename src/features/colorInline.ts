import { Editor, MarkdownView, Notice } from "obsidian";
import { ColorMatch, LineScanner, findColorsInCode, resolveColor } from "./color";
import type { ColorSettings, Host } from "../settings";

// CodeMirror 6 (Live Preview)
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { Extension, RangeSetBuilder } from "@codemirror/state";

// Body classes that switch styles.css between swatch, badge and big-square style, and show a pointer over clickable swatches
const BADGE_CLASS = "s-color-inline-badge";
const BLOCK_CLASS = "s-color-inline-block";
const COPY_CLASS = "s-color-inline-copy";

type CopyFn = (value: string) => void;

// A swatch drawn before a color inside a code block (Live Preview)
class SwatchWidget extends WidgetType {
	constructor(private readonly value: string, private readonly css: string, private readonly copy: CopyFn) {
		super();
	}

	eq(other: SwatchWidget): boolean {
		return other.value === this.value && other.css === this.css;
	}

	toDOM(): HTMLElement {
		const el = document.createElement("span");
		el.className = "s-color-inline-cb";
		el.dataset.value = this.value;
		el.setAttribute("aria-label", `Color swatch ${this.value}`);
		el.style.setProperty("--color-swatch", this.css);
		el.addEventListener("mousedown", (e) => e.preventDefault());
		el.addEventListener("click", (e) => {
			e.preventDefault();
			this.copy(this.value);
		});
		return el;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

// Live Preview: marks inline code that is a color, and puts a swatch before
// colors in code blocks. Only the visible part of the note is decorated.
function colorExtension(feature: ColorInline): Extension {
	const codeRegex = /`([^`]+)`/g;

	function build(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		const settings = feature.settings;
		const doc = view.state.doc;
		const ranges = view.visibleRanges;
		const end = ranges.reduce((a, r) => Math.max(a, r.to), 0);
		const inView = (from: number, to: number) => ranges.some((r) => to >= r.from && from <= r.to);
		const scanner = new LineScanner();
		const copy: CopyFn = (value) => feature.copyColor(value);

		for (let n = 1; n <= doc.lines; n++) {
			const line = doc.line(n);
			if (line.from > end) break;
			const kind = scanner.next(line.text);
			if (kind.kind === "skip" || !inView(line.from, line.to)) continue;

			if (kind.kind === "code") {
				if (!settings.codeBlocks) continue;
				for (const m of findColorsInCode(line.text, kind.lang, settings.namedColors)) {
					builder.add(line.from + m.start, line.from + m.start, Decoration.widget({
						widget: new SwatchWidget(m.value, m.color.css, copy),
						side: -1,
					}));
				}
				continue;
			}

			codeRegex.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = codeRegex.exec(line.text)) !== null) {
				const inner = match[1];
				if (!inner) continue;

				const color = resolveColor(inner, { named: settings.namedColors });
				if (!color) continue;

				// Mark only the inner text (without backticks)
				const from = line.from + match.index + 1;
				builder.add(from, from + inner.length, Decoration.mark({
					class: "s-color-inline-mark",
					attributes: { style: `--color-swatch: ${color.css}; --color-swatch-text: ${color.text};` },
				}));
			}
		}

		return builder.finish();
	}

	const swatches = ViewPlugin.fromClass(class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = build(view);
		}

		update(update: ViewUpdate): void {
			if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
		}
	}, { decorations: (v) => v.decorations });

	// Ctrl/Cmd+click on a colored inline code copies it. A plain click still edits the text.
	const clicks = EditorView.domEventHandlers({
		click(event) {
			if (!feature.settings.copyOnClick || !(event.ctrlKey || event.metaKey)) return false;
			const target = event.target instanceof Element ? event.target.closest(".s-color-inline-mark") : null;
			const value = target?.textContent?.trim();
			if (!value) return false;
			feature.copyColor(value);
			return true;
		},
	});

	return [swatches, clicks];
}

// Padding the installed theme gives Live Preview inline code, read from a
// hidden copy of the editor markup
function readThemeCodePadding(): string {
	const probe = document.body.createDiv({ cls: "s-color-inline-probe markdown-source-view cm-s-obsidian mod-cm6 is-live-preview" });
	const code = probe
		.createDiv({ cls: "cm-editor" })
		.createDiv({ cls: "cm-content" })
		.createDiv({ cls: "cm-line" })
		.createSpan({ cls: "cm-inline-code", text: "#000" });
	const padding = getComputedStyle(code).padding;
	probe.remove();
	return padding;
}

function languageOf(code: Element): string {
	for (const el of [code, code.parentElement]) {
		const cls = Array.from(el?.classList ?? []).find((c) => c.startsWith("language-"));
		if (cls) return cls.slice("language-".length).toLowerCase();
	}
	return "";
}

// Color swatches: next to colors in inline code and in code blocks, in
// Live Preview and Reading view, with click to copy.
export class ColorInline {
	private editorExtensions: Extension[] = [];

	constructor(private readonly plugin: Host) {}

	get settings(): ColorSettings {
		return this.plugin.settings.color;
	}

	setup(): void {
		const plugin = this.plugin;
		this.applyMode();

		// Reading view (rendered HTML) and Live Preview (CodeMirror 6)
		plugin.registerMarkdownPostProcessor((el) => this.decorateReading(el));

		this.editorExtensions.push(colorExtension(this));
		plugin.registerEditorExtension(this.editorExtensions);

		plugin.addCommand({
			id: "copy-color-at-cursor",
			name: "Copy color at cursor",
			editorCallback: (editor) => this.copyAtCursor(editor),
		});

		// Popout windows have their own <body>; theme or snippet changes can
		// change the inline code padding
		plugin.registerEvent(plugin.app.workspace.on("window-open", () => this.applyMode()));
		plugin.registerEvent(plugin.app.workspace.on("css-change", () => this.applyMode()));
	}

	unload(): void {
		this.bodies().forEach((body) => {
			body.removeClass(BADGE_CLASS);
			body.removeClass(BLOCK_CLASS);
			body.removeClass(COPY_CLASS);
		});
	}

	// Reading view: swatches for colored inline code, and for colors in code blocks
	private decorateReading(el: HTMLElement): void {
		el.querySelectorAll("code:not(pre code)").forEach((codeEl) => {
			if (!codeEl.instanceOf(HTMLElement)) return;
			if (codeEl.querySelector(".s-color-inline-swatch")) return;

			const text = (codeEl.textContent ?? "").trim();
			const color = resolveColor(text, { named: this.settings.namedColors });
			if (!color) return;

			// Both modes are always rendered; the body class decides which one shows
			codeEl.addClass("s-color-inline");
			codeEl.setCssProps({
				"--color-swatch": color.css,
				"--color-swatch-text": color.text,
			});
			const swatch = codeEl.createSpan({
				cls: "s-color-inline-swatch",
				attr: { "aria-label": `Color swatch ${color.css}` },
			});
			const copy = (e: MouseEvent) => {
				if (!this.settings.copyOnClick) return;
				e.preventDefault();
				this.copyColor(text);
			};
			swatch.addEventListener("click", copy);
			// in badge mode the whole badge is the color, so it copies too
			codeEl.addEventListener("click", (e) => {
				if (this.settings.inlineStyle === "badge") copy(e);
			});
		});

		if (!this.settings.codeBlocks) return;
		el.querySelectorAll("pre > code").forEach((codeEl) => {
			if (!codeEl.instanceOf(HTMLElement)) return;
			// the syntax highlighter can rebuild the block after this runs, so look again shortly after
			for (const delay of [0, 300, 1200]) {
				window.setTimeout(() => {
					if (codeEl.isConnected) this.decorateCodeBlock(codeEl);
				}, delay);
			}
		});
	}

	// Put a swatch before each color in a rendered code block. Matches are
	// found in the block's whole text, so a color split over highlighted
	// pieces (rgb ( 255 ...) is still found; swatches go in from the end so the
	// earlier positions stay valid.
	private decorateCodeBlock(code: HTMLElement): void {
		if (code.querySelector(".s-color-inline-cb")) return;
		const text = code.textContent ?? "";
		if (!text) return;
		const matches = findColorsInCode(text, languageOf(code), this.settings.namedColors);
		if (!matches.length) return;

		const nodes: { node: Text; start: number; length: number }[] = [];
		const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
		let pos = 0;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const node = n as Text;
			nodes.push({ node, start: pos, length: node.length });
			pos += node.length;
		}
		for (let i = matches.length - 1; i >= 0; i--) {
			const m = matches[i] as ColorMatch;
			const entry = nodes.find((x) => m.start >= x.start && m.start < x.start + x.length);
			if (!entry) continue;
			const offset = m.start - entry.start;
			const ref = offset === 0 ? entry.node : entry.node.splitText(offset);
			const swatch = document.createElement("span");
			swatch.className = "s-color-inline-cb";
			swatch.dataset.value = m.value;
			swatch.setAttribute("aria-label", `Color swatch ${m.value}`);
			swatch.style.setProperty("--color-swatch", m.color.css);
			swatch.addEventListener("click", (e) => {
				if (!this.settings.copyOnClick) return;
				e.preventDefault();
				this.copyColor(m.value);
			});
			ref.parentNode?.insertBefore(swatch, ref);
		}
	}

	copyColor(value: string): void {
		navigator.clipboard.writeText(value).then(
			() => new Notice(`Copied ${value}`),
			() => new Notice("Could not copy to the clipboard.")
		);
	}

	// The command: copy the color the cursor is in (inline code or a code block)
	private copyAtCursor(editor: Editor): void {
		const cursor = editor.getCursor();
		const scanner = new LineScanner();
		let kind = scanner.next(editor.getLine(0));
		for (let n = 1; n <= cursor.line; n++) kind = scanner.next(editor.getLine(n));
		const text = editor.getLine(cursor.line);
		let found: string | null = null;

		if (kind.kind === "text") {
			const codeRegex = /`([^`]+)`/g;
			let m: RegExpExecArray | null;
			while ((m = codeRegex.exec(text)) !== null) {
				if (cursor.ch < m.index || cursor.ch > m.index + m[0].length) continue;
				if (resolveColor(m[1] ?? "", { named: this.settings.namedColors })) found = (m[1] ?? "").trim();
				break;
			}
		} else if (kind.kind === "code") {
			const at = findColorsInCode(text, kind.lang, this.settings.namedColors)
				.find((c) => cursor.ch >= c.start && cursor.ch <= c.end);
			if (at) found = at.value;
		}

		if (found) this.copyColor(found);
		else new Notice("No color at the cursor.");
	}

	// Set the mode classes on the main window and every popout window, plus
	// the theme's inline code padding (badge mode clears it on the wrapper
	// and redraws it on the mark, see styles.css)
	applyMode(): void {
		const padding = readThemeCodePadding();
		this.bodies().forEach((body) => {
			body.toggleClass(BADGE_CLASS, this.settings.inlineStyle === "badge");
			body.toggleClass(BLOCK_CLASS, this.settings.inlineStyle === "block");
			body.toggleClass(COPY_CLASS, this.settings.copyOnClick);
			body.setCssProps({ "--s-color-inline-padding": padding });
		});
	}

	// Editors and Reading views pick the settings up again
	refreshViews(): void {
		this.editorExtensions.length = 0;
		this.editorExtensions.push(colorExtension(this));
		this.plugin.app.workspace.updateOptions();
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) leaf.view.previewMode?.rerender(true);
		});
	}

	// Called after a color setting changes in the settings tab
	settingsChanged(): void {
		this.applyMode();
		this.refreshViews();
	}

	private bodies(): Set<HTMLElement> {
		const bodies = new Set<HTMLElement>([document.body]);
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			bodies.add(leaf.view.containerEl.doc.body);
		});
		return bodies;
	}
}
