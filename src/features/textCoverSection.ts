import { Setting } from 'obsidian';
import type { TextCover } from './textCover';

// The text cover settings, as a section of the plugin's settings tab
export function renderTextCoverSettings(containerEl: HTMLElement, feature: TextCover): void {
  containerEl.createEl('p', {
    text: 'Generates styled text covers for cards in Obsidian Bases views.',
    cls: 'setting-item-description',
  });
    new Setting(containerEl).setName('How to see text covers').setHeading();
    const steps = containerEl.createEl('ol', { cls: 'setting-item-description' });
    // The steps name the configured property, so redraw them when it changes.
    const renderSteps = () => {
      const prop = feature.settings.contentProperty;
      steps.empty();
      [
        'Open a Base and switch to (or add) a Cards view.',
        `In the view options, set "Image property" to ${prop}.`,
        `Each card without a real image now shows its text cover. The text comes from the note’s ${prop} ` +
          'property if set, otherwise from the note body (see Content below).',
        'Optional: set textCoverBg / textCoverColor in a note’s properties to style its cover.',
      ].forEach((t) => steps.createEl('li', { text: t }));
    };
    renderSteps();
    let registerTimer: ReturnType<typeof setTimeout> | undefined;

    // ── Content ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Content').setHeading();

    new Setting(containerEl)
      .setName('Cover text property')
      .setDesc(
        'Frontmatter property name to use as explicit cover text. ' +
          'Per-note override: add this property to any note.'
      )
      .addText((t) =>
        t
          .setPlaceholder('textCover')
          .setValue(feature.settings.contentProperty)
          .onChange(async (v) => {
            feature.settings.contentProperty = v.trim() || 'textCover';
            await feature.saveSettings();
            feature.scheduleContentRebuild();
          })
      );

    new Setting(containerEl)
      .setName('Default to file title')
      .setDesc(
        'Use the note title as cover text when no cover text property is set. ' +
          'Uses the "title" frontmatter property if present, otherwise the file name.'
      )
      .addToggle((t) =>
        t.setValue(feature.settings.defaultToTitle).onChange(async (v) => {
          feature.settings.defaultToTitle = v;
          await feature.saveSettings();
          feature.scheduleContentRebuild();
        })
      );

    new Setting(containerEl)
      .setName('Fall back to note body')
      .setDesc(
        'When no cover text property is found (and "Default to file title" is off), ' +
          'extract text from the note body (first blockquote, then first paragraph).'
      )
      .addToggle((t) =>
        t.setValue(feature.settings.fallbackToBody).onChange(async (v) => {
          feature.settings.fallbackToBody = v;
          await feature.saveSettings();
          feature.scheduleContentRebuild();
        })
      );

    new Setting(containerEl)
      .setName('Max characters')
      .setDesc('Truncate cover text after this many characters.')
      .addText((t) =>
        t
          .setValue(String(feature.settings.maxChars))
          .onChange(async (v) => {
            const n = parseInt(v);
            if (!isNaN(n) && n > 0) {
              feature.settings.maxChars = n;
              await feature.saveSettings();
              feature.resetAndProcess();
            }
          })
      );

    // ── Appearance ───────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Appearance').setHeading();
    containerEl.createEl('p', {
      text:
        'Per-note overrides: add textCoverBg or textCoverColor to a note\'s frontmatter.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Default background')
      .setDesc('CSS background value (color, gradient, etc.) for the cover.')
      .addText((t) =>
        t
          .setValue(feature.settings.defaultBg)
          .onChange(async (v) => {
            feature.settings.defaultBg = v;
            await feature.saveSettings();
            feature.resetAndProcess();
          })
      );

    new Setting(containerEl)
      .setName('Default text color')
      .setDesc('CSS color value for the cover text.')
      .addText((t) =>
        t
          .setValue(feature.settings.defaultColor)
          .onChange(async (v) => {
            feature.settings.defaultColor = v;
            await feature.saveSettings();
            feature.resetAndProcess();
          })
      );

    new Setting(containerEl)
      .setName('Font size')
      .setDesc('CSS font-size for the cover text (e.g. 0.82em, 13px).')
      .addText((t) =>
        t
          .setValue(feature.settings.fontSize)
          .onChange(async (v) => {
            feature.settings.fontSize = v;
            await feature.saveSettings();
            feature.resetAndProcess();
          })
      );

    new Setting(containerEl)
      .setName('Padding')
      .setDesc('CSS padding inside the cover (e.g. 1em 1.1em).')
      .addText((t) =>
        t
          .setValue(feature.settings.padding)
          .onChange(async (v) => {
            feature.settings.padding = v;
            await feature.saveSettings();
            feature.resetAndProcess();
          })
      );

    new Setting(containerEl)
      .setName('Show quote mark decoration')
      .setDesc('Show a large decorative opening-quote glyph in the cover background.')
      .addToggle((t) =>
        t.setValue(feature.settings.showQuoteMark).onChange(async (v) => {
          feature.settings.showQuoteMark = v;
          await feature.saveSettings();
          feature.resetAndProcess();
        })
      );

    // ── Covers ────────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Remote covers').setHeading();

    new Setting(containerEl)
      .setName('Covers folder')
      .setDesc('Vault-relative folder to save downloaded remote covers into.')
      .addText((t) =>
        t
          .setPlaceholder('Covers')
          .setValue(feature.settings.coversFolder)
          .onChange(async (v) => {
            feature.settings.coversFolder = v.trim().replace(/^\/+|\/+$/g, '') || 'Covers';
            await feature.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto-download covers')
      .setDesc(
        'When a note’s cover property is a remote URL, automatically download the ' +
          'highest-quality version into the covers folder and repoint the property at it.'
      )
      .addToggle((t) =>
        t.setValue(feature.settings.autoDownloadCovers).onChange(async (v) => {
          feature.settings.autoDownloadCovers = v;
          await feature.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Download remote covers to vault')
      .setDesc(
        'Finds notes whose banner/cover/image property points to a remote http(s) URL, or ' +
          'whose property points to a local file that no longer exists, downloads the best ' +
          'available image (recovering the source from coverSmallUrl/coverMediumUrl/' +
          'coverLargeUrl when needed) into the folder above, and repoints the property at ' +
          'the local file. Fixes covers that fail to load in Bases due to CORS or ' +
          'mixed-content blocking.'
      )
      .addButton((b) =>
        b.setButtonText('Download now').onClick(async () => {
          b.setButtonText('Downloading…').setDisabled(true);
          const count = await feature.downloadRemoteCovers((done, total) => {
            b.setButtonText(`Downloading… ${done}/${total}`);
          });
          b.setButtonText(count > 0 ? `Done — ${count} downloaded` : 'No remote covers found').setDisabled(false);
        })
      );

    // ── Cache ─────────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Cache').setHeading();

    new Setting(containerEl)
      .setName('Rebuild cover cache')
      .setDesc(
        `The cache is saved to disk and persists across restarts, and updates itself ` +
          `automatically as notes change or as content settings above are edited. ` +
          `Currently ${feature.cacheSize} covers cached. Use this button to force a ` +
          `full recompute — e.g. if notes were bulk-edited by an external tool.`
      )
      .addButton((b) =>
        b.setButtonText('Rebuild now').onClick(async () => {
          b.setButtonText('Building…').setDisabled(true);
          await feature.buildCache();
          b.setButtonText(`Done — ${feature.cacheSize} covers`).setDisabled(false);
        })
      );

    // ── Debug ────────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Debug').setHeading();

    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Log card-selector activity to the browser console (Ctrl+Shift+I).')
      .addToggle((t) =>
        t.setValue(feature.settings.debugMode).onChange(async (v) => {
          feature.settings.debugMode = v;
          await feature.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Log DOM snapshot')
      .setDesc(
        'Print the inner HTML of active Base views to the console. ' +
          'Use this to discover class names if covers are not appearing.'
      )
      .addButton((b) =>
        b.setButtonText('Snapshot now').onClick(() => {
          feature.logDomSnapshot();
        })
      );

    new Setting(containerEl)
      .setName('Re-process all cards')
      .setDesc('Force re-scanning all Base views right now.')
      .addButton((b) =>
        b.setButtonText('Refresh').onClick(() => {
          feature.resetAndProcess();
        })
      );
}
