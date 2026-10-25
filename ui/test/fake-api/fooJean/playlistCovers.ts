import type { Track } from "../state.ts";
import { groupedLibrary, hasLibrarySnapshot } from "./library.ts";
import { runColumnsKey } from "./libraryRuns.ts";
import type { FakeState } from "./request.ts";

interface HeldCovers {
	key: string;
	coverOf: (ordinal: number) => string;
}

const held = new WeakMap<FakeState, HeldCovers>();

const declaredRoles = (state: FakeState, roles: Map<string, string>) =>
	roles.size > 0 &&
	state.fooJean.canReadLibrary &&
	hasLibrarySnapshot(state) &&
	[...roles.values()].every((expression) =>
		state.libraryFeed.columns.includes(expression),
	);

export const settleCovers = async (
	state: FakeState,
	roles: Map<string, string>,
) => {
	if (!declaredRoles(state, roles)) return;
	const key = runColumnsKey(state, roles);
	if (held.get(state)?.key === key) return;

	const { read, covers, draftAt } = await groupedLibrary(state, roles);
	held.set(state, {
		key,
		coverOf: (ordinal) => {
			const cover = draftAt[ordinal] >= 0 ? covers[draftAt[ordinal]] : ordinal;
			return `${read.directory[cover]}${read.filename[cover]}`;
		},
	});
};

export const coversFor = (
	state: FakeState,
	roles: Map<string, string>,
): ((track: Track) => string | null) | null => {
	if (roles.size === 0) return null;
	if (!declaredRoles(state, roles)) return () => null;

	const coverOf = held.get(state)?.coverOf;
	if (!coverOf)
		throw new Error("covers were asked for before they were settled");
	return (track) => {
		const ordinal = state.libraryOrdinalFor(track);
		return ordinal === null ? null : coverOf(ordinal);
	};
};
