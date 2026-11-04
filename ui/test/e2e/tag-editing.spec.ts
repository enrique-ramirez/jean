import { en } from "../../src/shared/i18n/en.ts";
import { fill, formOf, type Values } from "../../src/shared/i18n/message.ts";
import { STALLED_READ_MS } from "../fake-api/fooJean/latency.ts";
import type { Track } from "../fake-api/state.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	expect,
	expectSettlesAt,
	guidOfPlaylist,
	openAllMusic,
	openLibrary,
	openNowPlaying,
	openSettings,
	routeOf,
	rowByTitle,
	settingsDialog,
	statusBar,
	tagWrites,
	test,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import { pressAndHold } from "./gestures.ts";
import { openRowMenu } from "./menus.ts";
import {
	discardButton,
	expectDiscardPrompt,
	keepEditingButton,
	openPanels,
	panelTab,
	playRow,
	promptsEverShown,
	recordPromptsEverShown,
	titleAddressedBy,
	untilThePageKnowsPlaying,
} from "./nowPlaying.ts";

// Edit mode is one view drawn by two hosts: the Details tab under `/playing/details`, for whatever
// is playing, and the details panel a row's menu opens. Most cases here use the tab, which needs
// nothing but a track playing; the ones about a host's own edges use both.

// Read through the catalogue where it holds the phrase, and the English given here until it
// does: a key read straight before it exists is `undefined`, which as a role's name matches every
// element of that role.
const said = (key: string, english: string, values: Values = {}) => {
	const held = (en as Record<string, unknown>)[key];
	const message = typeof held === "string" ? held : english;
	return fill(
		formOf(message, values, new Intl.PluralRules("en")),
		values,
		new Intl.NumberFormat("en"),
	);
};

const EDIT = said("details.edit", "Edit");
const CANCEL = said("details.cancel", "Cancel");
const SAVE = said("details.save", "Save");
const CHANGED = said("details.changed", "Changed");
const NOT_PLAYING = said(
	"details.notPlaying",
	"This track is no longer playing.",
);
const DETAILS_ITEM = said("track.details", "Details");
const PANEL = said("details.panelTitle", "Track details");
const CLOSE_PANEL = said("details.close", "Close track details");
const removeChipNamed = (value: string) =>
	said("chip.remove", "Remove {value}", { value });

const FAILURE = {
	forbidden: (field: string) =>
		said(
			"details.saveForbidden",
			"The player no longer permits writing {field}.",
			{ field },
		),
	moved: said(
		"details.saveMoved",
		"The track moved or the library was rebuilt. Reopen it and try again.",
	),
	gone: said("details.saveGone", "The track is gone."),
	failed: said("details.saveFailed", "The file could not be written."),
	tooMany: said(
		"details.saveTooMany",
		"Too many writes. Wait a moment and try again.",
	),
	unreachable: said(
		"details.saveUnreachable",
		"The player could not be reached.",
	),
	unconfirmed: said(
		"details.saveUnconfirmed",
		"The save could not be confirmed.",
	),
};

const LABEL = {
	title: en["details.title"],
	artist: en["details.artist"],
	album: en["details.album"],
	albumArtist: en["details.albumArtist"],
	date: en["details.date"],
	genre: en["details.genre"],
	publisher: en["details.publisher"],
	composer: en["details.composer"],
	track: en["details.track"],
	totalTracks: en["details.totalTracks"],
	disc: en["details.disc"],
	totalDiscs: en["details.totalDiscs"],
	bpm: en["details.bpm"],
};

const FACT_LABELS = [
	en["details.format"],
	en["details.bitrate"],
	en["details.sampleRate"],
	en["details.channels"],
	en["details.size"],
	en["details.file"],
	en["details.plays"],
	en["details.lastPlayed"],
];

const SINGLE_VALUED = [
	LABEL.title,
	LABEL.album,
	LABEL.date,
	LABEL.publisher,
	LABEL.track,
	LABEL.totalTracks,
	LABEL.disc,
	LABEL.totalDiscs,
	LABEL.bpm,
];
const MULTI_VALUED = [
	LABEL.artist,
	LABEL.albumArtist,
	LABEL.genre,
	LABEL.composer,
];

// Library row 0 of the playlist `openLibrary` opens.
const TITLE = "Los Calientes";
const ROW = 0;
const SEPARATOR = String.fromCharCode(31);

// Declared out of alphabetical order, so a form that sorts its chips cannot pass; the second holds
// a literal `;`, which is one value and never two.
const GENRES = ["Rock En Español", "Pop; Latino"];

// What the file holds, under the raw reads the form fills from. Each is chosen to differ from what
// title formatting derives: `%tracknumber%` answers "01" where the file holds "1", and the date is a
// full one where the view draws it as a release date. PUBLISHER and BPM are left out, which
// `$meta()` answers empty for, and COMPOSER is held empty.
const ON_FILE: Track = {
	"$meta(title)": TITLE,
	"$meta_sep(artist,$char(31))": "Babasónicos",
	"$meta(album)": "Jessico",
	"$meta_sep(album artist,$char(31))": "Babasónicos",
	"$meta(date)": "2001-03-12",
	"$meta_sep(genre,$char(31))": GENRES.join(SEPARATOR),
	"%genre%": GENRES.join(", "),
	"$meta_sep(composer,$char(31))": "",
	"$meta(tracknumber)": "1",
	"$meta(totaltracks)": "12",
	"$meta(discnumber)": "1",
	"$meta(totaldiscs)": "1",
};

const SEEDED = { retagged: { [TITLE]: ON_FILE } };

const openDetailsTab = async (page: Page, isMobile: boolean, row = ROW) => {
	await playRow(page, row);
	const panel = await openPanels(page, isMobile);
	await panelTab(panel, "Details").click();
	return panel;
};

const detailsPanel = (page: Page) =>
	page.getByRole("region", { name: PANEL, exact: true });

const openDetailsPanelOn = async (
	page: Page,
	isMobile: boolean,
	row: Locator,
) => {
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	await page.getByRole("menuitem", { name: DETAILS_ITEM, exact: true }).click();
	await expect(detailsPanel(page)).toBeVisible();
	return detailsPanel(page);
};

