import { fold } from "@/shared/lib/text";

export type ValueField = "artist" | "album artist" | "album" | "genre";
export type ValueSource = Readonly<Record<ValueField, readonly string[]>>;

export interface Suggestion {
	kind: "field" | "operator" | "value" | "junction";
	label: string;
	insert: string;
}

export interface Completion {
	from: number;
	to: number;
	suggestions: Suggestion[];
}

const OPERATORS = [
	"HAS",
	"IS",
	"MISSING",
	"PRESENT",
	"GREATER",
	"LESS",
	"EQUAL",
	"BEFORE",
	"AFTER",
	"SINCE",
	"DURING",
];
const JUNCTIONS = ["AND", "OR", "NOT", "SORT BY"];

export const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;

const FIELDS: readonly { label: string; insert: string }[] = [
	"artist",
	"album artist",
	"album",
	"title",
	"genre",
	"date",
	"rating",
	"composer",
	"publisher",
	"codec",
	"path",
].map((name) => ({
	label: name,
	// A bare `path` is not a field in a foobar2000 query; `%path%` is.
	insert: name === "path" ? "%path%" : name.includes(" ") ? quoted(name) : name,
}));

export const KEYWORDS: ReadonlySet<string> = new Set([
	...OPERATORS,
	"AND",
	"OR",
	"NOT",
	"SORT",
	"BY",
	"ALL",
	"ASCENDING",
	"DESCENDING",
	"LAST",
]);

const VALUE_FIELDS: readonly string[] = [
	"artist",
	"album artist",
	"album",
	"genre",
] satisfies ValueField[];

const isValueField = (field: string): field is ValueField =>
	VALUE_FIELDS.includes(field);

export const quoteValue = (value: string) =>
	value === "" || /[\s"()]/.test(value) || KEYWORDS.has(value.toUpperCase())
		? quoted(value)
		: value;

interface Token {
	text: string;
	start: number;
	closed: boolean;
	bracket?: boolean;
}

function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < text.length) {
		if (/\s/.test(text[i])) {
			i++;
			continue;
		}
		const start = i;
		if (text[i] === "(" || text[i] === ")") {
			tokens.push({ text: text[i], start, closed: true, bracket: true });
			i++;
		} else if (text[i] === '"') {
			let content = "";
			i++;
			let closed = false;
			while (i < text.length) {
				if (text[i] === '"') {
					if (text[i + 1] === '"') {
						content += '"';
						i += 2;
						continue;
					}
					closed = true;
					i++;
					break;
				}
				content += text[i++];
			}
			tokens.push({ text: content, start, closed });
		} else {
			while (i < text.length && !/[\s()]/.test(text[i])) i++;
			tokens.push({ text: text.slice(start, i), start, closed: true });
		}
	}
	return tokens;
}

type State =
	| { at: "field" }
	| { at: "operator"; field: string }
	| { at: "value"; field: ValueField | undefined }
	| { at: "complete" }
	| { at: "sort" };

function advance(state: State, token: Token, source: string): State {
	if (token.bracket)
		return token.text === ")" ? { at: "complete" } : { at: "field" };
	const word = source[token.start] === '"' ? "" : token.text.toUpperCase();
	switch (state.at) {
		case "field":
			if (word === "NOT") return state;
			if (word === "SORT") return { at: "sort" };
			return { at: "operator", field: fold(token.text) };
		case "operator":
			if (word === "MISSING" || word === "PRESENT") return { at: "complete" };
			if (word === "IS" || word === "HAS")
				return {
					at: "value",
					field: isValueField(state.field) ? state.field : undefined,
				};
			return { at: "value", field: undefined };
		case "value":
			return { at: "complete" };
		case "sort":
			return word === "BY" ? { at: "field" } : state;
		case "complete":
			if (word === "AND" || word === "OR" || word === "NOT")
				return { at: "field" };
			if (word === "SORT") return { at: "sort" };
			return state;
	}
}

const foldedValues = new WeakMap<readonly string[], string[]>();

function folded(values: readonly string[]): string[] {
	let cached = foldedValues.get(values);
	if (!cached) {
		cached = values.map(fold);
		foldedValues.set(values, cached);
	}
	return cached;
}

function suggest(
	state: State,
	prefix: string,
	values: ValueSource,
): Suggestion[] {
	const matches = (label: string) => fold(label).startsWith(prefix);
	const words = (kind: Suggestion["kind"], list: readonly string[]) =>
		list
			.filter(matches)
			.map((word): Suggestion => ({ kind, label: word, insert: word }));
	switch (state.at) {
		case "field":
			return FIELDS.filter((field) => matches(field.label)).map((field) => ({
				kind: "field",
				...field,
			}));
		case "operator":
			return words("operator", OPERATORS);
		case "value": {
			if (!state.field) return [];
			const list = values[state.field];
			const keys = folded(list);
			return list
				.filter((_, i) => keys[i].startsWith(prefix))
				.map((value) => ({
					kind: "value",
					label: value,
					insert: quoteValue(value),
				}));
		}
		case "complete":
			return words("junction", JUNCTIONS);
		case "sort":
			return words("junction", ["BY"]);
	}
}

export function completionsAt(
	text: string,
	caret: number,
	values: ValueSource,
): Completion {
	const head = text.slice(0, caret);
	const tokens = tokenize(head);
	const last = tokens.at(-1);
	const partial =
		last && !last.bracket && (!last.closed || !/\s$/.test(head))
			? last
			: undefined;
	const finished = partial ? tokens.slice(0, -1) : tokens;
	const from = partial ? partial.start : caret;
	const prefix = fold(partial?.text ?? "");

	let state: State = { at: "field" };
	for (const token of finished) state = advance(state, token, head);

	return {
		from,
		to: caret,
		suggestions: suggest(state, prefix, values),
	};
}
