import type { FakePlayer, Page } from "./fixtures.ts";
import {
	askOf,
	expect,
	expectSettlesAt,
	HEADER_TILES_AT_MOST,
	playedFrom,
	scratchOf,
	trackPlayed,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";

// What a library list asks of the player, and what the player answered it, for the specs of the
// album, artist, genre, shelf, search results, the search dropdown and the autoplaylist preview.

export const ROWS = "POST /api/library/rows";
export const STATE = "GET /api/state";
const PREVIEW = "POST /api/autoplaylists/preview";

type Body = FakePlayer["requests"][number]["body"];

interface OrdinalSet {
	runs?: [number, number][];
	bitset?: string;
}

export interface Answered {
	ask: string;
	params: URLSearchParams;
	status: number;
	sent: Body;
	json: unknown;
	etag: string | null;
	ifNoneMatch: string | null;
	structure: number | null;
	revision: number | null;
}

// Read in the browser: the fake's log carries no status and no validator, and a rows request
// answered 202 while the declaration builds is asked again with the same body, so only a 200
// carried rows. Kept in the order the answers arrived, with a document filled in once it is read.
export const recordLibraryTraffic = (page: Page) => {
	const answered: Answered[] = [];
	page.on("response", (response) => {
		const url = new URL(response.url());
		const request = response.request();
		const ask = `${request.method()} ${url.pathname}`;
		if (
			!url.pathname.startsWith("/api/library/") &&
			ask !== PREVIEW &&
			ask !== STATE
		)
			return;
		const entry: Answered = {
			ask,
			params: url.searchParams,
			status: response.status(),
			sent: request.method() === "POST" ? request.postDataJSON() : null,
			json: null,
			etag: response.headers().etag ?? null,
			ifNoneMatch: request.headers()["if-none-match"] ?? null,
			structure: null,
			revision: null,
		};
		answered.push(entry);
		if (ask === ROWS || response.status() !== 200) return;
		void response
			.json()
			.then((json: { library?: StateLibrary }) => {
				if (ask === STATE) {
					entry.structure = json.library?.structure ?? null;
					entry.revision = json.library?.revision ?? null;
				}
				entry.json = json;
			})
			.catch(() => {});
	});
	return answered;
};

export interface StateLibrary {
	structure: number;
	revision: number;
	trackCount: number;
	halted: boolean;
	changeCounts: number[];
}

export const libraryState = async (page: Page) =>
	(
		(await (await page.request.get("/api/state")).json()) as {
			library: StateLibrary;
		}
	).library;

// The fake builds a declaration on a state poll, so the player is read first, which finishes any
// build, and then waited on until the page's poll has drawn the same pair. The poll alone sends a
// validator, so a `304` after the pair proves the poll drew it rather than another read.
export const untilThePollHasDrawn = async (
	page: Page,
	answered: Answered[],
) => {
	const { structure, revision } = await libraryState(page);
	await expect
		.poll(() => {
			const at = answered.findIndex(
				(answer) =>
					answer.ask === STATE &&
					answer.structure === structure &&
					answer.revision === revision,
			);
			return (
				at > -1 &&
				answered
					.slice(at + 1)
					.some((answer) => answer.ask === STATE && answer.status === 304)
			);
		})
		.toBe(true);
};

export const mark = (answered: Answered[], player: FakePlayer) => ({
	answered: answered.length,
	requests: player.requests.length,
});

export type Mark = ReturnType<typeof mark>;

const FROM_THE_START: Mark = { answered: 0, requests: 0 };

export const ordinalsOfSet = (set: OrdinalSet) => {
	if (set.runs)
		return set.runs.flatMap(([start, length]) =>
			Array.from({ length }, (_, step) => start + step),
		);
	const bytes = Uint8Array.from(atob(set.bitset ?? ""), (char) =>
		char.charCodeAt(0),
	);
	const ordinals: number[] = [];
	for (const [at, byte] of bytes.entries())
		for (let bit = 0; bit < 8; bit += 1)
			if ((byte >> bit) & 1) ordinals.push(at * 8 + bit);
	return ordinals;
};

export const positionsNamed = (body: Body) => {
	if (Array.isArray(body?.ordinals)) return body.ordinals as number[];
	return ordinalsOfSet({ runs: (body?.runs ?? []) as [number, number][] });
};

const ascending = (list: readonly number[]) => [...list].sort((a, b) => a - b);

const namesTheSet = (body: Body, set: readonly number[]) =>
	JSON.stringify(ascending(positionsNamed(body))) ===
	JSON.stringify(ascending(set));

export const latestAnswer = async <Json>(
	answered: Answered[],
	ask: string,
	where: (answer: Answered) => boolean = () => true,
): Promise<Json> => {
	const find = () =>
		answered.findLast(
			(answer) =>
				answer.ask === ask &&
				answer.status === 200 &&
				answer.json !== null &&
				where(answer),
		);
	await expect
		.poll(() => find() !== undefined, {
			message: `the player never answered ${ask}`,
		})
		.toBe(true);
	return find()?.json as Json;
};

export const rowsAnswered = (
	answered: Answered[],
	from: Mark = FROM_THE_START,
) =>
	answered
		.slice(from.answered)
		.filter((answer) => answer.ask === ROWS && answer.status === 200)
		.map((answer) => answer.sent);

export const rowsAsked = (player: FakePlayer, from: Mark = FROM_THE_START) =>
	player.requests.slice(from.requests).filter((entry) => askOf(entry) === ROWS);

// One body names the list's whole set, since every list here is shorter than a window. Anything
// else asked of the rows is a header's covers or the playing track, which ask
// by ordinal and for a few rows; a second body naming the set, or one naming a window of the
// library rather than the list, is neither. A body naming no rows is the column declaration, which
// reads none.
export const expectTheSetAskedOnce = async (
	answered: Answered[],
	player: FakePlayer,
	set: readonly number[],
	from: Mark = FROM_THE_START,
) => {
	await expectSettlesAt(
		player,
		() =>
			rowsAnswered(answered, from).filter((body) => namesTheSet(body, set))
				.length,
		1,
	);
	for (const body of rowsAnswered(answered, from).filter(
		(one) => positionsNamed(one).length > 0 && !namesTheSet(one, set),
	)) {
		expect(Array.isArray(body?.ordinals), JSON.stringify(body)).toBe(true);
		expect(positionsNamed(body).length).toBeLessThanOrEqual(
			HEADER_TILES_AT_MOST,
		);
	}
};

// A library row is held once, by ordinal, so a list opened after another list has
// asked part of its set asks only the rest. The rows held before `from` and the bodies asked since
// cover the set, and nothing held before `from` is asked again. A body reaching outside the set is a
// header's covers, which asks by ordinal and for a few rows.
export const expectTheSetCoveredOnce = async (
	answered: Answered[],
	player: FakePlayer,
	set: readonly number[],
	from: Mark,
) => {
	const wanted = new Set(set);
	const isTheList = (body: Body) =>
		positionsNamed(body).every((ordinal) => wanted.has(ordinal));
	const named = (bodies: Body[]) =>
		bodies.filter(isTheList).flatMap(positionsNamed);
	const heldBefore = new Set(
		named(rowsAnswered(answered.slice(0, from.answered))),
	);
	const askedSince = () => named(rowsAnswered(answered, from));

	await expectSettlesAt(
		player,
		() => ascending([...new Set([...heldBefore, ...askedSince()])]),
		ascending(set),
	);
	expect(
		askedSince().filter((ordinal) => heldBefore.has(ordinal)),
		"a row held before the list opened was asked again",
	).toEqual([]);
	for (const body of rowsAnswered(answered, from).filter(
		(one) => !isTheList(one),
	)) {
		expect(Array.isArray(body?.ordinals), JSON.stringify(body)).toBe(true);
		expect(positionsNamed(body).length).toBeLessThanOrEqual(
			HEADER_TILES_AT_MOST,
		);
	}
};

export const titleAtOrdinal = (player: FakePlayer, ordinal: number) =>
	String(player.ordinalOrder()[ordinal].track["%title%"]);

// Home draws no track list, so it settles with the rows held, where a playlist's first draw waits
// on the declaration the hold also holds.
export const openHomeSettled = async (page: Page, player: FakePlayer) => {
	await page.goto("/");
	await untilQuiet(player);
};

export const holdRows = (page: Page, hold: boolean) =>
	page.request.post("/__control/holdRows", { data: { hold } });

// Held by the fake, so read off its log rather than off an answer. A header's covers are rows too,
// so the list's own ask is the one naming its set.
export const untilRowsAreHeld = async (
	player: FakePlayer,
	set: readonly number[],
) => {
	await expect
		.poll(
			() => rowsAsked(player).some((entry) => namesTheSet(entry.body, set)),
			{ message: "the list never asked for its rows" },
		)
		.toBe(true);
	expect(player.fooJean.rowsHeld.length).toBeGreaterThan(0);
};

// Not the first row: a set comes back in the player's own browse order, which agrees with the list's
// often enough that the first row proves nothing.
const PLAYED_POSITION = 2;

// With the rows held, the list is skeletons, and playing one still plays the track at that position
// of the set, which is all a play needs. On a phone a tap plays; there is no keyboard to press.
export const expectPendingRowsPlayByPosition = async (
	page: Page,
	player: FakePlayer,
	isMobile: boolean,
	set: readonly number[],
) => {
	const at = PLAYED_POSITION;
	for (const index of [0, at])
		await expect(trackRow(page, index)).toHaveAttribute("aria-busy", "true");
	await expect(trackRow(page, at)).not.toContainText(
		titleAtOrdinal(player, ascending(set)[at]),
	);

	if (isMobile) await trackRow(page, at).tap();
	else {
		await trackRow(page, at - 1).click();
		await page.keyboard.press("ArrowDown");
		await expect(trackRow(page, at)).toHaveAttribute("data-cursor", "true");
		await page.keyboard.press("Enter");
	}

	await expect.poll(() => playedFrom(player)?.index).toBe(at);
	expect(playedFrom(player)?.id).toBe(scratchOf(player)?.guid);
	expect(trackPlayed(player)).toBe(titleAtOrdinal(player, ascending(set)[at]));
	expect(
		player.fooJean.rowsHeld.length,
		"the rows landed before the play went out",
	).toBeGreaterThan(0);

	await holdRows(page, false);
	await expect(trackRow(page, at)).toContainText(trackPlayed(player) ?? "");
	await expect(trackRow(page, at)).not.toHaveAttribute("aria-busy", "true");
};