const openDetailsPanelAt = async (
	page: Page,
	isMobile: boolean,
	index = ROW,
) => {
	await openRowMenu(page, isMobile, index, DETAILS_ITEM);
	await page.getByRole("menuitem", { name: DETAILS_ITEM, exact: true }).click();
	await expect(detailsPanel(page)).toBeVisible();
	return detailsPanel(page);
};

const button = (view: Locator, name: string) =>
	view.getByRole("button", { name, exact: true });

const editButton = (view: Locator) => button(view, EDIT);
const cancelButton = (view: Locator) => button(view, CANCEL);
const saveButton = (view: Locator) => button(view, SAVE);

// A single-value field's input, or a multi-value field's text box: both are named by the label.
const field = (view: Locator, label: string) =>
	view.getByRole("textbox", { name: label, exact: true });

const chipList = (view: Locator, label: string) =>
	view.getByRole("list", { name: label, exact: true });

const chips = (view: Locator, label: string) =>
	chipList(view, label).getByRole("listitem");

const chip = (view: Locator, label: string, value: string) =>
	chips(view, label).filter({
		hasText: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
	});

const removeButton = (view: Locator, label: string, value: string) =>
	chipList(view, label).getByRole("button", {
		name: removeChipNamed(value),
		exact: true,
	});

const failureOf = (view: Locator) => view.getByRole("alert");

const startEditing = async (view: Locator) => {
	await editButton(view).click();
	await expect(field(view, LABEL.title)).toBeVisible();
};

const expectEditing = async (view: Locator) => {
	await expect(saveButton(view)).toBeVisible();
	await expect(cancelButton(view)).toBeVisible();
	await expect(editButton(view)).toHaveCount(0);
};

const expectNotEditing = async (view: Locator) => {
	await expect(editButton(view)).toBeVisible();
	await expect(view.getByRole("textbox")).toHaveCount(0);
	await expect(saveButton(view)).toHaveCount(0);
	await expect(cancelButton(view)).toHaveCount(0);
};

// Whether the element, or something inside it, holds the keyboard's focus. A chip may be focused
// as a whole or through a control it carries; criterion 27 says only that the chip is.
const holdsFocus = (target: Locator) =>
	target.evaluate((element) => element.contains(document.activeElement));

// Typed key by key, as a person does: a `;` makes a chip the moment it is typed, which a fill
// arriving all at once would skip past.
const typeInto = async (box: Locator, text: string) => {
	await box.click();
	await box.pressSequentially(text);
};

// Through the real clipboard and the platform's paste chord, since an `<input>` drops a pasted
// line break by itself and a synthetic paste event inserts nothing.
const paste = async (page: Page, box: Locator, text: string) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: new URL(page.url()).origin,
	});
	await page.evaluate((copied) => navigator.clipboard.writeText(copied), text);
	await box.click();
	await page.keyboard.press("ControlOrMeta+V");
};

type Sent = Record<string, string | string[]>;

// A tag's name is case-insensitive to foobar2000, so the keys are read in one case: a request
// spelling `genre` and one spelling `GENRE` write the same tag.
const fieldsOf = (body: Record<string, unknown> | null | undefined): Sent =>
	Object.fromEntries(
		Object.entries((body?.fields ?? {}) as Sent).map(([tag, value]) => [
			tag.toUpperCase(),
			value,
		]),
	);

const sentFields = (player: FakePlayer) =>
	tagWrites(player).map((entry) => fieldsOf(entry.body));

const readsBack = (player: FakePlayer) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" && routeOf(entry.path) === "/api/track/library",
	).length;

const losCalientesHeld = (player: FakePlayer) =>
	player
		.playlistById("p7")
		?.items.find(
			(track) => track["$meta(title)"] === TITLE || track["%title%"] === TITLE,
		);

const loseThePlayer = async (page: Page) => {
	const answered = await page.request.post("/__control/reachable", {
		data: { reachable: false },
	});
	expect(answered.ok(), "the fake needs /__control/reachable").toBe(true);
};

// Records every Edit button added to the page from now on. Started before the Details tab is
// chosen: the Lyrics tab, which a player opens on, offers an Edit of its own for the lyric, and it is
// gone once the tab changes, so an Edit added after this point is the view's.
const watchForEdit = (page: Page, name: string) =>
	page.evaluate((editName) => {
		const seen = { offered: false };
		Object.assign(window, { editOffered: seen });
		const isEdit = (node: Node) =>
			node instanceof Element &&
			[node, ...node.querySelectorAll("button")].some(
				(candidate) =>
					candidate.tagName === "BUTTON" &&
					(candidate.getAttribute("aria-label") ??
						candidate.textContent?.trim()) === editName,
			);
		new MutationObserver((records) => {
			for (const record of records)
				for (const added of record.addedNodes)
					if (isEdit(added)) seen.offered = true;
		}).observe(document, { subtree: true, childList: true });
	}, name);

const editEverOffered = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { editOffered: { offered: boolean } }).editOffered
				.offered,
	);

// The Details tab on whatever is playing, with the watch for Edit started before it is chosen.
const openDetailsTabWatching = async (page: Page, isMobile: boolean) => {
	await openNowPlaying(page);
	const view = await openPanels(page, isMobile);
	await watchForEdit(page, EDIT);
	await panelTab(view, "Details").click();
	return view;
};

