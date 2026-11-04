import { GENRE_EXPRESSION } from "../../src/shared/api/multiValue.ts";
import { RATING_EXPRESSION } from "../../src/shared/api/rating.ts";
import type { Track } from "./capturedLibrary.ts";
import { compareText } from "./playerOrder.ts";

// foobar2000 answers a single-valued genre the same through `%genre%` and `GENRE_EXPRESSION`, and,
// with no foo_playcount, a rating the same through `%rating%` and `RATING_EXPRESSION`.
const PLAIN_SPELLING = new Map([
	[GENRE_EXPRESSION, "%genre%"],
	[RATING_EXPRESSION, "%rating%"],
]);

const argumentsOf = (inside: string) => {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;
	for (let at = 0; at < inside.length; at++) {
		if (inside[at] === "(") depth += 1;
		else if (inside[at] === ")") depth -= 1;
		else if (inside[at] === "," && depth === 0) {
			parts.push(inside.slice(from, at));
			from = at + 1;
		}
		if (depth < 0) return null;
	}
	parts.push(inside.slice(from));
	return depth === 0 ? parts : null;
};

const CALL = /^\$(\w+)\((.*)\)$/s;

type Formatted = { text: string; isTrue: boolean } | null;
type Format = (track: Track) => Formatted;

const formats = new Map<string, Format>();

const formatOf = (expression: string): Format => {
	const kept = formats.get(expression);
	if (kept) return kept;

	const call = CALL.exec(expression);
	const parts = call && argumentsOf(call[2]);
	let derived: Format = () => null;
	if (call && parts) {
		if (call[1] === "meta" && parts.length === 1) {
			const field = `$meta(${parts[0].toLowerCase()})`;
			derived = (track) => {
				const text = track[field] ?? "";
				return { text, isTrue: text !== "" };
			};
		} else if (call[1] === "meta_sep" && parts.length === 2) {
			const field = `$meta_sep(${parts[0].toLowerCase()},${parts[1]})`;
			derived = (track) => {
				const text = track[field] ?? "";
				return { text, isTrue: text !== "" };
			};
		} else if (call[1] === "if2" && parts.length === 2) {
			const first = formatOf(parts[0]);
			const second = formatOf(parts[1]);
			derived = (track) => {
				const found = first(track);
				return found?.isTrue ? found : second(track);
			};
		}
	}

	const format: Format = (track) => {
		const held = track[expression];
		if (held !== undefined)
			return { text: held, isTrue: held !== "" && held !== "?" };
		return derived(track);
	};
	formats.set(expression, format);
	return format;
};

// foobar2000 title formatting: `$meta(x)` and `$meta_sep(x,...)` answer '' and false for a file without the field, where
// `%x%` answers `?`; `$if2(a,b)` answers `a` where it is true and `b` otherwise.
const titleFormat = (track: Track, expression: string): Formatted =>
	formatOf(expression)(track);

export const evaluate = (track: Track, expression: string) => {
	const plain = PLAIN_SPELLING.get(expression);
	return (
		track[expression] ??
		(plain && track[plain]) ??
		titleFormat(track, expression)?.text ??
		"?"
	);
};

// `order[new] = old` for a stable ascending sort by the `|`-joined fields of `pattern`, each read
// through the fixture's expression of that name. An expression the fixture does not carry reads
// `?` for every row and so leaves their order to the ones after it.
export function sortedOrder(
	items: readonly Track[],
	pattern: string,
): number[] {
	const parts = pattern.split("|");
	return items
		.map((_, at) => at)
		.sort((a, b) => {
			for (const part of parts) {
				const compared = compareText(
					evaluate(items[a], part),
					evaluate(items[b], part),
				);
				if (compared !== 0) return compared;
			}
			return 0;
		});
}
