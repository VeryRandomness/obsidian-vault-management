// What GitHub serves for a repo's latest release, in the form the harness's
// requestUrl understands: releaseWeb(repo, tag, { "manifest.json": "...", ... })
function releaseWeb(repo, tag, files) {
	const web = {
		[repo + ":release"]: {
			tag_name: tag,
			assets: Object.keys(files).map((name) => ({ name, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` })),
		},
	};
	for (const name of Object.keys(files)) web[repo + ":" + name] = files[name];
	return web;
}

module.exports = { releaseWeb };
