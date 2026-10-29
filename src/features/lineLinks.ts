import type { Editor, EditorPosition } from "obsidian";
import type { Host } from "../settings";

// Lines to links: the "Turn lines into links" command (Shift+Alt+L) wraps each
// line of the selection in [[ ]], or the current line when nothing is
// selected. Indent, quote markers, list and task markers and heading marks
// stay in front of the link. Blank lines and lines that already have a link
// are left alone.

// [indent and quotes][heading | bullet or number, then an optional task box] text
const LINE = /^(\s*(?:>\s?)*\s*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)?)(.*?)\s*$/;

function linkLine(line: string): string {
	const m = LINE.exec(line);
	if (!m || !m[2] || m[2].includes("[[")) return line;
	return `${m[1]}[[${m[2]}]]`;
}

function linkText(text: string): string {
	return text.split("\n").map(linkLine).join("\n");
}

const before = (a: EditorPosition, b: EditorPosition) => a.line < b.line || (a.line === b.line && a.ch < b.ch);

function linkSelections(editor: Editor): void {
	if (!editor.somethingSelected()) {
		const { line } = editor.getCursor();
		const text = editor.getLine(line);
		const linked = linkLine(text);
		if (linked !== text) editor.replaceRange(linked, { line, ch: 0 }, { line, ch: text.length });
		return;
	}
	// last selection first, so earlier positions stay valid
	const ranges = editor
		.listSelections()
		.map(({ anchor, head }) => (before(head, anchor) ? { from: head, to: anchor } : { from: anchor, to: head }))
		.sort((a, b) => (before(a.from, b.from) ? 1 : -1));
	for (const { from, to } of ranges) editor.replaceRange(linkText(editor.getRange(from, to)), from, to);
}

export function setupLineLinks(plugin: Host): void {
	plugin.addCommand({
		id: "lines-to-links",
		name: "Turn lines into links",
		hotkeys: [{ modifiers: ["Shift", "Alt"], key: "L" }],
		editorCallback: (editor) => linkSelections(editor),
	});
}

/* for tests outside Obsidian */
export const _test = { linkLine, linkText };