test.describe("edit mode", () => {
	test.use(SEEDED);

	test("the Details tab offers Edit where the player permits an editable field and the track has an address", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await expect(editButton(view)).toBeVisible();
	});

	test("the details panel offers Edit for the same track", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await expect(editButton(view)).toBeVisible();
	});

	test.describe("where the player permits no editable field", () => {
		test.use({ fooJean: { allowedFields: ["rating", "unsynced lyrics"] } });

		test("no Edit is ever offered, and the view draws its rows as before", async ({
			page,
			player,
			isMobile,
		}) => {
			await openLibrary(page);
			await trackRow(page, ROW).dblclick();
			const view = await openDetailsTabWatching(page, isMobile);

			await expect(view).toContainText(LABEL.album);
			await expect(view).toContainText("Jessico");
			await untilQuiet(player);
			expect(await editEverOffered(page)).toBe(false);
		});
	});

	test.describe("where Settings has switched off every editable field the player permits", () => {
		test.use({ fooJean: { allowedFields: ["rating", "TITLE", "GENRE"] } });

		test("no Edit is ever offered, and the view draws its rows as before", async ({
			page,
			player,
			isMobile,
		}) => {
			await openSettings(page);
			// The switch is named by the field as Settings labels it, which today is the player's own
			// spelling; matched without case so a label in the catalogue's words passes too.
			for (const name of [/^title$/i, /^genre$/i]) {
				const control = settingsDialog(page).getByRole("switch", { name });
				await control.click();
				await expect(control).toHaveAttribute("aria-checked", "false");
			}
			await page.keyboard.press("Escape");
			await expect(settingsDialog(page)).toBeHidden();

			await openLibrary(page);
			await trackRow(page, ROW).dblclick();
			const view = await openDetailsTabWatching(page, isMobile);

			await expect(view).toContainText(LABEL.album);
			await expect(view).toContainText("Jessico");
			await untilQuiet(player);
			expect(await editEverOffered(page)).toBe(false);
		});
	});

	test.describe("on a stream", () => {
		// An internet radio station has no file for a tag to be written into, though its playlist row
		// is an address the player would take a write at.
		const STATION: Track = {
			"%path%": "http://stream.example.org:8000/night-shift",
			"%title%": "Weightless",
			"%artist%": "Halo Choir",
			"%codec%": "MP3",
			"%bitrate%": "128",
		};

		test("no Edit is ever offered", async ({ page, player, isMobile }) => {
			player.playlistById("p1")?.items.push({ ...STATION });

			await page.goto(`/#/${guidOfPlaylist(player, "p1")}`);
			await rowByTitle(page, "Weightless").dblclick();
			await expect(statusBar(page)).toContainText("Weightless");
			const view = await openDetailsTabWatching(page, isMobile);

			await expect(view).toContainText("128 kbps");
			await untilQuiet(player);
			expect(await editEverOffered(page)).toBe(false);
		});
	});

	test.describe("on a track the component has no address for", () => {
		// A file the media library does not hold, playing from no playlist the component can name.
		test.use({ fooJean: { knowsPlayingLocation: false } });

		const OFF_LIBRARY: Track = {
			"%path%": "D:\\Incoming\\Night Sessions\\01 Fourth Wall.flac",
			"%title%": "Fourth Wall",
			"%artist%": "The Dry Season",
			"%album%": "Night Sessions",
			"%album artist%": "The Dry Season",
			"%tracknumber%": "01",
			"%length_seconds%": "212",
			"%length%": "3:32",
			"$meta(album)": "Night Sessions",
		};

		test("no Edit is ever offered", async ({ page, player, isMobile }) => {
			player.playlistById("p7")?.items.splice(2, 0, { ...OFF_LIBRARY });

			await openLibrary(page);
			await expect(trackRow(page, 2)).toContainText("Fourth Wall");
			await trackRow(page, 2).dblclick();
			await expect(statusBar(page)).toContainText("Fourth Wall");
			const view = await openDetailsTabWatching(page, isMobile);

			await expect(view).toContainText("Night Sessions");
			await untilQuiet(player);
			expect(await editEverOffered(page)).toBe(false);
		});
	});

	test("Edit makes the view a form: an input per editable field holding what the file holds, the facts still text, Cancel and Save in Edit's place, and focus in the first input", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await editButton(view).click();

		await expectEditing(view);
		await expect(field(view, LABEL.title)).toBeFocused();

		await expect(field(view, LABEL.title)).toHaveValue(TITLE);
		await expect(field(view, LABEL.album)).toHaveValue("Jessico");
		// As the file holds them, not as the view draws them: "1 of 12" and a long-form date.
		await expect(field(view, LABEL.date)).toHaveValue("2001-03-12");
		await expect(field(view, LABEL.track)).toHaveValue("1");
		await expect(field(view, LABEL.totalTracks)).toHaveValue("12");
		await expect(field(view, LABEL.disc)).toHaveValue("1");
		await expect(field(view, LABEL.totalDiscs)).toHaveValue("1");
		await expect(chips(view, LABEL.artist)).toHaveText(["Babasónicos"]);
		await expect(chips(view, LABEL.albumArtist)).toHaveText(["Babasónicos"]);
		await expect(chips(view, LABEL.genre)).toHaveText(GENRES);

		// Thirteen text boxes, one per editable field, and not one more: a fact drawn as an input
		// would be a fourteenth.
		await expect(view.getByRole("textbox")).toHaveCount(
			SINGLE_VALUED.length + MULTI_VALUED.length,
		);
		for (const fact of FACT_LABELS)
			await expect(
				view.getByRole("textbox", { name: fact, exact: true }),
			).toHaveCount(0);
		await expect(view).toContainText("MP3");
		await expect(view).toContainText("128 kbps");
	});

	test.describe("where the player permits some editable fields and not others", () => {
		test.use({ fooJean: { allowedFields: ["rating", "TITLE"] } });

		test("a field it does not permit is drawn as text, not as an input", async ({
			page,
			isMobile,
		}) => {
			const view = await openDetailsTab(page, isMobile);
			await startEditing(view);

			await expect(field(view, LABEL.title)).toHaveValue(TITLE);
			await expect(view.getByRole("textbox")).toHaveCount(1);
			await expect(chipList(view, LABEL.artist)).toHaveCount(0);
			await expect(view).toContainText("Jessico");
		});
	});

	test("a tag the file does not hold is still offered, empty, so it can be added", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		// The view hides an empty row, so none of these is drawn before Edit.
		await expect(view).toContainText(LABEL.album);
		await expect(view).not.toContainText(LABEL.publisher);

		await startEditing(view);

		await expect(field(view, LABEL.publisher)).toHaveValue("");
		await expect(field(view, LABEL.bpm)).toHaveValue("");
		await expect(field(view, LABEL.composer)).toHaveValue("");
		await expect(chips(view, LABEL.composer)).toHaveCount(0);
	});

	test("Save is disabled until a field differs from what was read, and again once it is put back", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		await expect(saveButton(view)).toBeDisabled();

		await field(view, LABEL.album).fill("Jessico (reedición)");
		await expect(saveButton(view)).toBeEnabled();

		await field(view, LABEL.album).fill("Jessico");
		await expect(saveButton(view)).toBeDisabled();
	});

	test("text typed in a chip input and not yet a chip is a difference", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);

		await typeInto(field(view, LABEL.composer), "Adrián Dárgelos");

		await expect(chips(view, LABEL.composer)).toHaveCount(0);
		await expect(saveButton(view)).toBeEnabled();
	});

	test("chips put back in the order read are no difference, and the same chips in another order are", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);

		await removeButton(view, LABEL.genre, "Pop; Latino").click();
		await expect(saveButton(view)).toBeEnabled();
		await typeInto(field(view, LABEL.genre), "Pop\\; Latino");
		await field(view, LABEL.genre).press("Enter");
		await expect(chips(view, LABEL.genre)).toHaveText(GENRES);
		await expect(saveButton(view)).toBeDisabled();

		await removeButton(view, LABEL.genre, "Rock En Español").click();
		await typeInto(field(view, LABEL.genre), "Rock En Español");
		await field(view, LABEL.genre).press("Enter");
		await expect(chips(view, LABEL.genre)).toHaveText([
			"Pop; Latino",
			"Rock En Español",
		]);
		await expect(saveButton(view)).toBeEnabled();
	});

	test("a field that differs is described as changed, and stops being once it is put back", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		await expect(field(view, LABEL.album)).not.toHaveAccessibleDescription(
			CHANGED,
		);

		await field(view, LABEL.album).fill("Jessico (reedición)");
		await typeInto(field(view, LABEL.artist), "Los Fabulosos");
		await field(view, LABEL.artist).press("Enter");

		await expect(field(view, LABEL.album)).toHaveAccessibleDescription(CHANGED);
		await expect(field(view, LABEL.artist)).toHaveAccessibleDescription(
			CHANGED,
		);
		await expect(field(view, LABEL.title)).not.toHaveAccessibleDescription(
			CHANGED,
		);
		await expect(field(view, LABEL.genre)).not.toHaveAccessibleDescription(
			CHANGED,
		);

		await field(view, LABEL.album).fill("Jessico");
		await expect(field(view, LABEL.album)).not.toHaveAccessibleDescription(
			CHANGED,
		);
	});

	test("Cancel with nothing changed leaves edit mode at once, asking nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);

		await cancelButton(view).click();

		await expectNotEditing(view);
		await untilQuiet(player);
		expect(await promptsEverShown(page)).toEqual([]);
		expect(tagWrites(player)).toEqual([]);
	});

	test("Escape with nothing changed leaves edit mode at once, asking nothing, and the view stays", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		// Pressed where edit mode puts the cursor, inside an input, which is where somebody is.
		await expect(field(view, LABEL.title)).toBeFocused();

		await page.keyboard.press("Escape");

		await expectNotEditing(view);
		await expect(view).toContainText("Jessico");
		await untilQuiet(player);
		expect(await promptsEverShown(page)).toEqual([]);
	});

	// Asked, kept, asked again, discarded: a guard that asks once loses the change on the second press.
	test("Cancel with a change asks first: Keep editing keeps the form as it was, and Discard leaves with nothing written", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		await field(view, LABEL.album).fill("Jessico (reedición)");

		await cancelButton(view).click();
		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();

		await expect(prompt).toHaveCount(0);
		await expectEditing(view);
		await expect(field(view, LABEL.album)).toHaveValue("Jessico (reedición)");

		await cancelButton(view).click();
		await expectDiscardPrompt(page);
		await discardButton(prompt).click();

		await expectNotEditing(view);
		await expectSettlesAt(player, () => tagWrites(player).length, 0);

		await startEditing(view);
		await expect(field(view, LABEL.album)).toHaveValue("Jessico");
		await expect(saveButton(view)).toBeDisabled();
	});

	test("Escape with a change asks first, and Discard leaves edit mode", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		await field(view, LABEL.album).fill("Jessico (reedición)");

		await page.keyboard.press("Escape");
		const prompt = await expectDiscardPrompt(page);
		await expectEditing(view);

		await discardButton(prompt).click();
		await expectNotEditing(view);
		await expectSettlesAt(player, () => tagWrites(player).length, 0);
	});
});

