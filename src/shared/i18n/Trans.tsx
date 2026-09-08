import { Fragment, type ReactNode } from "react";

import type { en, Phrase } from "./en";
import { numbersIn, pluralsIn } from "./format";
import { messageFor } from "./locale";
import { type FieldsOf, formOf, type Slot, segmentsOf } from "./message";
import { useLocale } from "./useTranslate";

type Held<Key extends Phrase> = FieldsOf<(typeof en)[Key]>;

/**
 * `count` stays a number wherever a phrase has plural forms, since it is what selects between them.
 * Every other field takes whatever a caller wants to draw there.
 */
type Slots<Key extends Phrase> = Record<
	Exclude<Held<Key>, "count">,
	ReactNode
> &
	("count" extends Held<Key> ? { count: number } : unknown);

const drawn = (
	slot: Slot,
	values: Record<string, ReactNode>,
	numbers: Intl.NumberFormat,
): ReactNode => {
	if (!(slot.field in values)) return `{${slot.field}}`;

	const value = values[slot.field];
	return typeof value === "number" ? numbers.format(value) : value;
};

export function Trans<Key extends Phrase>({
	phrase,
	...slots
}: { phrase: Key } & Slots<Key>) {
	const { active } = useLocale();
	const values = slots as Record<string, ReactNode>;
	const numbers = numbersIn(active);

	const text = formOf(
		messageFor(phrase),
		{ count: Number(values.count) },
		pluralsIn(active),
	);

	return (
		<>
			{segmentsOf(text).map((segment, at) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: segments are positions in one fixed string.
				<Fragment key={at}>
					{typeof segment === "string"
						? segment
						: drawn(segment, values, numbers)}
				</Fragment>
			))}
		</>
	);
}
