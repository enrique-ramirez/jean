import { subscribers } from "@/shared/lib/store";
import { en, type Phrase } from "./en";
import { numbersIn, pluralsIn } from "./format";
import {
	type FieldsOf,
	fill,
	formOf,
	type Message,
	type Values,
} from "./message";

export const ENGLISH = "en";

const CHOICE_KEY = "jean.locale";

export const LOCALES_FOLDER = "locales";

/** The one file a person hand-edits. Nothing here may write it, or a new build erases it. */
export const CUSTOM_FILE = "custom.json";

const listeners = subscribers();

// Resolved against the document rather than the root: `site/CLAUDE.md` has why a root-relative
// path would be wrong for the demo.
const fileIn = (name: string) =>
	new URL(`${LOCALES_FOLDER}/${name}`, document.baseURI).href;

export interface LocaleState {
	/** What phrases are being read from, `en` until a catalogue has actually loaded. */
	readonly active: string;
	/** What the reader picked, or null while Jean is still following the browser. */
	readonly chosen: string | null;
	readonly available: readonly string[];
	/** Phrases the active catalogue does not carry, which therefore show in English. */
	readonly missing: number;
	readonly failed: string | null;
}

let state: LocaleState = {
	active: ENGLISH,
	chosen: null,
	available: [ENGLISH, ...__SHIPPED_LOCALES__],
	missing: 0,
	failed: null,
};

let overlay: Partial<Record<Phrase, Message>> = {};

const publish = (next: Partial<LocaleState>) => {
	state = { ...state, ...next };
	document.documentElement.lang = state.active;
	listeners.notify();
};

export const localeState = () => state;
export const subscribeToLocale = listeners.subscribe;

// JSON, like every other `jean.` key, so moving this to `useStoredState` and then to the player's
// own client config is a change of home rather than a change of format.
const readChoice = (): string | null => {
	try {
		const stored = localStorage.getItem(CHOICE_KEY);
		const parsed: unknown = stored === null ? null : JSON.parse(stored);
		return typeof parsed === "string" ? parsed : null;
	} catch {
		return null;
	}
};

const writeChoice = (code: string | null) => {
	try {
		if (code === null) localStorage.removeItem(CHOICE_KEY);
		else localStorage.setItem(CHOICE_KEY, JSON.stringify(code));
	} catch {
		// Private mode, quota: the choice just does not survive the tab.
	}
};

const isMessage = (value: unknown): value is Message =>
	typeof value === "string" ||
	(typeof value === "object" &&
		value !== null &&
		typeof (value as PluralShape).other === "string");

interface PluralShape {
	other?: unknown;
}

function parse(body: unknown): Partial<Record<Phrase, Message>> {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		throw new Error("not an object");

	const held: Partial<Record<Phrase, Message>> = {};
	for (const [key, value] of Object.entries(body))
		if (key in en && isMessage(value)) held[key as Phrase] = value;

	return held;
}

async function fetchCatalogue(code: string) {
	const response = await fetch(fileIn(`${code}.json`));
	if (!response.ok) throw new Error(`${response.status}`);
	return parse(await response.json());
}

async function fetchCustom(): Promise<string[]> {
	try {
		const response = await fetch(fileIn(CUSTOM_FILE));
		if (!response.ok) return [];
		const body: unknown = await response.json();
		return Array.isArray(body)
			? body.filter((code): code is string => typeof code === "string")
			: [];
	} catch {
		return [];
	}
}

const phrases = Object.keys(en).length;

async function adopt(code: string) {
	if (code === ENGLISH) {
		overlay = {};
		publish({ active: ENGLISH, missing: 0, failed: null });
		return;
	}

	try {
		const loaded = await fetchCatalogue(code);
		overlay = loaded;
		publish({
			active: code,
			missing: phrases - Object.keys(loaded).length,
			failed: null,
		});
	} catch {
		overlay = {};
		publish({ active: ENGLISH, missing: 0, failed: code });
	}
}

/**
 * The best of what the browser asks for, by language before region: a browser set to `es-AR` takes
 * a catalogue named `es`, and one set to `pt` takes `pt-BR` if that is the only Portuguese here.
 */
function negotiate(available: readonly string[]): string {
	const has = (wanted: string) =>
		available.find((code) => code.toLowerCase() === wanted) ??
		available.find((code) => code.toLowerCase().split("-")[0] === wanted);

	for (const language of navigator.languages ?? [navigator.language]) {
		const wanted = language.toLowerCase();
		const match = has(wanted) ?? has(wanted.split("-")[0]);
		if (match) return match;
	}

	return ENGLISH;
}

/**
 * Awaited before the first render, so nothing paints in English and then changes under the reader.
 * A returning visitor costs one request and a first-time English one costs none: the custom list is
 * only worth fetching when there is no choice on this device to honour.
 */
export async function startLocale(): Promise<void> {
	const chosen = readChoice();

	if (chosen !== null) {
		publish({ chosen });
		await adopt(chosen);
		return;
	}

	await discover();
	await adopt(negotiate(state.available));
}

/** Null follows the browser again, which is what "Match my browser" in Settings sets. */
export async function setLocale(code: string | null): Promise<void> {
	writeChoice(code);
	publish({ chosen: code });
	await adopt(code ?? negotiate(state.available));
}

/** What Settings needs and the boot path skips when it has a stored choice: the hand-added codes too. */
export async function discover(): Promise<void> {
	const found = [ENGLISH, ...__SHIPPED_LOCALES__, ...(await fetchCustom())];
	publish({ available: [...new Set(found)] });
}

export type Fields<Key extends Phrase> = [FieldsOf<(typeof en)[Key]>] extends [
	never,
]
	? []
	: [Record<FieldsOf<(typeof en)[Key]>, string | number>];

export const messageFor = (key: Phrase): Message => overlay[key] ?? en[key];

export type Translate = <Key extends Phrase>(
	key: Key,
	...args: Fields<Key>
) => string;

/**
 * For anything outside a render: a toast raised from a store, the document title. A component uses
 * `useTranslate`, which re-renders when the language changes where this does not.
 */
export function translate<Key extends Phrase>(
	key: Key,
	...args: Fields<Key>
): string {
	const values = (args[0] ?? {}) as Values;
	const { active } = state;
	return fill(
		formOf(messageFor(key), values, pluralsIn(active)),
		values,
		numbersIn(active),
	);
}