test.describe("the chip input", () => {
	test.use(SEEDED);

	test("each value the file holds is one chip, in the file's order, a value holding ';' one chip showing it", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);

		await expect(chips(view, LABEL.genre)).toHaveText(GENRES);
		await expect(field(view, LABEL.genre)).toHaveValue("");
	});

	test("Enter makes the text a chip and empties the box, does nothing in an empty box, and never saves", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const box = field(view, LABEL.genre);

		await typeInto(box, "Indie");
		await box.press("Enter");
		await expect(chips(view, LABEL.genre)).toHaveText([...GENRES, "Indie"]);
		await expect(box).toHaveValue("");
		await expect(box).toBeFocused();

		await box.press("Enter");
		await expect(chips(view, LABEL.genre)).toHaveText([...GENRES, "Indie"]);

		await expectEditing(view);
		await expectSettlesAt(player, () => tagWrites(player).length, 0);
	});

	test("a ';' typed makes a chip of the text before it at once", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const box = field(view, LABEL.artist);

		await typeInto(box, "Los Fabulosos;");

		await expect(chips(view, LABEL.artist)).toHaveText([
			"Babasónicos",
			"Los Fabulosos",
		]);
		await expect(box).toHaveValue("");
	});

	test("leaving the box makes a chip of its text", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);

		await typeInto(field(view, LABEL.composer), "Adrián Dárgelos");
		await field(view, LABEL.publisher).click();

		await expect(chips(view, LABEL.composer)).toHaveText(["Adrián Dárgelos"]);
		await expect(field(view, LABEL.composer)).toHaveValue("");
	});

	// The rules one by one are `test/unit/chipText.test.ts`; this is the browser carrying a typed list
	// through them, a backslash and a comma included.
	test("a typed list splits on every ';' not after a '\\', trims, drops empty parts and a chip already held, and never splits on a comma", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const box = field(view, LABEL.artist);

		await typeInto(
			box,
			"Metallica\\; Nirvana; Crosby, Stills, Nash;;  ; AC\\DC; Babasónicos",
		);
		await box.press("Enter");

		await expect(chips(view, LABEL.artist)).toHaveText([
			"Babasónicos",
			"Metallica; Nirvana",
			"Crosby, Stills, Nash",
			"AC\\DC",
		]);
		await expect(box).toHaveValue("");
	});

	test("a paste becomes every chip in it at once, a line break splitting as ';' does", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const box = field(view, LABEL.artist);

		await paste(page, box, "Metallica; Nirvana\nSoda Stereo");

		await expect(chips(view, LABEL.artist)).toHaveText([
			"Babasónicos",
			"Metallica",
			"Nirvana",
			"Soda Stereo",
		]);
		await expect(box).toHaveValue("");
	});

	test("Backspace in an empty box brings the last chip back as text to edit, its ';' written as '\\;'", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const box = field(view, LABEL.genre);
		await box.click();

		await box.press("Backspace");

		await expect(chips(view, LABEL.genre)).toHaveText(["Rock En Español"]);
		await expect(box).toHaveValue("Pop\\; Latino");
		await expect(box).toBeFocused();

		// Back as it was: the escape is what keeps it one chip.
		await box.press("Enter");
		await expect(chips(view, LABEL.genre)).toHaveText(GENRES);
	});

	test("Left from an empty box reaches the last chip, Left and Right move between chips, and Backspace or Delete remove the focused one and focus the chip before it, or the box", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const box = field(view, LABEL.artist);
		await typeInto(box, "Metallica;Nirvana;Soda Stereo;");
		await expect(chips(view, LABEL.artist)).toHaveText([
			"Babasónicos",
			"Metallica",
			"Nirvana",
			"Soda Stereo",
		]);

		await box.press("ArrowLeft");
		await expect
			.poll(() => holdsFocus(chip(view, LABEL.artist, "Soda Stereo")))
			.toBe(true);
		await page.keyboard.press("ArrowLeft");
		await expect
			.poll(() => holdsFocus(chip(view, LABEL.artist, "Nirvana")))
			.toBe(true);
		await page.keyboard.press("ArrowLeft");
		await expect
			.poll(() => holdsFocus(chip(view, LABEL.artist, "Metallica")))
			.toBe(true);
		await page.keyboard.press("ArrowRight");
		await expect
			.poll(() => holdsFocus(chip(view, LABEL.artist, "Nirvana")))
			.toBe(true);

		await page.keyboard.press("Backspace");
		await expect(chips(view, LABEL.artist)).toHaveText([
			"Babasónicos",
			"Metallica",
			"Soda Stereo",
		]);
		await expect
			.poll(() => holdsFocus(chip(view, LABEL.artist, "Metallica")))
			.toBe(true);

		await page.keyboard.press("ArrowLeft");
		await expect
			.poll(() => holdsFocus(chip(view, LABEL.artist, "Babasónicos")))
			.toBe(true);
		await page.keyboard.press("Delete");
		await expect(chips(view, LABEL.artist)).toHaveText([
			"Metallica",
			"Soda Stereo",
		]);
		// No chip before the first, so the box takes the focus.
		await expect(box).toBeFocused();
	});

	test("each chip's remove button removes that chip, and on a phone is at least 44 px square", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const remove = removeButton(view, LABEL.genre, "Rock En Español");

		if (isMobile) {
			const box = await remove.boundingBox();
			expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}

		await remove.click();
		await expect(chips(view, LABEL.genre)).toHaveText(["Pop; Latino"]);
	});

	test("a screen reader hears the chips as a list named by the field, each remove button as Remove and the value, and the text box named by the field", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);

		await expect(chipList(view, LABEL.genre)).toBeVisible();
		await expect(chips(view, LABEL.genre)).toHaveCount(2);
		for (const value of GENRES)
			await expect(removeButton(view, LABEL.genre, value)).toBeVisible();
		await expect(field(view, LABEL.genre)).toBeVisible();
	});
});

