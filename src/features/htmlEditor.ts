import { FuzzySuggestModal, Notice, Platform, TFolder, TextFileView, WorkspaceLeaf } from "obsidian";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { html } from "@codemirror/lang-html";
import { classHighlighter } from "@lezer/highlight";
import type { Host } from "../settings";

// HTML editor: .html files open in Obsidian with a code editor (HTML, CSS and
// JavaScript colours, autosave) and a live preview. The preview runs in a sealed
// frame: the page's scripts run, but can't reach Obsidian or the vault. Each HTML
// file can have an "images folder": links in the page like /favicon.svg or
// img/photo.jpg are shown from that folder, also when the page's scripts add them.

export const HTML_VIEW = "vm-html-editor";

export type Layout = "split" | "editor" | "preview";

export interface HtmlEditorSettings {
	// how a file opens (phones always open on the editor, with a button for the preview)
	layout: Layout;
	// let the page's own scripts run in the preview (needed for pages built by JavaScript)
	runScripts: boolean;
	// HTML file path -> vault folder its links point into
	assetFolders: Record<string, string>;
}

export const DEFAULT_HTML_EDITOR: HtmlEditorSettings = { layout: "split", runScripts: true, assetFolders: {} };

// ── Links in the page → files in the vault ──────────────────────────────────────

/** Every file in the images folder, keyed the ways a page can link to it. */
export function assetMap(files: { path: string }[], folder: string, resource: (path: string) => string): Record<string, string> {
	const root = folder.replace(/^\/+|\/+$/g, "");
	const map: Record<string, string> = {};
	if (!root) return map;
	for (const f of files) {
		if (!f.path.startsWith(root + "/")) continue;
		const rel = f.path.slice(root.length + 1);
		const url = resource(f.path);
		for (const k of [rel, "/" + rel, "./" + rel]) map[k] = url;
	}
	return map;
}

/** Runs first inside the preview: points local links at the vault files, including links
 *  the page's own scripts add later, reports script errors, and reports the scroll position
 *  so a refresh keeps it. It is kept on one line, on the same line as <head>, so the line
 *  numbers of errors match the file. */
function previewScript(map: Record<string, string>, scrollY: number): string {
	return (`<script data-vm-preview>(function(){
window.addEventListener('error',function(e){parent.postMessage({vmPreviewError:{message:String(e.message||'Script error'),line:e.lineno||0,col:e.colno||0}},'*')});
var M=${JSON.stringify(map).replace(/</g, "\\u003c")};
function fix(v){if(!v)return v;var k=v.split(/[?#]/)[0];try{k=decodeURI(k)}catch(e){}return M[k]||M[k.replace(/^\\.\\//,'')]||v}
function fixSet(v){return v.split(',').map(function(p){var s=p.trim().split(/\\s+/);s[0]=fix(s[0]);return s.join(' ')}).join(', ')}
function fixCss(v){return v.replace(/url\\((['"]?)([^'")]+)\\1\\)/g,function(m,q,u){return 'url('+q+fix(u)+q+')'})}
function el(e){if(!e||e.nodeType!==1)return;['src','href','poster','data-src'].forEach(function(a){var v=e.getAttribute(a);if(v){var w=fix(v);if(w!==v)e.setAttribute(a,w)}});var s=e.getAttribute('srcset');if(s){var t=fixSet(s);if(t!==s)e.setAttribute('srcset',t)}var st=e.getAttribute('style');if(st&&st.indexOf('url(')>-1){var u=fixCss(st);if(u!==st)e.setAttribute('style',u)}if(e.tagName==='STYLE'&&e.textContent.indexOf('url(')>-1){var c=fixCss(e.textContent);if(c!==e.textContent)e.textContent=c}}
function all(r){el(r);if(r.querySelectorAll)r.querySelectorAll('*').forEach(el)}
new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==='attributes')el(m.target);else m.addedNodes.forEach(all)})}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','srcset','style','poster','data-src']});
document.addEventListener('DOMContentLoaded',function(){all(document.documentElement);window.scrollTo(0,${Math.max(0, Math.round(scrollY))})});
window.addEventListener('load',function(){window.scrollTo(0,${Math.max(0, Math.round(scrollY))})});
var t;window.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({vmPreviewScroll:window.scrollY},'*')},100)});
})();</script>`).replace(/\n/g, "");
}

/** The page as the preview shows it: the helper script goes in first. */
export function previewDocument(source: string, map: Record<string, string>, scrollY = 0): string {
	const script = previewScript(map, scrollY);
	const head = /<head[^>]*>/i.exec(source);
	if (head) return source.slice(0, head.index + head[0].length) + script + source.slice(head.index + head[0].length);
	const htmlTag = /<html[^>]*>/i.exec(source);
	if (htmlTag) return source.slice(0, htmlTag.index + htmlTag[0].length) + "<head>" + script + "</head>" + source.slice(htmlTag.index + htmlTag[0].length);
	return script + source;
}

