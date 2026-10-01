import {
	collapseRepeatedTag,
	creditedArtists,
	FEATURING,
	FIELD,
	readValue,
	tagKey,
} from "@/domain/track/fields";
import { byValue, type LibraryColumns } from "@/domain/track/libraryColumns";
import type { JlibColumn } from "@/shared/api/jlib";
import { valuesIn } from "@/shared/api/multiValue";

export interface Member {
	name: string;
	key: string;
	isGuest: boolean;
}

const NO_MEMBERS: readonly Member[] = [];

const JOINER = /\s*,\s+|\s+(?:&|x|×|vs\.?|with|feat\.?|ft\.?|featuring)\s+/i;

function partsOf(credit: string): Member[] {
	const featuring = FEATURING.exec(credit);
	const cut = featuring ? featuring.index : credit.length;
	const parts: Member[] = [];

	const add = (text: string, isGuest: boolean) => {
		for (const part of text.split(JOINER)) {
			const name = part.trim();
			if (name) parts.push({ name, key: tagKey(name), isGuest });
		}
	};
	add(credit.slice(0, cut), false);
	if (featuring) add(credit.slice(cut + featuring[0].length), true);
	return parts;
}

const countOf = (raw: string | null) =>
	raw === null ? 0 : valuesIn(raw).length;

interface Tags {
	credit: JlibColumn;
	names: JlibColumn;
	ids: JlibColumn;
}

const tagsOf = (columns: LibraryColumns): Tags[] => [
	{
		credit: columns.fields[FIELD.artist],
		names: columns.fields[FIELD.artists],
		ids: columns.fields[FIELD.artistIds],
	},
	{
		credit: columns.fields[FIELD.albumArtist],
		names: columns.fields[FIELD.albumArtists],
		ids: columns.fields[FIELD.albumArtistIds],
	},
];

const soleNameOf = (credit: string | null) => {
	const lead = creditedArtists(credit).lead;
	return lead ? collapseRepeatedTag(lead) : null;
};

export interface CreditMembers {
	artist: (ref: number) => readonly Member[];
	albumArtist: (ref: number) => readonly Member[];
}

function learn(columns: LibraryColumns) {
	const idNames = new Map<string, string>();
	const standalone = new Set<string>();

	for (const { credit, ids } of tagsOf(columns)) {
		const soleIds = Array.from({ length: ids.distinct }, (_, id) => {
			const raw = readValue(ids.value(id));
			return raw !== null && countOf(raw) === 1 ? raw : null;
		});
		const soleNames = Array.from({ length: credit.distinct }, (_, id) =>
			soleNameOf(readValue(credit.value(id))),
		);
		for (const name of soleNames) if (name) standalone.add(tagKey(name));

		for (let ref = 0; ref < columns.trackCount; ref += 1) {
			const id = soleIds[ids.ids[ref]];
			if (id === null || idNames.has(id)) continue;
			const name = soleNames[credit.ids[ref]];
			if (name) idNames.set(id, name);
		}
	}

	return { idNames, standalone };
}

function membersOf(
	credit: string | null,
	names: string | null,
	ids: string | null,
	learned: ReturnType<typeof learn>,
	guesses: boolean,
): readonly Member[] {
	if (credit === null) return NO_MEMBERS;
	const parts = partsOf(credit);
	const guestKeys = new Set(
		parts.filter((part) => part.isGuest).map((part) => part.key),
	);

	if (names !== null && countOf(names) > 1)
		return valuesIn(names)
			.map((name) => name.trim())
			.filter(Boolean)
			.map((name) => {
				const key = tagKey(name);
				return { name, key, isGuest: guestKeys.has(key) };
			});

	const idList = ids === null ? [] : valuesIn(ids);
	if (idList.length === 1) return NO_MEMBERS;
	if (idList.length > 1) {
		if (parts.length === idList.length)
			return parts.map((part, at) => {
				const name = learned.idNames.get(idList[at]) ?? part.name;
				return { ...part, name, key: tagKey(name) };
			});
		return idList.flatMap((id) => {
			const name = learned.idNames.get(id);
			if (!name) return [];
			const key = tagKey(name);
			return [{ name, key, isGuest: guestKeys.has(key) }];
		});
	}

	if (!guesses || parts.length < 2) return NO_MEMBERS;
	return parts.filter((part) => learned.standalone.has(part.key));
}

function memberReader(
	tags: Tags,
	learned: ReturnType<typeof learn>,
	mayGuess: (ref: number) => boolean,
) {
	const resolved = new Map<string, readonly Member[]>();

	return (ref: number) => {
		const credit = tags.credit.ids[ref];
		const names = tags.names.ids[ref];
		const ids = tags.ids.ids[ref];
		const guesses = mayGuess(ref);
		const combination = `${credit},${names},${ids},${guesses}`;

		let members = resolved.get(combination);
		if (!members) {
			members = membersOf(
				readValue(tags.credit.value(credit)),
				readValue(tags.names.value(names)),
				readValue(tags.ids.value(ids)),
				learned,
				guesses,
			);
			resolved.set(combination, members);
		}
		return members;
	};
}

let held: {
	fields: readonly JlibColumn[];
	trackCount: number;
	guesses: boolean;
	members: CreditMembers;
} | null = null;

export const CREDIT_FIELDS = [
	FIELD.artist,
	FIELD.artists,
	FIELD.artistIds,
	FIELD.albumArtist,
	FIELD.albumArtists,
	FIELD.albumArtistIds,
];

const sameCredits = (
	fields: readonly JlibColumn[],
	other: readonly JlibColumn[],
) => CREDIT_FIELDS.every((field) => fields[field] === other[field]);

// foobar2000 holds a credit as written, `Revelries & Henri Purnell`, with no split of its own. The
// per-artist tags that say who it names are listed in `shared/api/README.md`.
export function creditMembers(
	columns: LibraryColumns,
	guesses: boolean,
): CreditMembers {
	if (
		held &&
		held.guesses === guesses &&
		held.trackCount === columns.trackCount &&
		sameCredits(held.fields, columns.fields)
	)
		return held.members;

	const learned = learn(columns);
	const tags = tagsOf(columns);
	const isTagged = tags.map(({ ids }) =>
		byValue(ids, (raw) => readValue(raw) !== null),
	);
	const mayGuess = (ref: number) =>
		guesses && !tags.some(({ ids }, at) => isTagged[at][ids.ids[ref]]);

	const [artist, albumArtist] = tags.map((tag) =>
		memberReader(tag, learned, mayGuess),
	);
	const members = { artist, albumArtist };
	held = {
		fields: columns.fields,
		trackCount: columns.trackCount,
		guesses,
		members,
	};
	return members;
}