test.describe("the save", () => {
	test.use(SEEDED);

	const writtenOnce = async (player: FakePlayer) => {
		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		return sentFields(player)[0];
	};

	test("a chip holding ';' is sent as one value of an array, the chips in their order", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		await typeInto(field(view, LABEL.genre), "Indie");
		await field(view, LABEL.genre).press("Enter");

		await saveButton(view).click();

		expect(await writtenOnce(player)).toEqual({
			GENRE: ["Rock En Español", "Pop; Latino", "Indie"],
		});
	});

	test("a field emptied is sent empty: an array with nothing in it for a multi-value field, the empty string for a single one", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		await removeButton(view, LABEL.artist, "Babasónicos").click();
		await field(view, LABEL.album).fill("");

		await saveButton(view).click();

		expect(await writtenOnce(player)).toEqual({ ARTIST: [], ALBUM: "" });
	});

	test("Save makes a chip of text still in a chip box, and sends it", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		await typeInto(field(view, LABEL.composer), "Adrián Dárgelos");

		await saveButton(view).click();

		expect(await writtenOnce(player)).toEqual({
			COMPOSER: ["Adrián Dárgelos"],
		});
	});

	test("Save sends one POST /api/tags to the track the form was opened on, carrying every field that differs and no other", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		await field(view, LABEL.album).fill("Jessico (reedición)");
		await field(view, LABEL.bpm).fill("128");
		await removeButton(view, LABEL.genre, "Rock En Español").click();

		await saveButton(view).click();

		expect(await writtenOnce(player)).toEqual({
			ALBUM: "Jessico (reedición)",
			BPM: "128",
			GENRE: ["Pop; Latino"],
		});
		expect(titleAddressedBy(player, tagWrites(player)[0].body)).toBe(TITLE);
	});

	test("a write the player takes leaves edit mode, draws the values written, and the list row shows them within one poll", async ({
		page,
		player,
		isMobile,
	}) => {
		// The library's own list, which follows the library revision a write moves.
		await openAllMusic(page);
		const view = await openDetailsPanelOn(
			page,
			isMobile,
			rowByTitle(page, TITLE),
		);
		await startEditing(view);
		await field(view, LABEL.title).fill("Los Calientes (en vivo)");
		await field(view, LABEL.album).fill("Jessico (reedición)");

		await saveButton(view).click();

		await expectNotEditing(view);
		await expect(view).toContainText("Jessico (reedición)");
		await expect(rowByTitle(page, "Los Calientes (en vivo)")).toBeVisible();
		await expectSettlesAt(player, () => tagWrites(player).length, 1);
	});

	// Each refusal keeps what was typed, chips included, and says why above the form.
	const changeTitleAndGenre = async (view: Locator) => {
		await startEditing(view);
		await field(view, LABEL.title).fill("Los Calientes (en vivo)");
		await typeInto(field(view, LABEL.genre), "Indie");
		await field(view, LABEL.genre).press("Enter");
		await typeInto(field(view, LABEL.composer), "Adrián Dárgelos");
	};

	const expectEverythingKept = async (view: Locator) => {
		await expectEditing(view);
		await expect(field(view, LABEL.title)).toHaveValue(
			"Los Calientes (en vivo)",
		);
		await expect(chips(view, LABEL.genre)).toHaveText([...GENRES, "Indie"]);
		// Text pending in a box at Save became a chip, and stays one.
		await expect(chips(view, LABEL.composer)).toHaveText(["Adrián Dárgelos"]);
		await expect(saveButton(view)).toBeEnabled();
	};

	test("a 403 naming a field says the player no longer permits writing it, by its label, and keeps every value", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await changeTitleAndGenre(view);
		// The player owner narrowing the allowlist with the form open. Capabilities are read once,
		// so GENRE is still offered and the write is the first to hear. A new array: the default is
		// shared by every test in the worker.
		player.fooJean.allowedFields = player.fooJean.allowedFields.filter(
			(name) => name !== "GENRE",
		);

		await saveButton(view).click();

		await expect(failureOf(view)).toHaveText(FAILURE.forbidden(LABEL.genre));
		await expectEverythingKept(view);
		expect(losCalientesHeld(player)?.["$meta(title)"]).toBe(TITLE);
	});

	for (const [status, words] of [
		[409, FAILURE.moved],
		[404, FAILURE.gone],
		[500, FAILURE.failed],
		[429, FAILURE.tooMany],
	] as const)
		test.describe(`where the player answers ${status}`, () => {
			test.use({ fooJean: { failWrites: status } });

			test("says why above the form and keeps every value", async ({
				page,
				isMobile,
			}) => {
				const view = await openDetailsTab(page, isMobile);
				await changeTitleAndGenre(view);

				await saveButton(view).click();

				await expect(failureOf(view)).toHaveText(words);
				await expectEverythingKept(view);
			});
		});

	test("a player gone from the network says it could not be reached and keeps every value", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await changeTitleAndGenre(view);
		await loseThePlayer(page);

		await saveButton(view).click();

		await expect(failureOf(view)).toHaveText(FAILURE.unreachable);
		await expectEverythingKept(view);
	});

	// A 504 says nothing about whether the tags were written. A second write could land over a change
	// made in between, so Jean reads the track once and lets what the file holds decide.
	test.describe("where the write times out and every value landed", () => {
		test.use({ fooJean: { failWrites: 504, writesLandAnyway: true } });

		test("reads the track back once, never writes again, and leaves edit mode drawing what the file holds", async ({
			page,
			player,
			isMobile,
		}) => {
			const view = await openDetailsTab(page, isMobile);
			await startEditing(view);
			await field(view, LABEL.album).fill("Jessico (reedición)");
			const before = readsBack(player);

			await saveButton(view).click();

			await expectNotEditing(view);
			await expect(view).toContainText("Jessico (reedición)");
			await expectSettlesAt(player, () => tagWrites(player).length, 1);
			expect(readsBack(player) - before).toBe(1);
			await expect(failureOf(view)).toHaveCount(0);
		});
	});

	test.describe("where the write times out and nothing landed", () => {
		test.use({ fooJean: { failWrites: 504 } });

		test("reads the track back once, never writes again, and stays in edit mode saying the save could not be confirmed", async ({
			page,
			player,
			isMobile,
		}) => {
			const view = await openDetailsTab(page, isMobile);
			await changeTitleAndGenre(view);
			const before = readsBack(player);

			await saveButton(view).click();

			await expect(failureOf(view)).toHaveText(FAILURE.unconfirmed);
			await expectEverythingKept(view);
			await expectSettlesAt(player, () => tagWrites(player).length, 1);
			expect(readsBack(player) - before).toBe(1);
		});
	});

	test.describe("where the write times out and the read back is refused", () => {
		test.use({ fooJean: { failWrites: 504, failLibraryTrack: 500 } });

		test("never writes again and stays in edit mode saying the save could not be confirmed", async ({
			page,
			player,
			isMobile,
		}) => {
			const view = await openDetailsTab(page, isMobile);
			await changeTitleAndGenre(view);

			await saveButton(view).click();

			await expect(failureOf(view)).toHaveText(FAILURE.unconfirmed);
			await expectEverythingKept(view);
			await expectSettlesAt(player, () => tagWrites(player).length, 1);
		});
	});

	test.describe("where the write times out and the read back never answers", () => {
		test.use({ fooJean: { failWrites: 504, hangLibraryTrack: true } });

		test("never writes again and stays in edit mode with every value", async ({
			page,
			player,
			isMobile,
		}) => {
			const view = await openDetailsTab(page, isMobile);
			await changeTitleAndGenre(view);

			await saveButton(view).click();
			await expect
				.poll(() => readsBack(player), { message: "nothing was read back" })
				.toBeGreaterThan(0);

			// Past this, nothing from the open read can arrive, so what is drawn now is what stays.
			await page.waitForTimeout(STALLED_READ_MS * 2);

			await expectEverythingKept(view);
			await expectSettlesAt(player, () => tagWrites(player).length, 1);
		});
	});

	test.describe("on the desktop", () => {
		test.skip(
			({ isMobile }) => Boolean(isMobile),
			"Ctrl or Cmd with Enter is a hardware keyboard's chord",
		);

		test("Ctrl or Cmd with Enter saves from a text input", async ({
			page,
			player,
			isMobile,
		}) => {
			const view = await openDetailsTab(page, isMobile);
			await startEditing(view);
			await field(view, LABEL.album).fill("Jessico (reedición)");

			await field(view, LABEL.album).press("ControlOrMeta+Enter");

			expect(await writtenOnce(player)).toEqual({
				ALBUM: "Jessico (reedición)",
			});
		});

		test("Ctrl or Cmd with Enter saves from a chip box, the text in it sent as a chip", async ({
			page,
			player,
			isMobile,
		}) => {
			const view = await openDetailsTab(page, isMobile);
			await startEditing(view);
			await typeInto(field(view, LABEL.composer), "Adrián Dárgelos");

			await field(view, LABEL.composer).press("ControlOrMeta+Enter");

			expect(await writtenOnce(player)).toEqual({
				COMPOSER: ["Adrián Dárgelos"],
			});
		});
	});

	test.describe("on a playlist row the media library does not hold", () => {
		// Addressed by its playlist, position and structure, since the library form cannot name it.
		const OFF_LIBRARY: Track = {
			"%path%": "D:\\Incoming\\Night Sessions\\01 Fourth Wall.flac",
			"%title%": "Fourth Wall",
			"%artist%": "The Dry Season",
			"%album%": "Night Sessions",
			"%album artist%": "The Dry Season",
			"%tracknumber%": "01",
			"%length_seconds%": "212",
			"%length%": "3:32",
			"$meta(title)": "Fourth Wall",
			"$meta(album)": "Night Sessions",
		};
		const AT = 2;

		test("a reorder of the playlist under an open form makes Save answer 409, and nothing is written", async ({
			page,
			player,
			isMobile,
		}) => {
			player.playlistById("p7")?.items.splice(AT, 0, { ...OFF_LIBRARY });
			await openLibrary(page);
			await expect(trackRow(page, AT)).toContainText("Fourth Wall");
			const view = await openDetailsPanelAt(page, isMobile, AT);
			await startEditing(view);
			await expect(field(view, LABEL.title)).toHaveValue("Fourth Wall");
			await field(view, LABEL.album).fill("Night Sessions (demo)");

			player.sortItems("p7", { by: "%title%" });
			await saveButton(view).click();

			await expect(failureOf(view)).toHaveText(FAILURE.moved);
			await expectEditing(view);
			await expect(field(view, LABEL.album)).toHaveValue(
				"Night Sessions (demo)",
			);
			const everyRow = player.playlistById("p7")?.items ?? [];
			expect(
				everyRow.filter(
					(track) => track["$meta(album)"] === "Night Sessions (demo)",
				),
			).toEqual([]);
		});
	});
});

