import { Plugin } from "obsidian";
import { REPO, setupAutoUpdate } from "./updater";
import { SettingsHost, VaultManagementSettings, VaultManagementSettingTab, mergeSettings } from "./settings";
import { ColorInline } from "./features/colorInline";
import { setupBullets, _test as bulletsTest } from "./features/bullets.js";
import { setupBulk, _test as bulkTest } from "./features/bulk.js";
import { setupMdToPdf } from "./features/mdToPdf";
import { ThemeUpdater, setupThemes, _test as themesTest } from "./features/themes.js";

// Vault Management: bullet variants, color swatches, bulk property editing, PDF
// export and theme updates in one plugin. Each feature can be turned off in the settings.
export default class VaultManagementPlugin extends Plugin implements SettingsHost {
	settings!: VaultManagementSettings;
	colorInline: ColorInline | null = null;
	themes: ThemeUpdater | null = null;

	async onload(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());
		this.addSettingTab(new VaultManagementSettingTab(this.app, this));

		const { features } = this.settings;
		if (features.bullets) setupBullets(this);
		if (features.colorInline) {
			this.colorInline = new ColorInline(this);
			this.colorInline.setup();
		}
		if (features.bulkProperties) setupBulk(this);
		if (features.mdToPdf) setupMdToPdf(this);
		if (features.themeUpdates) this.themes = setupThemes(this);

		setupAutoUpdate(this, REPO);
	}

	onunload(): void {
		this.colorInline?.unload();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/* for tests outside Obsidian */
export const __test = { bullets: bulletsTest, bulk: bulkTest, themes: themesTest, mergeSettings };
