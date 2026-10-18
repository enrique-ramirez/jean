import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LAST_CODE_POINT = 0x10ffff;
const MOST_CODE_POINTS_A_LOWER_CASE_TAKES = 2;
const MOST_CODE_POINTS_A_DECOMPOSITION_TAKES = 4;
const MOST_CHARACTERS_AN_ASCII_FOLDING_TAKES = 7;
// The folds build a regex character class from the keys unescaped, which an ASCII key could break.
const FIRST_NON_ASCII = 0x80;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, "..", "src", "core", "unicode_tables.cpp");
const LATIN_ASCII = join(HERE, "Latin-ASCII.xml");
const ASCII_FOLDING_OUTPUT = join(
	HERE,
	"..",
	"..",
	"..",
	"ui",
	"src",
	"shared",
	"lib",
	"asciiFolding.ts",
);

const CASED = /^\p{Cased}$/u;
const CASE_IGNORABLE = /^\p{Case_Ignorable}$/u;
const DIACRITIC = /^\p{Diacritic}$/u;
const LETTER = /^\p{L}$/u;
const NUMBER = /^\p{N}$/u;
const MARK = /^\p{M}$/u;

const ACUTE = "\u0301";
const GRAVE_BELOW = "\u0316";

function hex(value) {
	return `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
}

function lowerMappings() {
	const mappings = [];
	for (let cp = 0; cp <= LAST_CODE_POINT; cp += 1) {
		const original = String.fromCodePoint(cp);
		const lower = original.toLowerCase();
		if (lower === original) continue;

		const lowered = [...lower].map((letter) => letter.codePointAt(0));
		if (lowered.length > MOST_CODE_POINTS_A_LOWER_CASE_TAKES)
			throw new Error(
				`U+${hex(cp)} lower-cases to ${lowered.length} code points`,
			);

		mappings.push([cp, lowered[0], lowered[1] ?? 0]);
	}
	return mappings;
}

function decompositions() {
	const rows = [];
	for (let cp = 0; cp <= LAST_CODE_POINT; cp += 1) {
		const original = String.fromCodePoint(cp);
		const decomposed = original.normalize("NFD");
		if (decomposed === original) continue;

		const parts = [...decomposed].map((letter) => letter.codePointAt(0));
		if (parts.length > MOST_CODE_POINTS_A_DECOMPOSITION_TAKES)
			throw new Error(`U+${hex(cp)} decomposes to ${parts.length} code points`);

		rows.push([
			cp,
			...parts,
			...Array(MOST_CODE_POINTS_A_DECOMPOSITION_TAKES - parts.length).fill(0),
		]);
	}
	return rows;
}

function swaps(first, second) {
	return `a${first}${second}`.normalize("NFD") === `a${second}${first}`;
}

function ordersAfterBase(mark) {
	return (
		swaps(mark, ACUTE) ||
		swaps(ACUTE, mark) ||
		swaps(mark, GRAVE_BELOW) ||
		swaps(GRAVE_BELOW, mark)
	);
}

function compareByCombiningClass(a, b) {
	if (swaps(a, b)) return 1;
	if (swaps(b, a)) return -1;
	return 0;
}

// Only marks NFD leaves whole are ranked: a mark that decomposes is replaced before any ordering.
function markRanges() {
	const marks = [];
	for (let cp = 0; cp <= LAST_CODE_POINT; cp += 1) {
		const mark = String.fromCodePoint(cp);
		if (!MARK.test(mark) || mark.normalize("NFD") !== mark) continue;
		if (ordersAfterBase(mark)) marks.push(mark);
	}

	const ordered = marks.sort(compareByCombiningClass);
	const ranked = [];
	let rank = 0;
	ordered.forEach((mark, at) => {
		if (at === 0 || compareByCombiningClass(ordered[at - 1], mark) !== 0)
			rank += 1;
		ranked.push([mark.codePointAt(0), rank]);
	});

	const ranges = [];
	for (const [cp, markRank] of ranked.sort((a, b) => a[0] - b[0])) {
		const last = ranges.at(-1);
		if (last && last[1] + 1 === cp && last[2] === markRank) last[1] = cp;
		else ranges.push([cp, cp, markRank]);
	}
	return ranges;
}

const unescaped = (rule) =>
	rule.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
		String.fromCodePoint(Number.parseInt(hex, 16)),
	);

// A rule is one character, an arrow and its ASCII spelling, bare or quoted; the file's own NFD and
// mark-removal directives are what `fold` already does before it reaches the table.
const CLDR_RULE = /^\\?(.) → (?:'([^']*)'|(\S+)) ;/su;

const DOT_LIKE = [
	"\u00B7",
	"\u2022",
	"\u2027",
	"\u2219",
	"\u22C5",
	"\u2E31",
	"\u2E33",
	"\u30FB",
	"\uFF65",
];

const folded = (text) =>
	text
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "");

function cldrRules() {
	const rules = new Map();
	for (const line of readFileSync(LATIN_ASCII, "utf8").split("\n")) {
		const rule = CLDR_RULE.exec(unescaped(line));
		if (!rule) continue;
		const [, from, quoted, bare] = rule;
		rules.set(from, quoted ?? bare);
	}
	return rules;
}

function asciiFoldings() {
	const rules = cldrRules();
	const foldings = new Map();
	for (const [from, to] of rules) {
		const key = folded(from);
		if ([...key].length !== 1 || key === to.toLowerCase()) continue;

		const held = foldings.get(key);
		if (held !== undefined && held !== to.toLowerCase())
			throw new Error(
				`${from} folds to ${key}, which ${held} and ${to} both claim`,
			);
		foldings.set(key, to.toLowerCase());
	}
	// The middle dot is a Diacritic, so `folded` would drop it as a key: it is added raw, and the
	// fold maps it before the marks go.
	for (const dot of DOT_LIKE) {
		if (foldings.has(dot))
			throw new Error(`CLDR already maps U+${hex(dot.codePointAt(0))}`);
		foldings.set(dot, ".");
	}
	for (const [key, to] of foldings) {
		if (
			!/^[\x20-\x7e]+$/.test(to) ||
			to.length > MOST_CHARACTERS_AN_ASCII_FOLDING_TAKES
		)
			throw new Error(
				`U+${hex(key.codePointAt(0))} folds to ${JSON.stringify(to)}`,
			);
		if (key.codePointAt(0) < FIRST_NON_ASCII)
			throw new Error(`U+${hex(key.codePointAt(0))} is ASCII`);
	}
	return [...foldings].sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0));
}

function rangesWhere(pattern) {
	const ranges = [];
	for (let cp = 0; cp <= LAST_CODE_POINT; cp += 1) {
		if (!pattern.test(String.fromCodePoint(cp))) continue;

		const last = ranges.at(-1);
		if (last && last[1] + 1 === cp) last[1] = cp;
		else ranges.push([cp, cp]);
	}
	return ranges;
}

function cells(entry) {
	return entry
		.map((cell) => (Array.isArray(cell) ? `{${cells(cell)}}` : hex(cell)))
		.join(", ");
}

function rows(entries) {
	return entries.map((entry) => `    {${cells(entry)}},`).join("\n");
}

const mappings = lowerMappings();
const decomposing = decompositions().map(([from, ...to]) => [from, to]);
const marks = markRanges();
const cased = rangesWhere(CASED);
const caseIgnorable = rangesWhere(CASE_IGNORABLE);
const diacritic = rangesWhere(DIACRITIC);
const letters = rangesWhere(LETTER);
const numbers = rangesWhere(NUMBER);
const foldings = asciiFoldings();

const foldingRows = foldings
	.map(
		([from, to]) => `    {${hex(from.codePointAt(0))}, ${JSON.stringify(to)}},`,
	)
	.join("\n");

const source = `// Generated by scripts/unicode-tables.mjs from Unicode ${process.versions.unicode} as Node ${process.versions.node} reports it, and from the CLDR Latin-ASCII transform beside the script. Do not edit.
#include "core/unicode_tables.h"

namespace jean {

namespace {

// clang-format off
constexpr LowerMapping kLowerMappings[] = {
${rows(mappings)}
};

constexpr Decomposition kDecompositions[] = {
${rows(decomposing)}
};

constexpr MarkRankRange kMarkRanks[] = {
${rows(marks)}
};

constexpr CodePointRange kCased[] = {
${rows(cased)}
};

constexpr CodePointRange kCaseIgnorable[] = {
${rows(caseIgnorable)}
};

constexpr CodePointRange kDiacritic[] = {
${rows(diacritic)}
};

constexpr CodePointRange kLetter[] = {
${rows(letters)}
};

constexpr CodePointRange kNumber[] = {
${rows(numbers)}
};

constexpr AsciiFolding kAsciiFoldings[] = {
${foldingRows}
};
// clang-format on

}  // namespace

std::span<const LowerMapping> lowerMappings() {
    return kLowerMappings;
}

std::span<const Decomposition> decompositions() {
    return kDecompositions;
}

std::span<const MarkRankRange> markRanks() {
    return kMarkRanks;
}

std::span<const CodePointRange> casedRanges() {
    return kCased;
}

std::span<const CodePointRange> caseIgnorableRanges() {
    return kCaseIgnorable;
}

std::span<const CodePointRange> diacriticRanges() {
    return kDiacritic;
}

std::span<const CodePointRange> letterRanges() {
    return kLetter;
}

std::span<const CodePointRange> numberRanges() {
    return kNumber;
}

std::span<const AsciiFolding> asciiFoldings() {
    return kAsciiFoldings;
}

}  // namespace jean
`;

writeFileSync(OUTPUT, source);

const foldingEntries = foldings
	.map(([from, to]) => `\t[${JSON.stringify(from)}, ${JSON.stringify(to)}],`)
	.join("\n");

writeFileSync(
	ASCII_FOLDING_OUTPUT,
	`// Generated by plugins/fb2k/scripts/unicode-tables.mjs from CLDR's Latin-ASCII transform. Do not edit.
export const ASCII_FOLDINGS: ReadonlyMap<string, string> = new Map([
${foldingEntries}
]);
`,
);
execFileSync(
	"pnpm",
	["exec", "biome", "format", "--write", ASCII_FOLDING_OUTPUT],
	{
		stdio: "inherit",
	},
);