// ── The view ──────────────────────────────────────────────────────────────────

class FolderModal extends FuzzySuggestModal<TFolder> {
	constructor(private readonly feature: HtmlEditor, private readonly onPick: (f: TFolder) => void) {
		super(feature.plugin.app);
		this.setPlaceholder("Folder the page's images are in…");
	}

	getItems(): TFolder[] {
		return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !f.isRoot());
	}

	getItemText(f: TFolder): string {
		return f.path;
	}

	onChooseItem(f: TFolder): void {
		this.onPick(f);
	}
}

export class HtmlView extends TextFileView {
	editor: EditorView | null = null;
	private editorEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private frame: HTMLIFrameElement | null = null;
	private layout: Layout;
	private scrollY = 0;
	private timer: number | null = null;
	private settingDoc = false;

	constructor(leaf: WorkspaceLeaf, private readonly feature: HtmlEditor) {
		super(leaf);
		this.layout = Platform.isPhone ? "editor" : feature.settings.layout;
	}

	getViewType(): string {
		return HTML_VIEW;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "HTML";
	}

	getIcon(): string {
		return "code-xml";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("vm-html");
		this.editorEl = this.contentEl.createDiv({ cls: "vm-html-editor" });
		this.previewEl = this.contentEl.createDiv({ cls: "vm-html-preview" });
		this.addAction("folder-open", "Images folder for this page", () => this.pickFolder());
		this.addAction("refresh-cw", "Reload the preview", () => this.renderPreview());
		this.addAction("columns-2", "Editor and preview side by side", () => this.setLayout("split"));
		this.addAction("eye", "Preview only", () => this.setLayout("preview"));
		this.addAction("code-xml", "Editor only", () => this.setLayout("editor"));
		this.registerDomEvent(window, "message", (e: MessageEvent) => {
			if (!this.frame || e.source !== this.frame.contentWindow) return;
			if (typeof e.data?.vmPreviewScroll === "number") this.scrollY = e.data.vmPreviewScroll;
			else if (e.data?.vmPreviewError) this.showError(e.data.vmPreviewError);
		});
		this.editor = new EditorView({
			parent: this.editorEl,
			state: this.makeState(""),
		});
		this.applyLayout();
	}

	async onClose(): Promise<void> {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.editor?.destroy();
		this.editor = null;
	}

	private makeState(doc: string): EditorState {
		return EditorState.create({
			doc,
			extensions: [
				lineNumbers(),
				history(),
				drawSelection(),
				highlightActiveLine(),
				highlightSelectionMatches(),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				html(),
				syntaxHighlighting(classHighlighter),
				EditorView.lineWrapping,
				keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
				EditorView.updateListener.of((u) => {
					if (!u.docChanged || this.settingDoc) return;
					this.requestSave();
					this.schedulePreview();
				}),
			],
		});
	}

	getViewData(): string {
		return this.editor ? this.editor.state.doc.toString() : this.data;
	}