test.describe("the two hosts", () => {
	test.use(SEEDED);

	const changeAlbum = async (view: Locator) => {
		await startEditing(view);
		await field(view, LABEL.album).fill("Jessico (reedición)");
	};

	test("closing the details panel with a change asks first: Keep editing keeps the form, and Discard closes it with nothing written", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await changeAlbum(view);

		await button(view, CLOSE_PANEL).click();
		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();

		await expect(prompt).toHaveCount(0);
		await expect(view).toBeVisible();
		await expect(field(view, LABEL.album)).toHaveValue("Jessico (reedición)");

		await button(view, CLOSE_PANEL).click();
		await expectDiscardPrompt(page);
		await discardButton(prompt).click();

		await expect(detailsPanel(page)).toBeHidden();
		await expectSettlesAt(player, () => tagWrites(player).length, 0);
	});

	test("pointing the details panel at another row with a change asks first, and Discard shows the other row", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await changeAlbum(view);

		await openRowMenu(page, isMobile, 1, DETAILS_ITEM);
		await page
			.getByRole("menuitem", { name: DETAILS_ITEM, exact: true })
			.click();
		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();
		await expect(field(view, LABEL.album)).toHaveValue("Jessico (reedición)");

		await openRowMenu(page, isMobile, 1, DETAILS_ITEM);
		await page
			.getByRole("menuitem", { name: DETAILS_ITEM, exact: true })
			.click();
		await expectDiscardPrompt(page);
		await discardButton(prompt).click();

		await expect(view).toContainText("Fizz");
		await expect(view).not.toContainText(TITLE);
		await expectSettlesAt(player, () => tagWrites(player).length, 0);
	});

	test("leaving the route with a change in the details panel asks first", async ({
		page,
		player,
		isMobile,
	}) => {
		// Somewhere in the app to go back to: the page the fixture opens is not one.
		await page.goto("/#/home");
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await changeAlbum(view);
		const leftFrom = page.url();

		await page.goBack();

		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();
		await expect(page).toHaveURL(leftFrom);
		await expect(field(view, LABEL.album)).toHaveValue("Jessico (reedición)");
		await expectSettlesAt(player, () => tagWrites(player).length, 0);
	});

	test("leaving the Details tab's route with a change asks first", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await changeAlbum(view);
		const leftFrom = page.url();

		await page.goBack();

		const prompt = await expectDiscardPrompt(page);
		await keepEditingButton(prompt).click();
		await expect(page).toHaveURL(leftFrom);
		await expect(field(view, LABEL.album)).toHaveValue("Jessico (reedición)");
		await expectSettlesAt(player, () => tagWrites(player).length, 0);
	});

	test("a form on the Details tab stays on its track when the player moves on, says the track is no longer playing, and saves to it", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await changeAlbum(view);
		await expect(view).not.toContainText(NOT_PLAYING);

		player.next();
		await untilThePageKnowsPlaying(page, "Fizz");

		await expect(view).toContainText(NOT_PLAYING);
		await expect(field(view, LABEL.title)).toHaveValue(TITLE);
		await expect(field(view, LABEL.album)).toHaveValue("Jessico (reedición)");

		await saveButton(view).click();

		await expectSettlesAt(player, () => tagWrites(player).length, 1);
		expect(titleAddressedBy(player, tagWrites(player)[0].body)).toBe(TITLE);
		expect(sentFields(player)[0]).toEqual({ ALBUM: "Jessico (reedición)" });
		const fizz = player
			.playlistById("p7")
			?.items.find((track) => track["%title%"] === "Fizz");
		expect(fizz?.["$meta(album)"]).toBeUndefined();
	});
});

