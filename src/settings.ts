import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_THEMES, ThemeUpdater, renderThemeSettings } from "./features/themes.js";
import type { TextCover } from "./features/textCover";
import type { TextCoverSettings } from "./features/textCoverSettings";
import { renderTextCoverSettings } from "./features/textCoverSection";
import { DEFAULT_NEW_NOTE, type NewNote, type NewNoteSettings } from "./features/newNote";

export type InlineStyle = "swatch" | "badge" | "block";
const INLINE_STYLES: InlineStyle[] = ["swatch", "badge", "block"];

export interface ColorSettings {
	// how a color in inline code is shown: a small swatch box next to the text,
	// the whole code badge colored, or a big square of the color after the text
	inlineStyle: InlineStyle;
	// color names like `red` count as colors
	namedColors: boolean;
	// swatches for colors inside fenced code blocks
	codeBlocks: boolean;
	// click a swatch (Ctrl/Cmd+click in Live Preview inline code) to copy the color
	copyOnClick: boolean;
}

export interface FeatureSettings {
	bullets: boolean;
	colorInline: boolean;
	bulkProperties: boolean;
	mdToPdf: boolean;
	textCovers: boolean;
	newNoteButton: boolean;
	themeUpdates: boolean;
}

export interface VaultManagementSettings {
	features: FeatureSettings;
	color: ColorSettings;
	newNote: NewNoteSettings;
	// created the first time the text cover feature starts (see TextCover.loadState)
	textCover?: TextCoverSettings;
	themes: { repo: string; branch: string; enabled: boolean; name?: string; version?: string }[];
}

export const DEFAULT_COLOR: ColorSettings = { inlineStyle: "swatch", namedColors: true, codeBlocks: true, copyOnClick: true };
export const DEFAULT_FEATURES: FeatureSettings = { bullets: true, colorInline: true, bulkProperties: true, mdToPdf: true, textCovers: true, newNoteButton: true, themeUpdates: true };

// What the features need from the plugin
export interface Host extends Plugin {
	settings: VaultManagementSettings;
	saveSettings(): Promise<void>;
}

// Saved settings, with defaults for anything missing. Also reads the files of
// the plugins this one replaces: Color Inline Plus kept its settings at the top
// level, and Theme Auto-Update kept its theme list in `themes`, as here. The
// old on/off "badgeMode" becomes inlineStyle "badge".
export function mergeSettings(data: unknown): VaultManagementSettings {
	const d = (data ?? {}) as Record<string, unknown>;
	const saved = { ...((d.color as Record<string, unknown> | null | undefined) ?? {}) };
	const legacy: Record<string, unknown> = {};
	for (const key of ["namedColors", "codeBlocks", "copyOnClick", "badgeMode"]) {
		if (typeof d[key] === "boolean") legacy[key] = d[key];
	}
	const merged: Record<string, unknown> = { ...DEFAULT_COLOR, ...legacy, ...saved };
	const badge = merged.badgeMode;
	delete merged.badgeMode;
	const style = INLINE_STYLES.includes(saved.inlineStyle as InlineStyle) ? (saved.inlineStyle as InlineStyle) : badge === true ? "badge" : "swatch";
	return {
		features: { ...DEFAULT_FEATURES, ...((d.features as Partial<FeatureSettings> | undefined) ?? {}) },
		color: { ...(merged as unknown as ColorSettings), inlineStyle: style },
		newNote: mergeNewNote(d.newNote),
		textCover: d.textCover && typeof d.textCover === "object" ? (d.textCover as TextCoverSettings) : undefined,
		themes: Array.isArray(d.themes) ? (d.themes as VaultManagementSettings["themes"]) : DEFAULT_THEMES.map((t) => ({ ...t })),
	};
}

function mergeNewNote(raw: unknown): NewNoteSettings {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<NewNoteSettings>;
	const locks: Record<string, string[]> = {};
	if (r.locks && typeof r.locks === "object") {
		for (const [k, v] of Object.entries(r.locks)) if (Array.isArray(v)) locks[k] = v.filter((x) => typeof x === "string");
	}
	return { skipSingle: typeof r.skipSingle === "boolean" ? r.skipSingle : DEFAULT_NEW_NOTE.skipSingle, locks };
}

interface Refreshable {
	settingsChanged(): void;
}

export interface SettingsHost extends Host {
	colorInline: Refreshable | null;
	textCover: TextCover | null;
	newNote: NewNote | null;
	themes: ThemeUpdater | null;
}

export class VaultManagementSettingTab extends PluginSettingTab {
	plugin: SettingsHost;

	constructor(app: App, plugin: SettingsHost) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		const heading = (name: string, desc?: string) => {
			const h = new Setting(containerEl).setName(name).setHeading();
			if (desc) h.setDesc(desc);
		};
		const toggle = (name: string, desc: string, get: () => boolean, set: (v: boolean) => void, after?: () => void) =>
			new Setting(containerEl).setName(name).setDesc(desc).addToggle((t) =>
				t.setValue(get()).onChange(async (v) => {
					set(v);
					await save();
					after?.();
				})
			);

