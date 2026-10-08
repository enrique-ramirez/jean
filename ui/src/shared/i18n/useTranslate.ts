import { useMemo, useSyncExternalStore } from "react";
import type { Phrase } from "./en";
import { collatorIn, datesIn, numbersIn, relativeIn } from "./format";
import {
	type Fields,
	type LocaleState,
	localeState,
	spoken,
	subscribeToLocale,
	type Translate,
	translate,
} from "./locale";

export type { Translate };

export const useLocale = (): LocaleState =>
	useSyncExternalStore(subscribeToLocale, localeState);

export function useTranslate(): Translate {
	const state = useLocale();

	// biome-ignore lint/correctness/useExhaustiveDependencies: `state` fires this rather than being read in it.
	return useMemo(
		() =>
			<Key extends Phrase>(key: Key, ...args: Fields<Key>) =>
				translate(key, ...args),
		[state],
	);
}

export function useSpoken(): Translate {
	const state = useLocale();

	// biome-ignore lint/correctness/useExhaustiveDependencies: `state` fires this rather than being read in it.
	return useMemo(
		() =>
			<Key extends Phrase>(key: Key, ...args: Fields<Key>) =>
				spoken(key, ...args),
		[state],
	);
}

export type Formats = ReturnType<typeof useFormats>;

export function useFormats() {
	const { active } = useLocale();

	return useMemo(
		() => ({
			number: (value: number, options?: Intl.NumberFormatOptions) =>
				numbersIn(active, options).format(value),
			date: (value: Date | number, options: Intl.DateTimeFormatOptions) =>
				datesIn(active, options).format(value),
			relative: (
				value: number,
				unit: Intl.RelativeTimeFormatUnit,
				options?: Intl.RelativeTimeFormatOptions,
			) => relativeIn(active, options).format(value, unit),
			compare: collatorIn(active).compare,
			locale: active,
		}),
		[active],
	);
}
