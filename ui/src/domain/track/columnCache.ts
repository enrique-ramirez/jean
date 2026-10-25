import { finished, type Steps } from "@/shared/lib/idle";
import type { LibraryColumns } from "./libraryColumns";

type Link = WeakMap<object, unknown>;

export function overObjects<T extends object>() {
	const root: Link = new WeakMap();

	const linkFor = (keys: readonly object[]) => {
		let link = root;
		for (const key of keys.slice(0, -1)) {
			let next = link.get(key) as Link | undefined;
			if (!next) {
				next = new WeakMap();
				link.set(key, next);
			}
			link = next;
		}
		return link;
	};

	return {
		get: (keys: readonly object[]) =>
			linkFor(keys).get(keys[keys.length - 1]) as T | undefined,
		set: (keys: readonly object[], built: T) => {
			linkFor(keys).set(keys[keys.length - 1], built);
			return built;
		},
	};
}

export const columnsOf = (columns: LibraryColumns, fields: readonly number[]) =>
	fields.map((field) => columns.fields[field]);

const ANSWERS_PER_COLUMNS = 64;

export function overColumnsByName<Args extends unknown[], T extends object>(
	fields: readonly number[],
	nameOf: (...args: Args) => string,
	build: (columns: LibraryColumns, ...args: Args) => T,
) {
	const held = overObjects<Map<string, T>>();

	return (columns: LibraryColumns, ...args: Args): T => {
		const keys = columnsOf(columns, fields);
		const answers = held.get(keys) ?? held.set(keys, new Map());

		const name = nameOf(...args);
		const known = answers.get(name);
		if (known) return known;

		const built = build(columns, ...args);
		answers.set(name, built);
		if (answers.size > ANSWERS_PER_COLUMNS)
			answers.delete(answers.keys().next().value as string);
		return built;
	};
}

interface Sliced<T> {
	steps: Steps<T>;
	value?: T;
	isDone: boolean;
	failure?: { error: unknown };
}

export function slicedOver<T>() {
	const held = overObjects<Sliced<T>>();

	function* steps(keys: readonly object[], start: () => Steps<T>): Steps<T> {
		let sliced = held.get(keys);
		if (!sliced || sliced.failure)
			sliced = held.set(keys, { steps: start(), isDone: false });
		while (!sliced.isDone) {
			if (sliced.failure) throw sliced.failure.error;
			let next: IteratorResult<void, T>;
			try {
				next = sliced.steps.next();
			} catch (error) {
				sliced.failure = { error };
				throw error;
			}
			if (next.done) {
				sliced.value = next.value;
				sliced.isDone = true;
			} else yield;
		}
		return sliced.value as T;
	}

	return {
		steps,
		get: (keys: readonly object[], start: () => Steps<T>) =>
			finished(steps(keys, start)),
		peek: (keys: readonly object[]) => {
			const sliced = held.get(keys);
			return sliced?.isDone ? sliced.value : undefined;
		},
	};
}

export function overColumnsInSlices<T>(
	fields: readonly number[],
	start: (columns: LibraryColumns) => Steps<T>,
) {
	const held = slicedOver<T>();
	const steps = (columns: LibraryColumns) =>
		held.steps(columnsOf(columns, fields), () => start(columns));

	return Object.assign(
		(columns: LibraryColumns): T => finished(steps(columns)),
		{
			steps,
		},
	);
}
