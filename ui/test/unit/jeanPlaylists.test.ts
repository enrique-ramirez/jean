import assert from "node:assert/strict";
import test from "node:test";

import {
	albumLabel,
	albumOfLabel,
	SCRATCH_KIND,
	scratchContentsOf,
	scratchName,
	scratchTitle,
} from "../../src/domain/track/jeanPlaylists.ts";
import type { PlaylistInfo } from "../../src/shared/api/types.ts";
import type { Translate } from "../../src/shared/i18n/useTranslate.ts";

const titled = (title: string): PlaylistInfo => ({
	id: "00000000-0000-4000-8000-000000000001",
	index: 0,
	title,
	itemCount: 1,
	structure: "1",
	revision: "1",
	role: "scratch",
	isAutoPlaylist: false,
});

test("what a fill writes into the scratch title reads back as it was written", () => {
	assert.deepEqual(
		scratchContentsOf(titled(scratchTitle(SCRATCH_KIND.genre, "Heavy Metal"))),
		{ kind: SCRATCH_KIND.genre, label: "Heavy Metal" },
	);
	assert.deepEqual(scratchContentsOf(titled(scratchTitle(SCRATCH_KIND.all))), {
		kind: SCRATCH_KIND.all,
		label: "",
	});
});

test("a label holding the separator keeps everything after the first one", () => {
	assert.deepEqual(
		scratchContentsOf(titled(scratchTitle(SCRATCH_KIND.search, "a: b"))),
		{ kind: SCRATCH_KIND.search, label: "a: b" },
	);
});

// Somebody renamed the scratch playlist at the player: Jean did not write this
// kind, so it names no set Jean can route to.
test("a scratch title whose kind Jean never writes reads as nothing", () => {
	const renamed = scratchTitle(SCRATCH_KIND.genre, "x").replace(
		SCRATCH_KIND.genre,
		"my favourites",
	);
	assert.equal(scratchContentsOf(titled(renamed)), null);
	assert.equal(scratchContentsOf(titled("Road trip")), null);
});

// A title alone does not name a record, so an album set's label carries both tags: the route the
// sidebar row opens needs the artist, and the name drawn beside it needs only the album.
test("an album label reads back as its two tags, and is named by the album alone", () => {
	const t = ((key: string) => key) as Translate;
	const held = scratchContentsOf(
		titled(
			scratchTitle(SCRATCH_KIND.album, albumLabel("Babasónicos", "Jessico")),
		),
	);
	assert.deepEqual(albumOfLabel(held?.label ?? ""), {
		artist: "Babasónicos",
		album: "Jessico",
	});
	assert.equal(scratchName(held, t), "Jessico");
});

test("a record whose files carry no artist still has an album to open", () => {
	assert.deepEqual(albumOfLabel(albumLabel(null, "Untitled")), {
		artist: null,
		album: "Untitled",
	});
});

test("a separator inside the album's own title stays in the title", () => {
	assert.deepEqual(albumOfLabel(albumLabel("Band", "Side A · Side B")), {
		artist: "Band",
		album: "Side A · Side B",
	});
});