	setViewData(data: string, clear: boolean): void {
		if (!this.editor) return;
		this.settingDoc = true;
		try {
			if (clear) this.editor.setState(this.makeState(data));
			else if (data !== this.editor.state.doc.toString()) this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: data } });
		} finally {
			this.settingDoc = false;
		}
		if (clear) this.scrollY = 0;
		this.renderPreview();
	}

	clear(): void {
		this.setViewData("", true);
	}

	setLayout(layout: Layout): void {
		this.layout = layout;
		this.applyLayout();
	}

	get currentLayout(): Layout {
		return this.layout;
	}

	private applyLayout(): void {
		for (const l of ["split", "editor", "preview"]) this.contentEl.toggleClass("is-" + l, l === this.layout);
		if (this.layout !== "editor") this.renderPreview();
	}

	private schedulePreview(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => { this.timer = null; this.renderPreview(); }, 400);
	}

	/** Rebuilds the preview from the editor's text. */
	renderPreview(): void {
		if (!this.previewEl || this.layout === "editor") return;
		const folder = this.file ? this.feature.folderFor(this.file.path) : "";
		const adapter = this.app.vault.adapter;
		const map = assetMap(this.app.vault.getFiles(), folder, (p) => adapter.getResourcePath(p));
		const frame = document.createElement("iframe");
		frame.addClass("vm-html-frame");
		// scripts may run, but without allow-same-origin the page can't reach Obsidian or the vault
		frame.setAttribute("sandbox", this.feature.settings.runScripts ? "allow-scripts" : "");
		frame.setAttribute("referrerpolicy", "no-referrer");
		frame.srcdoc = previewDocument(this.getViewData(), map, this.scrollY);
		this.previewEl.empty();
		if (!folder && /\b(?:src|href)\s*=\s*["']?\/?(?!\/|[a-z][a-z0-9+.-]*:|#)[^"'\s>]+\.(?:png|jpe?g|gif|svg|webp|ico|avif)/i.test(this.getViewData())) {
			const hint = this.previewEl.createDiv({ cls: "vm-html-hint", text: "This page links to images. Pick the folder they're in so the preview can show them: " });
			hint.createEl("a", { text: "choose images folder", href: "#" }).onclick = (e) => { e.preventDefault(); this.pickFolder(); };
		}
		this.previewEl.appendChild(frame);
		this.frame = frame;
	}

	/** The page's script failed: say where, once per refresh (later errors usually follow from the first). */
	showError(err: { message: string; line: number }): void {
		if (!this.previewEl || this.previewEl.querySelector(".vm-html-error")) return;
		const box = createDiv({ cls: "vm-html-error" });
		const line = err.line > 0 && this.editor && err.line <= this.editor.state.doc.lines ? err.line : 0;
		box.createSpan({ text: line ? `Script error on line ${line}: ${err.message}` : `Script error: ${err.message}` });
		box.createSpan({ cls: "vm-html-error-note", text: " The page stops at the error, so parts of it may be missing." });
		if (line) {
			const go = box.createEl("button", { text: "Go to line " + line });
			go.onclick = () => this.goToLine(line);
		}
		this.previewEl.insertBefore(box, this.previewEl.firstChild);
	}

	goToLine(line: number): void {
		if (!this.editor) return;
		if (this.layout === "preview") this.setLayout(Platform.isPhone ? "editor" : "split");
		const l = this.editor.state.doc.line(Math.min(Math.max(1, line), this.editor.state.doc.lines));
		this.editor.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
		this.editor.focus();
	}

	private pickFolder(): void {
		if (!this.file) return;
		const path = this.file.path;
		new FolderModal(this.feature, async (f) => {
			await this.feature.setFolder(path, f.path);
			new Notice(`Images for ${this.file?.name ?? "this page"} now come from ${f.path}`);
			this.renderPreview();
		}).open();
	}
}

// ── The feature ───────────────────────────────────────────────────────────────

export class HtmlEditor {
	constructor(readonly plugin: Host) {}

	get settings(): HtmlEditorSettings {
		return this.plugin.settings.htmlEditor;
	}

	folderFor(htmlPath: string): string {
		return this.settings.assetFolders[htmlPath] ?? "";
	}

	async setFolder(htmlPath: string, folder: string | null): Promise<void> {
		if (folder) this.settings.assetFolders[htmlPath] = folder;
		else delete this.settings.assetFolders[htmlPath];
		await this.plugin.saveSettings();
	}

	setup(): void {
		const { plugin } = this;
		plugin.registerView(HTML_VIEW, (leaf) => new HtmlView(leaf, this));
		try {
			plugin.registerExtensions(["html", "htm"], HTML_VIEW);
		} catch (e) {
			// another plugin already opens .html files
			console.warn("Vault Management: .html files are already handled by another plugin", e);
			new Notice("Vault Management: another plugin already opens .html files, so the HTML editor is off.");
		}
		plugin.addCommand({
			id: "new-html-file",
			name: "New HTML file",
			callback: async () => {
				const app = plugin.app;
				let path = "Untitled.html";
				for (let i = 1; app.vault.getAbstractFileByPath(path); i++) path = `Untitled ${i}.html`;
				const file = await app.vault.create(path, "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>Untitled</title>\n</head>\n<body>\n\n</body>\n</html>\n");
				await app.workspace.getLeaf("tab").openFile(file);
			},
		});
		// keep each page's images folder when the page or the folder is renamed
		plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => void this.renamed(oldPath, file.path, file instanceof TFolder)));
	}

	private async renamed(from: string, to: string, isFolder: boolean): Promise<void> {
		const map = this.settings.assetFolders;
		let changed = false;
		if (map[from]) { map[to] = map[from]!; delete map[from]; changed = true; }
		for (const [page, folder] of Object.entries(map)) {
			if (folder === from || (isFolder && folder.startsWith(from + "/"))) { map[page] = to + folder.slice(from.length); changed = true; }
		}
		if (changed) await this.plugin.saveSettings();
	}
}

/* for tests outside Obsidian */
export const _test = { assetMap, previewDocument };