		heading("Features", "Turn a feature off to stop it loading. Changes apply after you restart Obsidian, or turn this plugin off and on.");
		toggle("Bullet variants", "+, |->, => and ? bullets, and a hotkey to cycle them.", () => s.features.bullets, (v) => (s.features.bullets = v));
		toggle("Color swatches", "Color swatches next to colors in inline code and code blocks.", () => s.features.colorInline, (v) => (s.features.colorInline = v));
		toggle("Bulk properties", "Change, remove or rename properties across every note.", () => s.features.bulkProperties, (v) => (s.features.bulkProperties = v));
		toggle("MD to PDF export", "Export the current note to a PDF next to it.", () => s.features.mdToPdf, (v) => (s.features.mdToPdf = v));
		toggle("Text covers", "Styled text covers for cards in Bases views.", () => s.features.textCovers, (v) => (s.features.textCovers = v));
		toggle("New note from template", "A Template button in Bases toolbars, and a command, to make a note from one of your templates.", () => s.features.newNoteButton, (v) => (s.features.newNoteButton = v));
		toggle("Theme updates", "Install and update themes from GitHub on startup.", () => s.features.themeUpdates, (v) => (s.features.themeUpdates = v));

		heading("Color swatches");
		const colorChanged = () => this.plugin.colorInline?.settingsChanged();
		new Setting(containerEl)
			.setName("Inline color style")
			.setDesc("How a color in inline code is shown: a small swatch box next to the text, the whole code badge colored, or a big square of the color after the text. Code blocks always get the small swatch.")
			.addDropdown((d) =>
				d.addOption("swatch", "Small swatch box")
					.addOption("badge", "Colored badge")
					.addOption("block", "Big square")
					.setValue(s.color.inlineStyle)
					.onChange(async (v) => {
						s.color.inlineStyle = v as InlineStyle;
						await save();
						colorChanged();
					})
			);
		toggle("Named colors", "Show a swatch for color names like red or rebeccapurple. In code blocks this only applies to CSS-like languages (css, scss, less, html, svg).",
			() => s.color.namedColors, (v) => (s.color.namedColors = v), colorChanged);
		toggle("Swatches in code blocks", "Show a swatch before each color inside fenced code blocks. Turn off to keep code blocks plain.",
			() => s.color.codeBlocks, (v) => (s.color.codeBlocks = v), colorChanged);
		toggle("Copy on click", "Click a swatch to copy the color as written. In Live Preview inline code, Ctrl/Cmd+click. The command Copy color at cursor works everywhere, including mobile.",
			() => s.color.copyOnClick, (v) => (s.color.copyOnClick = v), colorChanged);

		heading("Bullet variants");
		new Setting(containerEl)
			.setName("How to use")
			.setDesc("Type + for a plus, |-> for an arrow, => for moved and ? for a question after the dash and a space, like \"- |-> text\". Shift+Alt+8 (Cycle bullet style) changes the bullet on the current line, or on every bullet in a selection. Your notes keep exactly what you type.");

		heading("Bulk properties");
		new Setting(containerEl)
			.setName("How to use")
			.setDesc("Run Bulk edit properties from the command palette or the list icon in the ribbon. Pick a property, tick its values, then change, remove or delete them, or rename the property.");

		heading("MD to PDF export");
		new Setting(containerEl)
			.setName("How to use")
			.setDesc("Open a note and run Export current note to PDF from the command palette, or click the file icon in the ribbon. The PDF is saved next to the note with the same name. The PDF library is downloaded once, the first time you need it.");

		heading("Text covers");
		if (this.plugin.textCover?.active) {
			renderTextCoverSettings(containerEl, this.plugin.textCover);
		} else {
			new Setting(containerEl).setDesc(
				this.plugin.textCover
					? "Idle: the Text Cover Generator plugin is switched on. Turn it off, then restart Obsidian, to use this one."
					: "Turned off under Features."
			);
		}

		heading("New note from template");
		if (this.plugin.newNote) {
			new Setting(containerEl)
				.setName("How to use")
				.setDesc("Click Template in a base's toolbar, or run New note from template. Pick a template, name the note, and it is created in the vault root with the properties that base's view filters on. Click the lock next to a template to lock it to that base: a base with locked templates shows only those (Show all switches back). Templater is used if it is on, otherwise core Templates.");
			toggle("Skip the list when one template is locked", "When a base has exactly one locked template, go straight to naming the note. Choose another still opens the full list.",
				() => s.newNote.skipSingle, (v) => (s.newNote.skipSingle = v));
			const locks = Object.entries(s.newNote.locks);
			if (!locks.length) new Setting(containerEl).setDesc("No templates are locked to a base yet.");
			for (const [base, templates] of locks) {
				const names = templates.map((p) => p.split("/").pop()!.replace(/\.md$/, ""));
				new Setting(containerEl)
					.setName(base.split("/").pop()!.replace(/\.base$/, ""))
					.setDesc("Locked: " + names.join(", "))
					.addExtraButton((b) => b.setIcon("trash").setTooltip("Unlock all templates from this base").onClick(async () => {
						delete s.newNote.locks[base];
						await save();
						this.display();
					}));
			}
		} else {
			new Setting(containerEl).setDesc("Turned off under Features.");
		}

		heading("Theme updates");
		if (this.plugin.themes) {
			renderThemeSettings(containerEl, this.plugin.themes, () => this.display());
		} else {
			new Setting(containerEl).setDesc("Turned off under Features.");
		}

		heading("Plugin updates");
		new Setting(containerEl)
			.setName(`Vault Management ${this.plugin.manifest.version}`)
			.setDesc("The plugin updates itself from GitHub on startup. Run Check for update now from the command palette to check right away.");
	}
}
