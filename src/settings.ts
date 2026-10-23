import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_THEMES, ThemeUpdater, renderThemeSettings } from "./features/themes.js";

export interface ColorSettings {
	// true: color the whole inline code badge; false: small swatch box next to the text
	badgeMode: boolean;
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
	themeUpdates: boolean;
}

export interface VaultManagementSettings {
	features: FeatureSettings;
	color: ColorSettings;
	themes: { repo: string; branch: string; enabled: boolean; name?: string; version?: string }[];
}

export const DEFAULT_COLOR: ColorSettings = { badgeMode: false, namedColors: true, codeBlocks: true, copyOnClick: true };
export const DEFAULT_FEATURES: FeatureSettings = { bullets: true, colorInline: true, bulkProperties: true, themeUpdates: true };

// What the features need from the plugin
export interface Host extends Plugin {
	settings: VaultManagementSettings;
	saveSettings(): Promise<void>;
}

// Saved settings, with defaults for anything missing. Also reads the files of
// the plugins this one replaces: Color Inline Plus kept its settings at the top
// level, and Theme Auto-Update kept its theme list in `themes`, as here.
export function mergeSettings(data: unknown): VaultManagementSettings {
	const d = (data ?? {}) as Record<string, unknown>;
	const legacyColor: Partial<ColorSettings> = {};
	for (const key of Object.keys(DEFAULT_COLOR) as (keyof ColorSettings)[]) {
		if (typeof d[key] === "boolean") legacyColor[key] = d[key] as boolean;
	}
	return {
		features: { ...DEFAULT_FEATURES, ...((d.features as Partial<FeatureSettings> | undefined) ?? {}) },
		color: { ...DEFAULT_COLOR, ...legacyColor, ...((d.color as Partial<ColorSettings> | undefined) ?? {}) },
		themes: Array.isArray(d.themes) ? (d.themes as VaultManagementSettings["themes"]) : DEFAULT_THEMES.map((t) => ({ ...t })),
	};
}

interface Refreshable {
	settingsChanged(): void;
}

export interface SettingsHost extends Host {
	colorInline: Refreshable | null;
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
		toggle("Theme updates", "Install and update themes from GitHub on startup.", () => s.features.themeUpdates, (v) => (s.features.themeUpdates = v));

		heading("Color swatches");
		const colorChanged = () => this.plugin.colorInline?.settingsChanged();
		toggle("Color the whole badge", "On: the inline code background takes the color. Off: a small swatch box sits next to the code.",
			() => s.color.badgeMode, (v) => (s.color.badgeMode = v), colorChanged);
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
