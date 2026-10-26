import { App, Modal, Notice, TFile, WorkspaceLeaf, parseYaml, setIcon } from "obsidian";
import type { Host } from "../settings";

// New note from template: a "Template" button in every Bases toolbar (next to Bases'
// own "New"), and a command. You pick one of your templates (or one that is locked to
// that base), name the note, and it is created in the vault root, filled in by
// Templater if it is installed, otherwise by Obsidian's core Templates. The note also
// gets the properties the base's filters ask for, so it shows up in the view.

export interface NewNoteSettings {
	// skip the list when a base has exactly one locked template
	skipSingle: boolean;
	// base file path -> template file paths locked to it
	locks: Record<string, string[]>;
}

export const DEFAULT_NEW_NOTE: NewNoteSettings = { skipSingle: true, locks: {} };

const BUTTON_CLASS = "vm-new-from-template";
const FAB_CLASS = "vm-new-from-template-fab";

// ── What a base's filters ask of a new note ────────────────────────────────────

export interface Requirement {
	key: string;
	op: "eq" | "contains";
	value: unknown;
}

const PROP = String.raw`(?:note\.)?([A-Za-z_][\w-]*)|note\[\s*"([^"]+)"\s*\]`;
const EQ = new RegExp(String.raw`^\s*(?:${PROP})\s*==\s*(.+?)\s*$`);
const CONTAINS = new RegExp(String.raw`^\s*(?:${PROP})\.contains\(\s*(.+?)\s*\)\s*$`);
const HAS_TAG = /^\s*file\.hasTag\(\s*(.+?)\s*\)\s*$/;
const NOT_PROPERTY = new Set(["file", "formula", "this"]);

function literal(text: string): { ok: boolean; value?: unknown } {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false };
	}
}

