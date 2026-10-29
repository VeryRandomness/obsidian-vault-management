import { Plugin } from "obsidian";
import { REPO, setupAutoUpdate } from "./updater";
import { SettingsHost, VaultManagementSettings, VaultManagementSettingTab, mergeSettings } from "./settings";
import { ColorInline } from "./features/colorInline";
import { setupBullets, _test as bulletsTest } from "./features/bullets.js";
import { setupBulk, _test as bulkTest } from "./features/bulk.js";
import { setupLineLinks, _test as lineLinksTest } from "./features/lineLinks";
import { setupMdToPdf } from "./features/mdToPdf";
import { TextCover, _test as textCoverTest } from "./features/textCover";
import { NewNote, _test as newNoteTest } from "./features/newNote";
import { HtmlEditor, _test as htmlTest } from "./features/htmlEditor";
import { ThemeUpdater, setupThemes, _test as themesTest } from "./features/themes.js";

// Vault Management: bullet variants, color swatches, bulk property editing, PDF
// export, text covers, new notes from templates, an HTML editor and theme updates in one plugin. Each feature can be turned off in the settings.
export default class VaultManagementPlugin extends Plugin implements SettingsHost {
	settings!: VaultManagementSettings;
	colorInline: ColorInline | null = null;
	textCover: TextCover | null = null;
	newNote: NewNote | null = null;
	htmlEditor: HtmlEditor | null = null;
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
		if (features.lineLinks) setupLineLinks(this);
		if (features.mdToPdf) setupMdToPdf(this);
		if (features.textCovers) {
			this.textCover = new TextCover(this);
			await this.textCover.setup();
		}
		if (features.newNoteButton) {
			this.newNote = new NewNote(this);
			this.newNote.setup();
		}
		if (features.htmlEditor) {
			this.htmlEditor = new HtmlEditor(this);
			this.htmlEditor.setup();
		}
		if (features.themeUpdates) this.themes = setupThemes(this);

		setupAutoUpdate(this, REPO);
	}

	onunload(): void {
		this.colorInline?.unload();
		this.textCover?.unload();
		this.newNote?.unload();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/* for tests outside Obsidian */
export const __test = { bullets: bulletsTest, bulk: bulkTest, lineLinks: lineLinksTest, themes: themesTest, textCover: textCoverTest, newNote: newNoteTest, html: htmlTest, mergeSettings };
