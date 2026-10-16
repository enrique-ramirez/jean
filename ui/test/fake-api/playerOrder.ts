// foobar2000 orders library paths through fb2k::sortStringCompare, on Windows StrCmpLogicalW with a
// wcscmp tiebreak. This reproduces the order a player gave a table of crafted paths, which
// test/unit/playerOrder.test.ts holds it to.

// foobar2000 on Windows weighs `+` after `~`, not at its ASCII position. `=` is placed beside it
// unmeasured, and `<` and `>` cannot appear in a Windows file name.
const SYMBOLS = ' !"#$%&()*,./:;?@[\\]^_`{|}~+<=>';
const IGNORED = ["'", "-"];
const EXPANSIONS: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe" };

type Token =
	| { kind: "symbol"; rank: number }
	| { kind: "number"; value: bigint; digits: string }
	| { kind: "letter"; base: string; accented: boolean }
	| { kind: "script"; code: number };

const KIND_ORDER: Record<Token["kind"], number> = {
	symbol: 0,
	number: 1,
	letter: 2,
	script: 3,
};

const isDigit = (char: string) => char >= "0" && char <= "9";

const symbolTokens = new Map<number, Token>();
const plainLetterTokens = new Map<string, Token>();
const accentedLetterTokens = new Map<string, Token>();
const scriptTokens = new Map<number, Token>();

const interned = <K>(held: Map<K, Token>, key: K, make: () => Token) => {
	let token = held.get(key);
	if (!token) {
		token = make();
		held.set(key, token);
	}
	return token;
};

const letterToken = (letter: string, accented: boolean) =>
	interned(accented ? accentedLetterTokens : plainLetterTokens, letter, () => ({
		kind: "letter",
		base: letter,
		accented,
	}));

function tokens(text: string): { primary: Token[]; ignored: string } {
	const primary: Token[] = [];
	let ignored = "";
	const chars = [...text.toLowerCase()];

	for (let at = 0; at < chars.length; at++) {
		const char = chars[at];
		if (IGNORED.includes(char)) {
			ignored += char;
			continue;
		}
		if (isDigit(char)) {
			let digits = char;
			while (at + 1 < chars.length && isDigit(chars[at + 1]))
				digits += chars[++at];
			primary.push({ kind: "number", value: BigInt(digits), digits });
			continue;
		}
		const symbol = SYMBOLS.indexOf(char);
		if (symbol >= 0) {
			primary.push(
				interned(symbolTokens, symbol, () => ({
					kind: "symbol",
					rank: symbol,
				})),
			);
			continue;
		}
		if (char >= "a" && char <= "z") {
			primary.push(letterToken(char, false));
			continue;
		}
		const expanded = EXPANSIONS[char];
		const base = expanded ?? char.normalize("NFD").replace(/\p{M}/gu, "");
		if (/^[a-z]+$/.test(base)) {
			for (const letter of base)
				primary.push(letterToken(letter, base !== char));
			continue;
		}
		const code = char.codePointAt(0) ?? 0;
		primary.push(
			interned(scriptTokens, code, () => ({ kind: "script", code })),
		);
	}

	return { primary, ignored };
}

const byPrimary = (a: Token, b: Token): number => {
	if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
	switch (a.kind) {
		case "symbol":
			return a.rank - (b as typeof a).rank;
		case "number": {
			const other = (b as typeof a).value;
			return a.value < other ? -1 : a.value > other ? 1 : 0;
		}
		case "letter":
			return a.base < (b as typeof a).base
				? -1
				: a.base > (b as typeof a).base
					? 1
					: 0;
		case "script":
			return a.code - (b as typeof a).code;
	}
};

const byAccent = (a: Token, b: Token) =>
	a.kind === "letter" && b.kind === "letter"
		? Number(a.accented) - Number(b.accented)
		: 0;

const byLeadingZeros = (a: Token, b: Token) =>
	a.kind === "number" && b.kind === "number"
		? b.digits.length - a.digits.length
		: 0;

const byIgnoredRank = (a: string, b: string) =>
	IGNORED.indexOf(a) - IGNORED.indexOf(b);

function compareLevel<T>(a: T[], b: T[], level: (a: T, b: T) => number) {
	for (let at = 0; at < Math.min(a.length, b.length); at++) {
		if (a[at] === b[at]) continue;
		const order = level(a[at], b[at]);
		if (order !== 0) return order;
	}
	return a.length - b.length;
}

export interface TextKey {
	text: string;
	primary: Token[];
	ignored: string;
}

export const textKey = (text: unknown): TextKey => {
	const read = String(text);
	return { text: read, ...tokens(read) };
};

const PRIMARY_LEVELS = [byPrimary, byAccent, byLeadingZeros];

export function compareKeys(x: TextKey, y: TextKey): number {
	for (const level of PRIMARY_LEVELS) {
		const order = compareLevel(x.primary, y.primary, level);
		if (order !== 0) return order;
	}

	const ignored = compareLevel([...x.ignored], [...y.ignored], byIgnoredRank);
	if (ignored !== 0) return ignored;

	return x.text < y.text ? -1 : x.text > y.text ? 1 : 0;
}

export const compareText = (a: unknown, b: unknown): number =>
	compareKeys(textKey(a), textKey(b));

// foobar2000 compares a path with `\` between folders, and `\` and `/` weigh differently.
export const pathKey = (value: unknown) => String(value).replace(/\//g, "\\");
