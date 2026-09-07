/**
 * A message is either one string or a set of plural forms. `other` is the only form every language
 * has, so it is the only one required; `Intl.PluralRules` decides which of the rest a count selects
 * and falls back to `other` for a form the translator did not write.
 */
export type PluralForms = { other: string } & Partial<
	Record<Exclude<Intl.LDMLPluralRule, "other">, string>
>;

export type Message = string | PluralForms;

export type Values = Record<string, string | number>;

type Fields<Text extends string> =
	Text extends `${string}{${infer Name}}${infer Rest}`
		? Name | Fields<Rest>
		: never;

/**
 * What a message must be given to render. Plural forms always take `count`, since that is what
 * selects between them, and a form may name fields the others do not.
 */
export type FieldsOf<Held extends Message> = Held extends string
	? Fields<Held>
	: Held extends PluralForms
		? Fields<Extract<Held[keyof Held], string>> | "count"
		: never;

/**
 * An unknown field is left as it was written wherever this matches. A translator who mistypes one
 * then sees `{prot}` in the interface, which says where to look; dropping it would leave a hole
 * saying nothing.
 */
const FIELD = /\{(\w+)\}/g;

export const formOf = (
	message: Message,
	values: Values,
	plurals: Intl.PluralRules,
): string =>
	typeof message === "string"
		? message
		: (message[plurals.select(Number(values.count))] ?? message.other);

export const fill = (
	text: string,
	values: Values,
	numbers: Intl.NumberFormat,
): string =>
	text.replace(FIELD, (whole, name: string) => {
		if (!(name in values)) return whole;
		const value = values[name];
		return typeof value === "number" ? numbers.format(value) : value;
	});

/** A field a caller means to fill with something other than text, as `Trans` does with elements. */
export interface Slot {
	field: string;
}

export function segmentsOf(text: string): (string | Slot)[] {
	const segments: (string | Slot)[] = [];
	let at = 0;

	for (const match of text.matchAll(FIELD)) {
		if (match.index > at) segments.push(text.slice(at, match.index));
		segments.push({ field: match[1] });
		at = match.index + match[0].length;
	}

	if (at < text.length) segments.push(text.slice(at));
	return segments;
}
