import { finished, type Steps } from "@/shared/lib/idle";
import type { LibraryColumns } from "./libraryColumns";

type Link = WeakMap<object, unknown>;

function overObjects<T extends object>() {
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