test.describe("after the audit", () => {
	test.use(SEEDED);

	// Left from an empty chip box puts the keyboard on the last chip, which is neither an input nor
	// a text area, so a host listening for Escape on the window hears it before the form does.
	const focusLastGenre = async (view: Locator) => {
		await field(view, LABEL.genre).click();
		await field(view, LABEL.genre).press("ArrowLeft");
		await expect
			.poll(() => holdsFocus(chip(view, LABEL.genre, "Pop; Latino")))
			.toBe(true);
	};

	test("Escape on a chip of the details panel's form leaves edit mode and leaves the panel open", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await startEditing(view);
		await focusLastGenre(view);

		await page.keyboard.press("Escape");

		await expectNotEditing(view);
		await expect(view).toContainText("Jessico");
	});

	test("Escape on Cancel in the details panel with a change asks, and Discard leaves edit mode with the panel still open", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await startEditing(view);
		await field(view, LABEL.album).fill("Jessico (reedición)");
		await cancelButton(view).focus();

		await page.keyboard.press("Escape");
		const prompt = await expectDiscardPrompt(page);
		await discardButton(prompt).click();

		await expectNotEditing(view);
		await expect(view).toContainText("Jessico");
		await expectSettlesAt(player, () => tagWrites(player).length, 0);
	});

	test("Escape on a chip of the Details tab's form leaves edit mode and stays on the route", async ({
		page,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const on = page.url();
		await focusLastGenre(view);

		await page.keyboard.press("Escape");

		await expectNotEditing(view);
		await expect(page).toHaveURL(on);
	});

	test("Escape on Save in the Details tab with a change asks, and Discard leaves edit mode and stays on the route", async ({
		page,
		player,
		isMobile,
	}) => {
		const view = await openDetailsTab(page, isMobile);
		await startEditing(view);
		const on = page.url();
		await field(view, LABEL.album).fill("Jessico (reedición)");
		await saveButton(view).focus();

		await page.keyboard.press("Escape");
		const prompt = await expectDiscardPrompt(page);
		await discardButton(prompt).click();

		await expectNotEditing(view);
		await expect(page).toHaveURL(on);
		await expectSettlesAt(player, () => tagWrites(player).length, 0);
	});

	test("on a phone with the keyboard up, Save and Cancel stay on screen while a field low in the form has the focus", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "the on-screen keyboard is a phone's");

		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await startEditing(view);
		// The height a Pixel 7 keeps above its keyboard, near enough: a short viewport stands in for
		// the keyboard, which Chromium's emulation does not draw.
		await page.setViewportSize({ width: 412, height: 420 });
		await field(view, LABEL.bpm).click();
		await expect(field(view, LABEL.bpm)).toBeFocused();
		await expect(field(view, LABEL.bpm)).toBeInViewport();

		await expect(saveButton(view)).toBeInViewport({ ratio: 1 });
		await expect(cancelButton(view)).toBeInViewport({ ratio: 1 });
	});

	test("a second save from one open details panel draws both edits", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);

		await startEditing(view);
		await field(view, LABEL.album).fill("Jessico (reedición)");
		await saveButton(view).click();
		await expectNotEditing(view);
		await expect(view).toContainText("Jessico (reedición)");

		await startEditing(view);
		await field(view, LABEL.publisher).fill("Discos Manzana");
		await saveButton(view).click();

		await expectNotEditing(view);
		await expect(view).toContainText("Discos Manzana");
		await expect(view).toContainText("Jessico (reedición)");
		await expectSettlesAt(player, () => tagWrites(player).length, 2);
	});

	test("after Discard closes a dirty details panel, leaving the route asks nothing more", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordPromptsEverShown(page);
		// Somewhere in the app to go back to: the page the fixture opens is not one.
		await page.goto("/#/home");
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await startEditing(view);
		await field(view, LABEL.album).fill("Jessico (reedición)");

		await button(view, CLOSE_PANEL).click();
		const prompt = await expectDiscardPrompt(page);
		await discardButton(prompt).click();
		await expect(detailsPanel(page)).toBeHidden();
		const leftFrom = page.url();

		await page.goBack();

		await expect(page).not.toHaveURL(leftFrom);
		await untilQuiet(player);
		expect(await promptsEverShown(page)).toHaveLength(1);
		expect(tagWrites(player)).toEqual([]);
	});

	test("a new title and artist saved in the details panel are what its heading shows", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		const view = await openDetailsPanelAt(page, isMobile);
		await startEditing(view);
		await field(view, LABEL.title).fill("Los Calientes (en vivo)");
		await removeButton(view, LABEL.artist, "Babasónicos").click();
		await typeInto(field(view, LABEL.artist), "Los Fabulosos");
		await field(view, LABEL.artist).press("Enter");

		await saveButton(view).click();

		await expectNotEditing(view);
		await expect(
			view.getByRole("heading", {
				level: 2,
				name: "Los Calientes (en vivo)",
				exact: true,
			}),
		).toBeVisible();
		await expect(
			view.getByText("Los Fabulosos", { exact: true }),
		).toBeVisible();
		await expect(
			view.getByRole("heading", { level: 2, name: TITLE, exact: true }),
		).toHaveCount(0);
	});
});