/** One filter line, if it says something a new note can satisfy. */
export function parseFilter(text: string): Requirement[] {
	if (typeof text !== "string" || /^\s*!/.test(text)) return [];
	let m = HAS_TAG.exec(text);
	if (m) {
		const tags = (m[1] ?? "").split(/\s*,\s*/).map((t) => literal(t)).filter((t) => t.ok && typeof t.value === "string");
		return tags.map((t) => ({ key: "tags", op: "contains", value: String(t.value).replace(/^#/, "") }));
	}
	for (const [re, op] of [[EQ, "eq"], [CONTAINS, "contains"]] as const) {
		m = re.exec(text);
		if (!m) continue;
		const key = m[1] ?? m[2];
		if (!key || NOT_PROPERTY.has(key)) return [];
		const v = literal(m[3] ?? "");
		if (!v.ok || v.value === null) return [];
		return [{ key, op, value: v.value }];
	}
	return [];
}

/** Everything a filter tree asks for. Only what must be true is used: every "and"
 *  branch, an "or" with a single branch, and never anything under "not". */
export function collect(filter: unknown): Requirement[] {
	if (typeof filter === "string") return parseFilter(filter);
	if (!filter || typeof filter !== "object") return [];
	const f = filter as Record<string, unknown>;
	if (Array.isArray(f.and)) return f.and.flatMap(collect);
	if (Array.isArray(f.or) && f.or.length === 1) return collect(f.or[0]);
	return [];
}

/** The requirements of a base and, within it, of the view by that name (or the first). */
export function baseRequirements(base: unknown, viewName?: string): Requirement[] {
	if (!base || typeof base !== "object") return [];
	const b = base as { filters?: unknown; views?: { name?: string; filters?: unknown }[] };
	const views = Array.isArray(b.views) ? b.views : [];
	const view = views.find((v) => v && v.name === viewName) ?? views[0];
	return [...collect(b.filters), ...collect(view?.filters)];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Fills a note's properties so they meet the requirements. Never overwrites a value
 *  the template set: those are returned as conflicts instead. */
export function applyRequirements(fm: Record<string, unknown>, reqs: Requirement[]): string[] {
	const conflicts: string[] = [];
	for (const r of reqs) {
		const cur = fm[r.key];
		if (r.op === "eq") {
			if (isEmpty(cur)) fm[r.key] = r.value;
			else if (!same(cur, r.value)) conflicts.push(r.key);
		} else if (isEmpty(cur)) {
			fm[r.key] = [r.value];
		} else if (Array.isArray(cur)) {
			if (!cur.some((x) => same(x, r.value))) cur.push(r.value);
		} else if (!same(cur, r.value)) {
			conflicts.push(r.key);
		}
	}
	return [...new Set(conflicts)];
}

function describe(reqs: Requirement[]): string {
	return reqs.map((r) => `${r.key}: ${Array.isArray(r.value) ? r.value.join(", ") : String(r.value)}`).join(" · ");
}

// ── Templates: Templater if it is on, otherwise core Templates ──────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function templater(app: App): any {
	const plugins = (app as any).plugins;
	return plugins?.enabledPlugins?.has?.("templater-obsidian") ? plugins.plugins?.["templater-obsidian"] ?? null : null;
}

function coreTemplates(app: App): any {
	const p = (app as any).internalPlugins?.getPluginById?.("templates");
	return p?.enabled ? p.instance : null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function templateEngine(app: App): { name: string; folder: string } | null {
	const t = templater(app);
	if (t) return { name: "Templater", folder: String(t.settings?.templates_folder ?? "") };
	const c = coreTemplates(app);
	if (c) return { name: "Templates", folder: String(c.options?.folder ?? "") };
	return null;
}

export function listTemplates(app: App): TFile[] {
	const engine = templateEngine(app);
	if (!engine) return [];
	const folder = engine.folder.replace(/^\/+|\/+$/g, "");
	return app.vault.getMarkdownFiles()
		.filter((f) => (folder ? f.path.startsWith(folder + "/") : true))
		.sort((a, b) => a.path.localeCompare(b.path));
}

function availablePath(app: App, name: string): string {
	const base = name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
	if (!app.vault.getAbstractFileByPath(`${base}.md`)) return `${base}.md`;
	for (let i = 1; ; i++) if (!app.vault.getAbstractFileByPath(`${base} ${i}.md`)) return `${base} ${i}.md`;
}

/** Fills in what core Templates fills in: {{title}}, {{date}}, {{time}}, with formats. */
export function fillCoreTemplate(text: string, title: string, dateFormat: string, timeFormat: string, now: { format(f: string): string }): string {
	return text
		.replace(/{{\s*title\s*}}/gi, title)
		.replace(/{{\s*date\s*(?::([^}]*))?}}/gi, (_, f) => now.format(f?.trim() || dateFormat))
		.replace(/{{\s*time\s*(?::([^}]*))?}}/gi, (_, f) => now.format(f?.trim() || timeFormat));
}

export async function createFromTemplate(app: App, template: TFile, name: string, reqs: Requirement[]): Promise<TFile> {
	let file: TFile | null = null;
	const t = templater(app);
	if (t) {
		file = await t.templater.create_new_note_from_template(template, app.vault.getRoot(), name.trim() || "Untitled", false);
		if (!file) throw new Error("Templater did not create the note");
	} else {
		const c = coreTemplates(app);
		const path = availablePath(app, name);
		const title = path.replace(/\.md$/, "");
		const text = await app.vault.read(template);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const now = (window as any).moment();
		file = await app.vault.create(path, fillCoreTemplate(text, title, c?.options?.dateFormat || "YYYY-MM-DD", c?.options?.timeFormat || "HH:mm", now));
	}
	if (reqs.length) {
		let conflicts: string[] = [];
		await app.fileManager.processFrontMatter(file, (fm) => { conflicts = applyRequirements(fm, reqs); });
		if (conflicts.length) new Notice(`New note: the template already sets ${conflicts.join(", ")} differently from this view's filters, so the note may not show in this view.`, 8000);
	}
	await app.workspace.getLeaf("tab").openFile(file);
	return file;
}

// ── The picker ────────────────────────────────────────────────────────────────

interface Context {
	base: TFile | null;
	viewName?: string;
	reqs: Requirement[];
}

class NewNoteModal extends Modal {
	private showAll = false;

	constructor(private readonly feature: NewNote, private readonly ctx: Context, private readonly start?: TFile) {
		super(feature.plugin.app);
		this.modalEl.addClass("vm-new-note");
	}

	onOpen(): void {
		this.titleEl.setText(this.ctx.base ? `New note · ${this.ctx.base.basename}${this.ctx.viewName ? " · " + this.ctx.viewName : ""}` : "New note from template");
		if (this.start) this.name(this.start);
		else this.pick();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private pick(): void {
		const el = this.contentEl;
		el.empty();
		const all = listTemplates(this.app);
		const engine = templateEngine(this.app);
		if (!engine) {
			el.createEl("p", { text: "Turn on Templater or the core Templates plugin, and set its template folder, to use this." });
			return;
		}
		if (!all.length) {
			el.createEl("p", { text: `No templates found in "${engine.folder || "/"}" (the ${engine.name} template folder).` });
			return;
		}
		const locked = this.ctx.base ? this.feature.locked(this.ctx.base.path) : [];
		const lockedFiles = all.filter((f) => locked.includes(f.path));
		const input = el.createEl("input", { type: "text", placeholder: "Search templates…", cls: "vm-new-note-search" });
		const list = el.createDiv({ cls: "vm-new-note-list" });
		const footer = el.createDiv({ cls: "vm-new-note-footer" });
		if (this.ctx.reqs.length) footer.createDiv({ text: "Adds " + describe(this.ctx.reqs), cls: "vm-new-note-hint" });
		if (lockedFiles.length) {
			const toggle = footer.createEl("button", { text: this.showAll ? "Show only locked templates" : `Show all ${all.length} templates` });
			toggle.onclick = () => { this.showAll = !this.showAll; this.pick(); };
		}
		const source = () => (lockedFiles.length && !this.showAll ? lockedFiles : all);
		let shown: TFile[] = [];
		const draw = () => {
			const q = input.value.trim().toLowerCase();
			shown = source().filter((f) => f.basename.toLowerCase().includes(q));
			list.empty();
			for (const f of shown) {
				const row = list.createDiv({ cls: "vm-new-note-row" });
				row.createSpan({ text: f.basename, cls: "vm-new-note-name" });
				if (this.ctx.base) {
					const isLocked = locked.includes(f.path);
					const lock = row.createEl("button", { cls: "clickable-icon vm-new-note-lock" + (isLocked ? " is-locked" : ""), attr: { "aria-label": isLocked ? "Unlock from this base" : "Lock to this base" } });
					setIcon(lock, isLocked ? "lock" : "lock-open");
					lock.onclick = async (e) => {
						e.stopPropagation();
						// keep showing what was shown, so several can be locked in a row;
						// the list narrows to the locked ones the next time it opens
						this.showAll = source() === all;
						await this.feature.toggleLock(this.ctx.base!.path, f.path);
						this.pick();
					};
				}
				row.onclick = () => this.name(f);
			}
			if (!shown.length) list.createDiv({ text: "No template matches.", cls: "vm-new-note-none" });
		};
		input.oninput = draw;
		input.onkeydown = (e) => { if (e.key === "Enter" && shown[0]) this.name(shown[0]); };
		draw();
		input.focus();
	}

	private name(template: TFile): void {
		const el = this.contentEl;
		el.empty();
		const head = el.createDiv({ cls: "vm-new-note-head" });
		head.createSpan({ text: "Template: " + template.basename });
		const change = head.createEl("button", { text: "Choose another" });
		change.onclick = () => { this.showAll = true; this.pick(); };
		const input = el.createEl("input", { type: "text", placeholder: "Note name", cls: "vm-new-note-search", value: "" });
		if (this.ctx.reqs.length) el.createDiv({ text: "Adds " + describe(this.ctx.reqs), cls: "vm-new-note-hint" });
		el.createDiv({ text: "Created in the vault root.", cls: "vm-new-note-hint" });
		const create = el.createEl("button", { text: "Create", cls: "mod-cta" });
		const go = async () => {
			create.disabled = true;
			try {
				await createFromTemplate(this.app, template, input.value, this.ctx.reqs);
				this.close();
			} catch (e) {
				console.error("Vault Management: new note", e);
				new Notice("Could not create the note: " + (e as Error).message);
				create.disabled = false;
			}
		};
		create.onclick = go;
		input.onkeydown = (e) => { if (e.key === "Enter") void go(); };
		input.focus();
	}
}

// ── The feature ───────────────────────────────────────────────────────────────

export class NewNote {
	private observers = new Map<WorkspaceLeaf, MutationObserver>();
	private pending = false;

	constructor(readonly plugin: Host) {}

	get settings(): NewNoteSettings {
		return this.plugin.settings.newNote;
	}

	locked(basePath: string): string[] {
		return this.settings.locks[basePath] ?? [];
	}

	async toggleLock(basePath: string, templatePath: string): Promise<void> {
		const cur = this.locked(basePath);
		const next = cur.includes(templatePath) ? cur.filter((p) => p !== templatePath) : [...cur, templatePath];
		if (next.length) this.settings.locks[basePath] = next;
		else delete this.settings.locks[basePath];
		await this.plugin.saveSettings();
	}

	setup(): void {
		const { plugin } = this;
		plugin.addCommand({
			id: "new-note-from-template",
			name: "New note from template",
			callback: () => void this.open(this.activeBaseLeaf()),
		});
		const refresh = () => this.schedule();
		plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
		plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
		plugin.app.workspace.onLayoutReady(refresh);
		// keep the locks pointing at the right files when bases or templates are renamed
		plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => void this.renamed(oldPath, file.path)));
	}

	unload(): void {
		for (const o of this.observers.values()) o.disconnect();
		this.observers.clear();
		document.querySelectorAll(`.${BUTTON_CLASS}, .${FAB_CLASS}`).forEach((el) => el.remove());
	}

	private async renamed(from: string, to: string): Promise<void> {
		const locks = this.settings.locks;
		let changed = false;
		if (locks[from]) { locks[to] = locks[from]!; delete locks[from]; changed = true; }
		for (const k of Object.keys(locks)) {
			const list = locks[k]!;
			if (list.includes(from)) { locks[k] = list.map((p) => (p === from ? to : p)); changed = true; }
		}
		if (changed) await this.plugin.saveSettings();
	}

	private activeBaseLeaf(): WorkspaceLeaf | null {
		const leaf = this.plugin.app.workspace.getMostRecentLeaf?.() ?? null;
		return leaf && leaf.view?.getViewType?.() === "bases" ? leaf : null;
	}

	/** Opens the picker for a Bases tab (or with no base, from the command). */
	async open(leaf: WorkspaceLeaf | null): Promise<void> {
		const ctx = await this.context(leaf);
		const templates = listTemplates(this.plugin.app);
		const locked = ctx.base ? templates.filter((f) => this.locked(ctx.base!.path).includes(f.path)) : [];
		new NewNoteModal(this, ctx, this.settings.skipSingle && locked.length === 1 ? locked[0] : undefined).open();
	}

	async context(leaf: WorkspaceLeaf | null): Promise<Context> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const view = leaf?.view as any;
		const base: TFile | null = view?.file ?? null;
		if (!base) return { base: null, reqs: [] };
		const viewName: string | undefined = view.getState?.()?.viewName;
		let reqs: Requirement[] = [];
		try {
			reqs = baseRequirements(parseYaml(await this.plugin.app.vault.cachedRead(base)), viewName);
		} catch (e) {
			console.warn("Vault Management: could not read the base's filters", e);
		}
		return { base, viewName, reqs };
	}

	// ── The toolbar button ──────────────────────────────────────────────────────

	private schedule(): void {
		if (this.pending) return;
		this.pending = true;
		window.requestAnimationFrame(() => { this.pending = false; this.decorateAll(); });
	}

	private decorateAll(): void {
		const leaves = this.plugin.app.workspace.getLeavesOfType("bases");
		for (const [leaf, o] of this.observers) {
			if (!leaves.includes(leaf)) { o.disconnect(); this.observers.delete(leaf); }
		}
		for (const leaf of leaves) {
			this.decorate(leaf);
			if (!this.observers.has(leaf)) {
				const o = new MutationObserver(() => this.schedule());
				o.observe(leaf.view.containerEl, { childList: true, subtree: true });
				this.observers.set(leaf, o);
			}
		}
	}

	/** Puts the button in the base's toolbar, next to Bases' own "New". If the toolbar
	 *  isn't there (a future Obsidian could change it), a small floating button is used. */
	decorate(leaf: WorkspaceLeaf): void {
		const root = leaf.view.containerEl;
		const toolbar = root.querySelector(".bases-toolbar");
		const fab = root.querySelector(`.${FAB_CLASS}`);
		if (toolbar) {
			fab?.remove();
			if (toolbar.querySelector(`.${BUTTON_CLASS}`)) return;
			const item = createDiv({ cls: `bases-toolbar-item ${BUTTON_CLASS}` });
			const button = item.createDiv({ cls: "text-icon-button", attr: { tabindex: "0", "aria-label": "New note from template" } });
			setIcon(button.createSpan({ cls: "text-button-icon" }), "file-plus-2");
			button.createSpan({ cls: "text-button-label", text: "Template" });
			button.addEventListener("click", (e) => { e.preventDefault(); void this.open(leaf); });
			button.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void this.open(leaf); } });
			const builtIn = toolbar.querySelector(".bases-toolbar-new-item-menu");
			if (builtIn?.parentElement) builtIn.parentElement.insertBefore(item, builtIn.nextSibling);
			else toolbar.appendChild(item);
			return;
		}
		if (fab || !root.querySelector(".bases-view")) return;
		const b = root.createEl("button", { cls: `clickable-icon ${FAB_CLASS}`, attr: { "aria-label": "New note from template" } });
		setIcon(b, "file-plus-2");
		b.onclick = () => void this.open(leaf);
	}
}

/* for tests outside Obsidian */
export const _test = { parseFilter, collect, baseRequirements, applyRequirements, fillCoreTemplate, templateEngine, listTemplates };
