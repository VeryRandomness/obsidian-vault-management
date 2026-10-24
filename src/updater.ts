import { Notice, Plugin, requestUrl } from "obsidian";

export const REPO = "VeryRandomness/obsidian-vault-management";

// The plugin updates itself from the repo's latest GitHub *release*, never from
// the main branch. A release is made on purpose (a version tag, built and
// tested by the release workflow), so work in progress on main is never
// installed on anyone's device.

function newer(remote: string, local: string): boolean {
	const a = remote.split(".").map((n) => parseInt(n, 10) || 0);
	const b = local.split(".").map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return false;
}

interface Release {
	tag: string;
	// file name -> download address
	assets: Record<string, string>;
}

async function latestRelease(repo: string): Promise<Release> {
	const res = await requestUrl({
		url: `https://api.github.com/repos/${repo}/releases/latest`,
		headers: { Accept: "application/vnd.github+json", "Cache-Control": "no-cache" },
	});
	const json = res.json as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] } | undefined;
	if (!json?.tag_name) throw new Error("no release has been published yet");
	const assets: Record<string, string> = {};
	for (const a of json.assets ?? []) assets[a.name] = a.browser_download_url;
	return { tag: json.tag_name, assets };
}

async function download(release: Release, file: string): Promise<string> {
	const url = release.assets[file];
	if (!url) throw new Error(`release ${release.tag} has no ${file}`);
	return (await requestUrl({ url, headers: { "Cache-Control": "no-cache" } })).text;
}

// One file from the latest release, for files the plugin fetches itself
export async function fetchReleaseAsset(repo: string, file: string): Promise<string> {
	return download(await latestRelease(repo), file);
}

async function check(plugin: Plugin, repo: string, manual: boolean) {
	const { manifest, app } = plugin;
	try {
		const release = await latestRelease(repo);
		const remoteManifest = await download(release, "manifest.json");
		const remote = JSON.parse(remoteManifest);
		// Never install another plugin's files into this folder.
		if (remote.id !== manifest.id) throw new Error(`the release's manifest has a different plugin id (${remote.id})`);
		const version: string = remote.version;
		// A release whose tag and manifest disagree was made by mistake: don't install it.
		if (release.tag.replace(/^v/, "") !== version) throw new Error(`release ${release.tag} contains version ${version}`);
		// Read the installed version from disk: after a reload Obsidian keeps serving the stale in-memory manifest.
		let installed = manifest.version;
		try { installed = JSON.parse(await app.vault.adapter.read(`${manifest.dir}/manifest.json`)).version; } catch { /* use in-memory */ }
		if (!newer(version, installed)) {
			if (manual) new Notice(`${manifest.name} is up to date (version ${installed}).`);
			return;
		}

		// Download everything first, then write: a failed download changes nothing.
		const mainJs = await download(release, "main.js");
		if (!mainJs.trim()) throw new Error("downloaded main.js is empty");
		const optional = async (file: string): Promise<string | null> => {
			if (!release.assets[file]) return null;
			const text = await download(release, file);
			return text.trim() ? text : null;
		};
		const css = await optional("styles.css");
		const lib = await optional("lib.js");

		const dir = manifest.dir!;
		const adapter = app.vault.adapter;
		await adapter.write(`${dir}/main.js`, mainJs);
		if (css !== null) await adapter.write(`${dir}/styles.css`, css);
		if (lib !== null) await adapter.write(`${dir}/lib.js`, lib);
		// The manifest goes last: if anything above failed, the version on disk is
		// still the old one and the next start tries again.
		await adapter.write(`${dir}/manifest.json`, remoteManifest);

		new Notice(`${manifest.name} updated to ${version}. Reloading…`);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const plugins = (app as any).plugins;
		setTimeout(async () => {
			await plugins.disablePlugin(manifest.id);
			await plugins.enablePlugin(manifest.id);
		}, 500);
	} catch (e) {
		console.error(`${manifest.name} auto-update:`, e);
		if (manual) new Notice(`Update check failed: ${(e as Error).message}`);
	}
}

/** Checks `repo` on GitHub for a newer release on startup and installs it. Call from onload(). */
export function setupAutoUpdate(plugin: Plugin, repo: string) {
	plugin.addCommand({
		id: "check-for-update",
		name: "Check for update now",
		callback: () => check(plugin, repo, true),
	});
	plugin.app.workspace.onLayoutReady(() => check(plugin, repo, false));
}
