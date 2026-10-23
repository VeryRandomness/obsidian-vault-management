// Color detection for S-Color-Inline: is a piece of text a CSS color, which
// text color reads well on it, and where are colors inside a block of code.
// The browser's own CSS parser does the actual parsing, so everything the
// browser understands works: hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(),
// oklch(), color(), color-mix() and named colors, in old and new syntax.

export interface ColorOptions {
	// treat color names like `red` or `rebeccapurple` as colors
	named: boolean;
}

export interface ResolvedColor {
	// the color as written, valid as a CSS value
	css: string;
	// black or white, whichever reads better on the color
	text: string;
}

export interface ColorMatch {
	start: number;
	end: number;
	value: string;
	color: ResolvedColor;
}

// The CSS color keywords, plus transparent. System colors (canvas, buttontext)
// and currentcolor depend on the theme, so they are not included.
const NAMED = new Set<string>(`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon
darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue
lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue
mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent`.split(/\s+/));

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_START = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const DYNAMIC = /\b(?:var|env|attr)\s*\(/i;
const CSS_LIKE = new Set(["css", "scss", "sass", "less", "styl", "stylus", "html", "svg", "xml"]);

let canvas: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, ResolvedColor | null>();

function context(): CanvasRenderingContext2D | null {
	if (canvas === undefined) {
		const el = document.createElement("canvas");
		el.width = el.height = 1;
		canvas = el.getContext("2d", { willReadFrequently: true });
	}
	return canvas;
}

// Black or white text, whichever reads better on the color. Mostly
// transparent colors keep the theme's code text color.
export function textColorFor(r: number, g: number, b: number, a: number): string {
	if (a < 0.5) return "var(--code-normal)";
	return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? "#000" : "#fff";
}

function compute(s: string): ResolvedColor | null {
	if (DYNAMIC.test(s)) return null;
	if (typeof CSS !== "undefined" && !CSS.supports("color", s)) return null;
	const ctx = context();
	if (!ctx) return null;
	// A canvas ignores a color it can't parse and keeps the previous one, so
	// parse it twice from different starting colors: a real color gives the
	// same result both times.
	ctx.fillStyle = "#000";
	ctx.fillStyle = s;
	const first = ctx.fillStyle;
	ctx.fillStyle = "#fff";
	ctx.fillStyle = s;
	if (ctx.fillStyle !== first) return null;
	ctx.clearRect(0, 0, 1, 1);
	ctx.fillRect(0, 0, 1, 1);
	const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
	return { css: s, text: textColorFor(r, g, b, a / 255) };
}

function resolveCss(s: string): ResolvedColor | null {
	const known = cache.get(s);
	if (known !== undefined) return known;
	const result = compute(s);
	if (cache.size > 2000) cache.clear();
	cache.set(s, result);
	return result;
}

function looksLikeColor(s: string, named: boolean): boolean {
	return HEX.test(s) || FUNCTION_START.test(s) || (named && NAMED.has(s.toLowerCase()));
}

// The color in a piece of text that should be exactly one color, or null
export function resolveColor(raw: string, opts: ColorOptions): ResolvedColor | null {
	const s = raw.trim();
	if (!s || s.length > 120 || /[;{}<>\n]/.test(s)) return null;
	if (!looksLikeColor(s, opts.named)) return null;
	return resolveCss(s);
}

// Position of the ")" that closes the "(" before `from`, within a short span
// of one line, or -1
function closingParen(text: string, from: number): number {
	let depth = 1;
	for (let i = from; i < text.length && i < from + 160; i++) {
		const ch = text.charAt(i);
		if (ch === "(") depth++;
		else if (ch === ")" && --depth === 0) return i;
		else if (ch === "\n") return -1;
	}
	return -1;
}

const TOKEN = /(#[0-9a-fA-F]+)|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\(|([A-Za-z][\w-]*)/g;

// Colors inside code. Hex and functions are found in any language. Color
// names only in CSS-like languages, where `red` is a color and not a word.
// Outside those, a hex color needs six or eight digits or a quote in front,
// so a comment like `#add feature` is left alone.
export function findColorsInCode(text: string, lang: string, named: boolean): ColorMatch[] {
	const cssLike = CSS_LIKE.has(lang);
	const found: ColorMatch[] = [];
	TOKEN.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TOKEN.exec(text)) !== null) {
		const start = m.index;
		const prev = start > 0 ? text.charAt(start - 1) : "";
		let end = -1;
		if (m[1]) {
			const digits = m[1].length - 1;
			const next = text.charAt(start + m[1].length);
			if (![3, 4, 6, 8].includes(digits) || /[\w]/.test(next) || /[\w&/#]/.test(prev)) continue;
			if (!cssLike && digits !== 6 && digits !== 8 && !/["'`]/.test(prev)) continue;
			end = start + m[1].length;
		} else if (m[2]) {
			if (/[\w.$@-]/.test(prev)) continue;
			const close = closingParen(text, start + m[0].length);
			if (close < 0) continue;
			end = close + 1;
			TOKEN.lastIndex = end;
		} else if (m[3]) {
			if (!named || !cssLike || !NAMED.has(m[3].toLowerCase())) continue;
			end = start + m[3].length;
			const next = text.slice(end).replace(/^\s+/, "").charAt(0);
			if (/[.#$@:=(]/.test(prev) || prev === "-" || prev === "_" || next === "(" || next === ":") continue;
		}
		if (end < 0) continue;
		const value = text.slice(start, end);
		const color = resolveColor(value, { named });
		if (color) found.push({ start, end, value, color });
	}
	return found;
}

// Where each line of a note sits: front matter and code fences are tracked,
// so inline code is only looked for in text, and colors in code blocks only
// inside fences. Feed it the lines in order.
export type LineKind = { kind: "skip" | "text" } | { kind: "code"; lang: string };

export class LineScanner {
	private fence = "";
	private lang = "";
	private frontMatter = false;
	private count = 0;

	next(text: string): LineKind {
		const first = this.count++ === 0;
		const trimmed = text.trim();
		if (first && trimmed === "---") {
			this.frontMatter = true;
			return { kind: "skip" };
		}
		if (this.frontMatter) {
			if (trimmed === "---" || trimmed === "...") this.frontMatter = false;
			return { kind: "skip" };
		}
		const f = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(text);
		if (this.fence) {
			if (f && f[1] && f[1].charAt(0) === this.fence.charAt(0) && f[1].length >= this.fence.length && /^\s*(`+|~+)\s*$/.test(text)) {
				this.fence = "";
				return { kind: "skip" };
			}
			return { kind: "code", lang: this.lang };
		}
		if (f && f[1]) {
			this.fence = f[1];
			this.lang = (f[2] ?? "").replace(/^[{.]+/, "").toLowerCase();
			return { kind: "skip" };
		}
		return { kind: "text" };
	}
}
