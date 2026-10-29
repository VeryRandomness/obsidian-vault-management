# Vault Management

An [Obsidian](https://obsidian.md) plugin that bundles nine vault tools in one. Each can be switched off in the settings.

| Feature | What it does |
| --- | --- |
| **Bullet variants** | Extra bullet styles: `+`, `|->` (arrow), `=>` (moved) and `?` (question). Shift+Alt+8 cycles them. |
| **Color swatches** | A swatch next to colors in inline code and code blocks: hex, rgb, hsl, hwb, lab, lch, oklab, oklch, `color()`, `color-mix()` and named colors. Click to copy. |
| **Bulk properties** | Change, remove or rename a property's values across every note at once. |
| **Lines to links** | Shift+Alt+L turns each selected line into a `[[link]]`. |
| **MD to PDF export** | Exports the current note to a PDF next to it, keeping links clickable. |
| **Text covers** | Styled text covers for cards in Bases views, with automatic cover downloads. |
| **New note from template** | A Template button in every base's toolbar: pick a template, name the note, and it gets the properties that base's view filters on. |
| **HTML editor** | Opens `.html` files in Obsidian: a code editor with colours and autosave, and a live preview that shows the page's images from a vault folder. |
| **Theme updates** | Installs themes from GitHub repos and keeps them up to date on startup. |

It replaces these plugins: Bullet Variants, Color Inline Plus, Bulk Properties, MD to PDF Export, Text Cover Generator and Theme Auto-Update, and adds new notes from templates. Turn those off before turning this one on, or you will get everything twice.

## Bullet variants

Only the look changes; your notes keep exactly what you type.

| You type | Bullet shown |
| --- | --- |
| `- text` | The normal dot |
| `+ text` | A `+` sign |
| `- \|-> text` | An arrow: down, then right |
| `- => text` | A right arrow, for "moved" |
| `- ? text` | A question mark |

A space must follow the symbol. Tasks (`- [ ]`), numbered lists, `*` bullets and code blocks are left alone. In Live Preview the typed `|->`, `=>` or `?` is hidden until your cursor is on that line. The same shapes appear in Reading view and on mobile.

**Shift+Alt+8** (command: **Cycle bullet style**) changes the bullet on the current line, or on every bullet in a selection: normal, `+`, `|->`, `=>`, `?`, then back to normal.

## Lines to links

Select some lines and press **Shift+Alt+L** (command: **Turn lines into links**). Each line becomes a link to a note of that name:

```
Apples              [[Apples]]
- Pears        →    - [[Pears]]
- [ ] Figs          - [ ] [[Figs]]
```

Indentation, quotes, bullets, numbers, task boxes and heading marks stay in front of the link. Blank lines and lines that already have a `[[link]]` are left alone. With nothing selected it links the current line; a selection inside one line links just the selected words. Ctrl+Z undoes it.

## Color swatches

The browser's own CSS parser reads the color, so anything it understands works, in old and new syntax: `#0fa`, `#ff008080`, `rgb(0 255 255 / 50%)`, `hsl(150deg 50% 90%)`, `hwb(194 0% 0%)`, `lab(50% 40 59)`, `oklch(70% 0.2 150)`, `color(display-p3 1 0 0)`, `color-mix(in srgb, red 50%, blue)`, and names like `rebeccapurple`. Not supported, because they depend on the page or theme: `var()`, `currentcolor`, system colors and `light-dark()`.

- **Inline code:** the color has to fill the whole span: `` `#fff` `` gets a swatch, `` `color: #fff` `` does not. Shown in one of three styles, chosen under **Inline color style** in the settings: a small swatch box beside the code (default), the whole code colored like a badge, or a big square of the color after the text. Code blocks always get the small swatch.
- **Code blocks:** a swatch before each color. Hex and color functions are found in any language; color names only in CSS-like languages (css, scss, sass, less, stylus, html, svg, xml). Outside those, a hex color needs six or eight digits or a quote in front, so `#add feature` in a comment is left alone.
- **Copy:** click a swatch in Reading view, or a code-block swatch in Live Preview. Ctrl/Cmd+click colored inline code in Live Preview. The command **Copy color at cursor** works everywhere, including mobile.

## Bulk properties

Run **Bulk edit properties** from the command palette, or click the list icon in the ribbon.

1. **Pick a property.** Type to filter your property names; each shows how many notes use it.
2. **Tick values.** Search its values and tick one or more. Ticking several lets you merge them, for example `Inprogress` and `In progress` into `In Progress`.
3. **Choose an action:** change the ticked values to a new one, remove them, or delete the property from those notes. In a list property only the ticked items change.
4. **Check the list of notes, then apply.**

The list of notes shows what will change, note by note, as old → new (for example `Inprogress → In Progress`), and updates as you edit the new value.

**Rename...** renames a property or merges it into one that already exists.

**Undo.** Ctrl+Z won't undo a bulk edit, so every one is saved first: the properties of each note it changes, before and after, in `bulk-undo.json` next to the plugin (the last 10 edits). Run **Undo last bulk edit** from the command palette, or click **Undo it** at the bottom of the first screen. Undo puts the saved properties back, in their original order, but only in notes that still look exactly as the edit left them. A note you edited since, or deleted, is left alone, and the notice says how many.

## Text covers

Generates styled text covers for cards in Obsidian Bases views: a Cards view with its "Image property" set to `textCover` shows each note's text where a cover image would be. The text comes from the note's `textCover` property, or its title, or its body (first quote, then first paragraph). It can also download remote cover URLs (Google Books links, Amazon, Open Library, iTunes) into a covers folder, at the largest size available, and point the note at the local file. Everything is under **Text covers** in the settings.

If the standalone Text Cover Generator plugin is switched on, this feature stays idle (so two copies don't fight over the same covers) and says so. The first time it runs without that plugin, it imports that plugin's settings and cover-text cache from its `data.json`. The cache is kept in its own file, `text-cover-cache.json`.

## MD to PDF export

Open a note and run **Export current note to PDF** from the command palette, or click the file icon in the ribbon. The PDF is saved next to the note with the same name, and links stay clickable: web links as they are, and note links as `obsidian://` links that reopen the note.

The PDF libraries (jsPDF and html2canvas-pro, about 1 MB) live in a separate file, `lib.js`, that is only read the first time you export, so they don't slow down Obsidian's startup. If `lib.js` is missing, the plugin downloads it from this repo by itself.

## New note from template

Every base gets a **Template** button in its toolbar, next to Bases' own **New**. There is also a command, **New note from template**, which works anywhere (in a base it uses that base).

1. **Pick a template** from your template folder. A base can have templates **locked** to it: click the lock next to a template. A base with locked templates lists only those, and **Show all** switches back to every template. Unlock with the same lock, or under **New note from template** in the settings.
2. **Name the note.** It is created in the **vault root** and opened in a new tab. A name that is already taken gets a number.

The template is filled in by **Templater** if it is on, otherwise by Obsidian's core **Templates** (`{{title}}`, `{{date}}`, `{{time}}`, with formats).

The new note also gets the properties the base (and the view you're on) filters on, so it shows up there: `Designation == ["Books"]` gives it `Designation: Books`, `Status.contains("Open")` adds `Open` to `Status`, and `file.hasTag("book")` adds the tag. Only conditions that must hold are used (every **and** branch, a one-branch **or**, never anything under **not**, and never `file.` conditions). A value the template already sets differently is kept, and a notice says the note may not show in that view.

With **Skip the list when one template is locked** on (the default), a base with exactly one locked template goes straight to naming the note; **Choose another** still opens the full list. Locks follow bases and templates when they are renamed.

Bases' own **New** button does something different: it makes a note in the base's folder, fills in the properties from the filters and can copy a template's properties, but not its text, and it doesn't run Templater.

If a future Obsidian changes the Bases toolbar so the button can't be placed, a small floating button appears in the corner of the base instead, and the command always works.

## HTML editor

`.html` and `.htm` files in the vault open in Obsidian, on desktop and mobile. **New HTML file** makes a starter page.

- **Editor:** HTML, CSS and JavaScript colours (from your theme's code colours), line numbers, bracket matching, search, undo. Changes save by themselves, like a note.
- **Preview:** the page as a browser shows it, refreshed a moment after you stop typing, keeping its scroll position. The buttons at the top show the editor, the preview, or both side by side. A phone opens on the editor.
- **Images folder:** pick, once per page, the vault folder its images are in (the folder button at the top). Links like `/favicon.svg`, `img/photo.jpg`, `srcset`, and `url(...)` in styles are shown from that folder, including links the page's own scripts add while it runs. Web addresses are left alone. The choice follows renames of the page or the folder.
- **Script errors:** if the page's script fails (a typo in a setting, a missing comma), a banner at the top of the preview says so with the line number, and **Go to line** jumps the editor there. A script stops at its first error, so a page that builds itself with JavaScript can look half-empty until it's fixed.
- **Sealed off:** the preview runs in a sandboxed frame. The page's scripts run (needed for pages that build themselves with JavaScript), but can't reach Obsidian, your vault or its storage. **Run the page's scripts in the preview** can be switched off to show only the HTML as written.

The editor is only an editor: publishing the page is up to you.

## Theme updates

Each GitHub repo in the list needs `theme.css` and `manifest.json` at its root. Themes are checked on startup and installed into your themes folder using the name in `manifest.json`. Add a theme in the settings with a GitHub link (`https://github.com/owner/repo`, optionally `/tree/branch`) or `owner/repo`. Command: **Check for theme updates now**. One theme failing never stops the others.

## Install

Download `main.js`, `manifest.json`, `styles.css` and `lib.js` from the [latest release](https://github.com/VeryRandomness/obsidian-vault-management/releases/latest) and copy them into `<your vault>/.obsidian/plugins/vr-vault-management/` (the folder name must match the plugin ID), then turn on **Vault Management** under Settings > Community plugins.

Settings from the plugins this replaces are picked up if you copy their `data.json` into the new folder (the color swatch settings and the theme list carry over). Text Cover Generator's settings and cache are imported by themselves, as described above.

## Updates

The plugin updates itself from this repo's **latest release**, never from the main branch. On startup it compares the release's version with the installed one and, if the release is newer, downloads the new files (`main.js`, `styles.css`, `lib.js`, `manifest.json`), writes them (the manifest last, so a failure retries on the next start) and reloads. It refuses to install a release whose plugin ID doesn't match, or whose tag doesn't match the version inside it. The command **Check for update now** does the same on demand.

The ID `vr-vault-management` is deliberately unique, so Obsidian's "Check for updates" can't replace it with a different plugin.

## Releasing

Work on `main` is never installed by anyone. To ship a change:

1. Raise `version` in `manifest.json` and add it to `versions.json`, then run `npm run build` and commit everything, including the built `main.js` and `lib.js`.
2. Push, and wait for the **CI** workflow to pass: it type-checks, builds, checks that the committed `main.js` and `lib.js` match a fresh build, and runs the tests.
3. Push a tag with the same number: `git tag 1.3.1 && git push origin 1.3.1`. The **Release** workflow checks the tag against `manifest.json`, builds and tests again, and keeps the tested files.
4. **Approve the release.** Publishing then waits for a manual approval: GitHub > Actions > the release run > **Review deployments** > tick **release** > **Approve and deploy**. Only then are `main.js`, `manifest.json`, `styles.css` and `lib.js` published, exactly as tested. If anything fails, or nobody approves, no release is made and nothing reaches any device.

Release tags are permanent: they can't be moved or deleted, and `main` can't be force-pushed or deleted. If a tagged release goes wrong, fix it with a new version number. Actions > **Release** > **Run workflow** on `main` is a dry run: it builds and tests and publishes nothing.

(Installs older than 1.3.0 updated from the main branch's files, so main keeps the built files of the latest release until those are gone.)

## Build

```bash
npm ci
npm run build
```

`npm run dev` rebuilds on every save. Source is in `src/`, one file per feature in `src/features/`.

## Tests

```bash
npm run build
npm install --no-save playwright@1.49.1 && npx playwright install chromium   # once
npm test
```

The tests (`tests/*.test.cjs`) load the built `main.js` into a headless Chromium with the real CodeMirror and a stand-in for Obsidian's plugin API, and cover every feature, the settings, the updater and the Bulk Properties undo. They are also run by GitHub Actions on every push.

## Credits and license

The color swatch feature is based on [S-Color-Inline](https://github.com/Abdulkader-Safi/s-color-inline) by Abdulkader Safi, which is based on [Inline Color Swatch](https://github.com/Suika225/inline-color-swatch) by Suika. MIT license, see [LICENSE](LICENSE).
