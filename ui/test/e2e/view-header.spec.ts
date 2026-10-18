import type { Route } from "@playwright/test";
import {
	albumRoute,
	artistRoute,
	genreRoute,
	searchRoute,
	shelfRoute,
} from "../../src/domain/track/routes.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	coversByPosition,
	coversFromTheComponent,
	expect,
	expectDisabledWithReason,
	expectSettlesAt,
	guidOfPlaylist,
	holdRequests,
	OFFERS_NO_SHUFFLE,
	test,
	titlesIn,
	trackRow,
	untilQuiet,
	viewHeader,
} from "./fixtures.ts";
import { openRowMenu } from "./menus.ts";
import { scrollTo, scrollTop } from "./scrolling.ts";

type Figure = "albums" | "tracks" | "duration" | "span";

const backdrop = (page: Page) => viewHeader(page).locator("[data-backdrop]");

const figureLine = (page: Page) => viewHeader(page).locator("p[data-figures]");

const figure = (page: Page, name: Figure) =>
	figureLine(page).locator(`span[data-figure="${name}"]`);

const title = (page: Page) =>
	viewHeader(page).getByRole("heading", { level: 1 });

const eyebrow = (page: Page, phrase: string) =>
	viewHeader(page).getByText(phrase, { exact: true });

const coversShown = (page: Page) =>
	expect(backdrop(page)).toHaveAttribute("data-ready", "true");

const DESKTOP_FLOOR_PX = 320;
const PHONE_FLOOR_PX = 260;

const floorFor = (isMobile: boolean) =>
	isMobile ? PHONE_FLOOR_PX : DESKTOP_FLOOR_PX;

const TWENTY_ALBUMS = { tracks: 200, albums: 20, years: [1990, 2010] } as {
	tracks: number;
	albums: number;
	years: [number, number];
};

// A generated track has no sleeve in the fake, so a shaped library answers every cover 404, which is
// the set none of whose covers answers. This gives each album one of the fake's five sleeves, the same
// for every track of it; `libraryOfShape` puts track `n` on album `n % albums`.
const SLEEVES = [
	"deja-entendu.jpg",
	"jessico.jpg",
	"jar-of-flies.jpg",
	"deathconsciousness.jpg",
	"lafcadio.jpg",
];

const sleevesFor = ({ tracks, albums }: { tracks: number; albums: number }) =>
	Object.fromEntries(
		Array.from({ length: tracks }, (_, index) => [
			`Track ${index + 1}`,
			SLEEVES[(index % albums) % SLEEVES.length],
		]),
	);

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
	right: number;
	bottom: number;
}

const boxOf = async (locator: Locator): Promise<Box> => {
	const box = await locator.boundingBox();
	if (!box) throw new Error("the element has no box, so it is not drawn");
	return { ...box, right: box.x + box.width, bottom: box.y + box.height };
};

// Rounded inwards, so a fractional box does not bring a row of whatever is below it into the picture.
const clipOf = ({ x, y, right, bottom }: Box) => ({
	x: Math.ceil(x),
	y: Math.ceil(y),
	width: Math.floor(right) - Math.ceil(x),
	height: Math.floor(bottom) - Math.ceil(y),
});

const paddingOf = (locator: Locator) =>
	locator.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			left: Number.parseFloat(style.paddingLeft),
			right: Number.parseFloat(style.paddingRight),
		};
	});

interface View {
	name: string;
	path: (player: FakePlayer) => string;
	title: string;
}

const SEVEN_VIEWS: View[] = [
	{ name: "All music", path: () => "all", title: "All music" },
	{
		name: "an album",
		path: () => albumRoute("Babasónicos", "Jessico"),
		title: "Jessico",
	},
	{
		name: "a genre",
		path: () => genreRoute("Rock En Español"),
		title: "Rock En Español",
	},
	{ name: "a shelf", path: () => shelfRoute("top"), title: "Most played" },
	{
		name: "a playlist",
		path: (player) => guidOfPlaylist(player, "p7"),
		title: "Library",
	},
	{
		name: "an artist",
		path: () => artistRoute("Babasónicos"),
		title: "Babasónicos",
	},
	{
		name: "search results",
		path: () => searchRoute("babasonicos"),
		title: "babasonicos",
	},
];

const openView = async (page: Page, player: FakePlayer, view: View) => {
	await page.goto(`/#/${view.path(player)}`);
	await expect(title(page)).toHaveText(view.title);
};

const ALL_MUSIC = SEVEN_VIEWS[0];
const THE_PLAYLIST = SEVEN_VIEWS[4];
const THE_ARTIST = SEVEN_VIEWS[5];

const screenshotOfTheBackdropAlone = async (page: Page) => {
	const header = viewHeader(page);
	await header.evaluate((root) => {
		const layer = root.querySelector("[data-backdrop]");
		const hidden: [HTMLElement, string, string][] = [];
		for (const element of root.querySelectorAll<HTMLElement>("*")) {
			if (layer && (element.contains(layer) || layer.contains(element)))
				continue;
			hidden.push([
				element,
				element.style.getPropertyValue("visibility"),
				element.style.getPropertyPriority("visibility"),
			]);
			element.style.setProperty("visibility", "hidden", "important");
		}
		Reflect.set(window, "__showTheHeaderAgain", () => {
			for (const [element, value, priority] of hidden)
				if (value) element.style.setProperty("visibility", value, priority);
				else element.style.removeProperty("visibility");
		});
	});
	try {
		return await page.screenshot({
			clip: clipOf(await boxOf(header)),
			scale: "css",
			animations: "disabled",
		});
	} finally {
		await page.evaluate(() =>
			(Reflect.get(window, "__showTheHeaderAgain") as () => void)(),
		);
	}
};

interface BackdropReading {
	// The largest difference from `--bg`, in any channel, anywhere but the outer 8px. The window's
	// own right edge paints a column of its own there in the light theme, header or none.
	fromTheBackground: number;
	leftEdge: number;
	bottomEdge: number;
	topRight: number;
	topThird: number;
	// What a light blur takes away: the 99.5th percentile of the luminance difference between the
	// pixels and a 3px-blurred copy of them. A cover drawn sharp loses its
	// edges, lettering and tile seams to it; one already blurred loses next to nothing.
	sharpness: number;
}

const readTheBackdrop = async (page: Page): Promise<BackdropReading> => {
	const png = await screenshotOfTheBackdropAlone(page);
	return page.evaluate(async (base64) => {
		const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
		const bitmap = await createImageBitmap(
			new Blob([bytes], { type: "image/png" }),
		);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) throw new Error("no 2d context");
		context.drawImage(bitmap, 0, 0);
		const { data, width, height } = context.getImageData(
			0,
			0,
			bitmap.width,
			bitmap.height,
		);

		const swatch = new OffscreenCanvas(1, 1).getContext("2d");
		if (!swatch) throw new Error("no 2d context");
		swatch.fillStyle = getComputedStyle(document.documentElement)
			.getPropertyValue("--bg")
			.trim();
		swatch.fillRect(0, 0, 1, 1);
		const bg = swatch.getImageData(0, 0, 1, 1).data;

		const at = (x: number, y: number) => (y * width + x) * 4;
		const distance = (index: number) =>
			Math.max(
				Math.abs(data[index] - bg[0]),
				Math.abs(data[index + 1] - bg[1]),
				Math.abs(data[index + 2] - bg[2]),
			);
		const luminance = (index: number) =>
			0.2126 * data[index] +
			0.7152 * data[index + 1] +
			0.0722 * data[index + 2];

		const INSET = 8;
		let fromTheBackground = 0;
		let leftEdge = 0;
		let bottomEdge = 0;
		let topRightSum = 0;
		let topRightCount = 0;
		let topThirdSum = 0;
		let topThirdCount = 0;
		const softened = new OffscreenCanvas(width, height).getContext("2d", {
			willReadFrequently: true,
		});
		if (!softened) throw new Error("no 2d context");
		softened.filter = "blur(3px)";
		softened.drawImage(bitmap, 0, 0);
		const soft = softened.getImageData(0, 0, width, height).data;
		const lost = new Array<number>(256).fill(0);
		let lostCount = 0;

		for (let y = INSET; y < height - INSET; y += 1) {
			for (let x = INSET; x < width - INSET; x += 1) {
				const index = at(x, y);
				const off = distance(index);
				fromTheBackground = Math.max(fromTheBackground, off);
				if (x === INSET) leftEdge = Math.max(leftEdge, off);
				if (y === height - INSET - 1) bottomEdge = Math.max(bottomEdge, off);
				if (x >= width / 2 && y < height / 2) {
					topRightSum += off;
					topRightCount += 1;
				}
				if (y < height / 3) {
					topThirdSum += off;
					topThirdCount += 1;
				}
				const blurred =
					0.2126 * soft[index] +
					0.7152 * soft[index + 1] +
					0.0722 * soft[index + 2];
				lost[Math.round(Math.abs(luminance(index) - blurred))] += 1;
				lostCount += 1;
			}
		}

		let sharpness = 0;
		for (let seen = 0; sharpness < 256; sharpness += 1) {
			seen += lost[sharpness];
			if (seen >= lostCount * 0.995) break;
		}

		return {
			fromTheBackground,
			leftEdge,
			bottomEdge,
			topRight: topRightSum / Math.max(1, topRightCount),
			topThird: topThirdSum / Math.max(1, topThirdCount),
			sharpness,
		};
	}, png.toString("base64"));
};

// How far a pixel may sit from `--bg` and still be the page's own background, through a fade and
// the browser's own rounding.
const BACKGROUND_TOLERANCE = 10;
const COVERS_SHOW = 12;
// Calibrated on the fake's covers: the most a light blur may take from a backdrop that is already
// blurred out of recognition.
const BLURRED = 4;

// The worst contrast, by WCAG's formula, between the element's own text colours and any pixel behind
// it. The text is made transparent for the screenshot, so every pixel in its box is what is behind
// the letters; a colour with alpha, or an element with opacity, is mixed over each pixel first.
const worstContrastBehind = async (page: Page, target: Locator) => {
	const inks = await target.evaluate((element) => {
		const header = element.closest("header");
		const swatch = new OffscreenCanvas(1, 1).getContext("2d");
		if (!swatch) throw new Error("no 2d context");
		const rgba = (colour: string) => {
			swatch.clearRect(0, 0, 1, 1);
			swatch.fillStyle = colour;
			swatch.fillRect(0, 0, 1, 1);
			return [...swatch.getImageData(0, 0, 1, 1).data];
		};
		const opacityOf = (node: Element) => {
			let opacity = 1;
			for (
				let at: Element | null = node;
				at && at !== header;
				at = at.parentElement
			)
				opacity *= Number(getComputedStyle(at).opacity);
			return opacity;
		};

		const nodes = [element, ...element.querySelectorAll("*")] as HTMLElement[];
		const found: number[][] = [];
		for (const node of nodes) {
			const carriesText = [...node.childNodes].some(
				(child) =>
					child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
			);
			if (!carriesText) continue;
			const [r, g, b, a] = rgba(getComputedStyle(node).color);
			found.push([r, g, b, (a / 255) * opacityOf(node)]);
		}

		const restore: [HTMLElement, string, string][] = [];
		for (const node of nodes) {
			restore.push([
				node,
				node.style.getPropertyValue("color"),
				node.style.getPropertyPriority("color"),
			]);
			node.style.setProperty("color", "transparent", "important");
		}
		Reflect.set(window, "__inkAgain", () => {
			for (const [node, value, priority] of restore)
				if (value) node.style.setProperty("color", value, priority);
				else node.style.removeProperty("color");
		});
		return found;
	});

	expect(inks.length, "the element carries no text to measure").toBeGreaterThan(
		0,
	);

	let png: Buffer;
	try {
		png = await page.screenshot({
			clip: clipOf(await boxOf(target)),
			scale: "css",
			animations: "disabled",
		});
	} finally {
		await page.evaluate(() =>
			(Reflect.get(window, "__inkAgain") as () => void)(),
		);
	}

	return page.evaluate(
		async ({ base64, inks }) => {
			const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
			const bitmap = await createImageBitmap(
				new Blob([bytes], { type: "image/png" }),
			);
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("no 2d context");
			context.drawImage(bitmap, 0, 0);
			const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);

			const linear = (channel: number) => {
				const value = channel / 255;
				return value <= 0.04045
					? value / 12.92
					: ((value + 0.055) / 1.055) ** 2.4;
			};
			const luminance = (r: number, g: number, b: number) =>
				0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

			let worst = Number.POSITIVE_INFINITY;
			for (let index = 0; index < data.length; index += 4) {
				const behind = luminance(data[index], data[index + 1], data[index + 2]);
				for (const [r, g, b, alpha] of inks) {
					const mix = (ink: number, under: number) =>
						alpha * ink + (1 - alpha) * under;
					const ink = luminance(
						mix(r, data[index]),
						mix(g, data[index + 1]),
						mix(b, data[index + 2]),
					);
					const ratio =
						(Math.max(ink, behind) + 0.05) / (Math.min(ink, behind) + 0.05);
					worst = Math.min(worst, ratio);
				}
			}
			return worst;
		},
		{ base64: png.toString("base64"), inks },
	);
};

const standInsIn = (page: Page) =>
	viewHeader(page).evaluate((root) =>
		[...root.querySelectorAll("svg, img")]
			.filter(
				(element) =>
					!element.closest("button, a, [data-backdrop]") &&
					element.getBoundingClientRect().width > 0,
			)
			.map((element) => element.outerHTML.slice(0, 80)),
	);

const tops = (locator: Locator) =>
	locator.evaluateAll((elements) => [
		...new Set(
			elements.flatMap((element) =>
				[...element.getClientRects()].map((rect) => Math.round(rect.top)),
			),
		),
	]);

const expectTheBackdropBehindTheHeader = async (
	page: Page,
	isMobile: boolean,
) => {
	await coversShown(page);
	await expect(backdrop(page)).toBeVisible();

	const header = await boxOf(viewHeader(page));
	const layer = await boxOf(backdrop(page));
	expect(
		layer.x,
		"the backdrop starts right of the header's edge",
	).toBeLessThanOrEqual(header.x + 1);
	expect(
		layer.y,
		"the backdrop starts below the header's top",
	).toBeLessThanOrEqual(header.y + 1);
	expect(
		layer.right,
		"the backdrop stops short of the header's right edge",
	).toBeGreaterThanOrEqual(header.right - 1);
	expect(
		layer.bottom,
		"the backdrop stops short of the header's bottom",
	).toBeGreaterThanOrEqual(header.bottom - 1);

	const reading = await readTheBackdrop(page);
	expect(
		reading.sharpness,
		"a cover in the backdrop can be read as a picture",
	).toBeLessThanOrEqual(BLURRED);
	expect(
		reading.bottomEdge,
		"the backdrop does not fade into the page at the bottom",
	).toBeLessThanOrEqual(BACKGROUND_TOLERANCE);
	if (isMobile) {
		expect(
			reading.topThird,
			"no cover shows at the top of the header",
		).toBeGreaterThan(COVERS_SHOW);
	} else {
		expect(
			reading.leftEdge,
			"the backdrop does not fade into the page at the left",
		).toBeLessThanOrEqual(BACKGROUND_TOLERANCE);
		expect(
			reading.topRight,
			"no cover shows at the header's top right",
		).toBeGreaterThan(COVERS_SHOW);
	}
};

test.describe("the backdrop", () => {
	for (const view of SEVEN_VIEWS)
		test(`${view.name} draws its covers behind the whole header, blurred and faded into the page`, async ({
			page,
			player,
			isMobile,
		}) => {
			await openView(page, player, view);
			await expectTheBackdropBehindTheHeader(page, isMobile);
		});

	test.describe("in the dark theme", () => {
		test.use({ settings: { "jean.theme": "dark" } });

		for (const view of [ALL_MUSIC, THE_ARTIST])
			test(`${view.name} fades its covers into the dark background`, async ({
				page,
				player,
				isMobile,
			}) => {
				await openView(page, player, view);
				await expectTheBackdropBehindTheHeader(page, isMobile);
			});
	});
});

// The list rows draw no covers on these views, so every cover request is the header's.
const ALL_MUSIC_PICKS = [
	"Album 1/1.mp3",
	"Album 3/3.mp3",
	"Album 5/5.mp3",
	"Album 7/7.mp3",
	"Album 9/9.mp3",
	"Album 12/12.mp3",
	"Album 14/14.mp3",
	"Album 16/16.mp3",
	"Album 18/18.mp3",
];

const ONE_ALONG = [
	"Album 2/2.mp3",
	"Album 4/4.mp3",
	"Album 6/6.mp3",
	"Album 8/8.mp3",
	"Album 10/10.mp3",
	"Album 13/13.mp3",
	"Album 15/15.mp3",
	"Album 17/17.mp3",
	"Album 19/199.mp3",
];

const sorted = (values: string[]) => [...values].sort();

test.describe("the covers a header asks for", () => {
	test.describe("on twenty albums", () => {
		test.use({
			libraryShape: TWENTY_ALBUMS,
			embeddedArt: sleevesFor(TWENTY_ALBUMS),
			settings: { "jean.artwork": false },
		});

		for (const { name, path, heading, asked } of [
			{
				name: "All music",
				path: "all",
				heading: "All music",
				asked: ALL_MUSIC_PICKS,
			},
			{
				name: "an artist's tracks",
				path: artistRoute("Artist 1", "tracks"),
				heading: "Artist 1",
				asked: ALL_MUSIC_PICKS,
			},
			{
				name: "a genre",
				path: genreRoute("Genre 1"),
				heading: "Genre 1",
				asked: ONE_ALONG,
			},
			{
				name: "search results",
				path: searchRoute("track"),
				heading: "track",
				asked: ONE_ALONG,
			},
			{
				name: "an album",
				path: albumRoute("Artist 1", "Album 1"),
				heading: "Album 1",
				asked: ["Album 1/1.mp3"],
			},
		])
			test(`${name} asks for the covers the mosaic picked, and no others`, async ({
				page,
				player,
			}) => {
				await page.goto(`/#/${path}`);
				await expect(title(page)).toHaveText(heading);
				await coversShown(page);

				await expectSettlesAt(
					player,
					() => sorted(coversFromTheComponent(player)),
					sorted(asked),
				);
			});

		test("a playlist asks for the four covers the mosaic picked, and no others", async ({
			page,
			player,
		}) => {
			await openView(page, player, THE_PLAYLIST);
			await coversShown(page);

			const guid = guidOfPlaylist(player, "p7");
			await expectSettlesAt(
				player,
				() =>
					sorted([
						...coversByPosition(player),
						...coversFromTheComponent(player),
					]),
				sorted([0, 12, 23, 30].map((row) => `${guid}/${row}`)),
			);
		});
	});

	test.describe("on the captured library", () => {
		test.use({ settings: { "jean.artwork": false } });

		test("a shelf asks for the four covers the mosaic picked, and no others", async ({
			page,
			player,
		}) => {
			await openView(page, player, SEVEN_VIEWS[3]);
			await coversShown(page);

			await expectSettlesAt(
				player,
				() => sorted(coversFromTheComponent(player)),
				sorted([
					"A/Alice in Chains/(1994) Jar Of Flies/01. Rotten Apple.flac",
					"B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3",
					"B/Brand New/(2003) Deja Entendu/01. Tautou.mp3",
					"H/Have A Nice Life/(2008) Deathconsciousness/Pt.1 - The Plow That Broke The Plains/01. A Quick One Before The Eternal Worm Devours Connecticut.flac",
				]),
			);
		});
	});
});

test.describe("while the covers arrive", () => {
	test.use({
		libraryShape: TWENTY_ALBUMS,
		embeddedArt: sleevesFor(TWENTY_ALBUMS),
		settings: { "jean.artwork": false },
	});

	test("nothing shows until the last cover has answered, then all nine at once, and the header keeps its height", async ({
		page,
		player,
	}) => {
		const PICKS = 9;
		const held = await holdRequests(page, (request) =>
			new URL(request.url()).pathname.startsWith("/api/artwork"),
		);

		await openView(page, player, ALL_MUSIC);
		await held.untilHeld();
		await expect(backdrop(page)).toBeAttached();
		const before = await boxOf(viewHeader(page));

		// Let go one at a time, so a backdrop that drew each cover as it landed is caught with some
		// showing and some not.
		for (let released = 0; released < PICKS - 1; released += 1) {
			await held.untilHeld(1);
			const answered = page.waitForResponse((response) =>
				new URL(response.url()).pathname.startsWith("/api/artwork"),
			);
			held.release();
			await answered;
			await page.evaluate(
				() =>
					new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(resolve)),
					),
			);

			await expect(backdrop(page)).not.toHaveAttribute("data-ready", "true");
			const reading = await readTheBackdrop(page);
			expect(
				reading.fromTheBackground,
				`${released + 1} of ${PICKS} covers have answered and the backdrop already shows something`,
			).toBeLessThanOrEqual(BACKGROUND_TOLERANCE);
			expect(await standInsIn(page)).toEqual([]);
		}

		held.releaseAll();
		await coversShown(page);
		const shown = await backdrop(page)
			.locator("img")
			.evaluateAll(
				(images) =>
					(images as HTMLImageElement[]).filter(
						(image) => image.complete && image.naturalWidth > 0,
					).length,
			);
		expect(shown).toBe(PICKS);
		expect((await readTheBackdrop(page)).topRight).toBeGreaterThan(COVERS_SHOW);

		const after = await boxOf(viewHeader(page));
		expect(after.height).toBeCloseTo(before.height, 0);
	});
});

test.describe("a header with no covers to draw", () => {
	test("an empty set draws no backdrop and nothing in its place, at the height of a set with covers", async ({
		page,
	}) => {
		await page.goto(`/#/${searchRoute("babasonicos")}`);
		await expect(title(page)).toHaveText("babasonicos");
		await coversShown(page);
		const withCovers = await boxOf(viewHeader(page));

		await page.goto(`/#/${searchRoute("zzzzqqq")}`);
		await expect(title(page)).toHaveText("zzzzqqq");
		await expect(figure(page, "tracks")).toBeVisible();

		await expect(backdrop(page)).toHaveCount(0);
		expect(await standInsIn(page)).toEqual([]);
		expect((await boxOf(viewHeader(page))).height).toBeCloseTo(
			withCovers.height,
			0,
		);
	});

	test.describe("on twenty albums", () => {
		test.use({
			libraryShape: TWENTY_ALBUMS,
			embeddedArt: sleevesFor(TWENTY_ALBUMS),
			settings: { "jean.artwork": false },
		});

		test("a set none of whose covers answers draws no backdrop and nothing in its place, at the height it has with them", async ({
			page,
			player,
		}) => {
			let refused = 0;
			const isCover = (url: URL) => url.pathname.startsWith("/api/artwork");
			const refuse = async (route: Route) => {
				refused += 1;
				await route.abort();
			};
			await page.route(isCover, refuse);

			await openView(page, player, ALL_MUSIC);
			await expect
				.poll(() => refused, {
					message: "the header never asked for its covers",
				})
				.toBeGreaterThanOrEqual(9);
			await expect(figure(page, "tracks")).toBeVisible();

			await expect(backdrop(page)).toHaveCount(0);
			expect(await standInsIn(page)).toEqual([]);
			const without = await boxOf(viewHeader(page));

			await page.unroute(isCover, refuse);
			await page.reload();
			await expect(title(page)).toHaveText(ALL_MUSIC.title);
			await coversShown(page);
			expect((await boxOf(viewHeader(page))).height).toBeCloseTo(
				without.height,
				0,
			);
		});
	});
});

test.describe("the name", () => {
	test("is the page's only h1, at the header's bottom left, under the eyebrow and over the figures", async ({
		page,
		player,
	}) => {
		await openView(page, player, ALL_MUSIC);
		await coversShown(page);
		await expect(page.locator("h1")).toHaveCount(1);

		const header = await boxOf(viewHeader(page));
		const padding = await paddingOf(viewHeader(page));
		const above = await boxOf(eyebrow(page, en["home.yourLibrary"]));
		const name = await boxOf(title(page));
		const figures = await boxOf(figureLine(page));
		const play = await boxOf(
			viewHeader(page).getByRole("button", { name: "Play" }),
		);

		expect(above.bottom).toBeLessThanOrEqual(name.y + 1);
		expect(name.bottom).toBeLessThanOrEqual(figures.y + 1);
		expect(name.x).toBeCloseTo(header.x + padding.left, 0);

		// At the bottom: the room the header has to spare sits above the eyebrow, not under the
		// buttons.
		expect(above.y - header.y).toBeGreaterThan(header.bottom - play.bottom);
	});

	test("wraps a long name rather than cutting it off or pushing the header wider", async ({
		page,
		player,
		isMobile,
	}) => {
		const LONG =
			"Everything ripped from the boxes in the attic, Supercalifragilisticexpialidociousandthensome";
		const playlist = player.playlists.find((entry) => entry.id === "p7");
		if (!playlist) throw new Error("no captured Library playlist");
		playlist.title = LONG;

		await page.goto(`/#/${guidOfPlaylist(player, "p7")}`);
		await expect(title(page)).toHaveText(LONG);

		// Down to half a line: a tight line height lets descenders spill a few pixels past the box,
		// and a clamp hides at least a whole line.
		const fits = await title(page).evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				across: element.scrollWidth <= element.clientWidth,
				down:
					element.scrollHeight <=
					element.clientHeight + Number.parseFloat(style.lineHeight) / 2,
				lines:
					element.getBoundingClientRect().height /
					Number.parseFloat(style.lineHeight),
				clipped: style.textOverflow === "ellipsis",
			};
		});
		expect(fits.across, "the name overflows its box sideways").toBe(true);
		expect(fits.down, "the name is clamped").toBe(true);
		expect(fits.clipped).toBe(false);
		expect(fits.lines).toBeGreaterThan(1.5);

		const header = await boxOf(viewHeader(page));
		expect((await boxOf(title(page))).right).toBeLessThanOrEqual(
			header.right + 1,
		);

		await expectTheBackdropBehindTheHeader(page, isMobile);
	});
});

const figuresInOrder = (page: Page) =>
	figureLine(page)
		.locator("span[data-figure]")
		.evaluateAll((spans) =>
			spans.map((span) => span.getAttribute("data-figure")),
		);

test.describe("the figure line", () => {
	test.describe("on a set with all four figures", () => {
		test.use({
			libraryShape: {
				tracks: 6000,
				albums: 500,
				artists: 300,
				genres: 40,
				seconds: 250,
				years: [1961, 2024],
			},
		});

		test("reads albums, tracks, duration and years under the name, on one line on a desktop and two at most on a phone", async ({
			page,
			player,
			isMobile,
		}) => {
			await openView(page, player, ALL_MUSIC);
			await expect(figure(page, "tracks")).toHaveText("6,000 tracks");

			expect(await figuresInOrder(page)).toEqual([
				"albums",
				"tracks",
				"duration",
				"span",
			]);
			await expect(figure(page, "albums")).toHaveText("500 albums");
			await expect(figure(page, "duration")).toHaveText(/\d/);
			await expect(figure(page, "span")).toContainText("1961");
			await expect(figure(page, "span")).toContainText("2024");

			expect((await boxOf(figureLine(page))).y).toBeGreaterThanOrEqual(
				(await boxOf(title(page))).bottom - 1,
			);

			const lines = await tops(figureLine(page).locator("span[data-figure]"));
			if (isMobile) expect(lines.length).toBeLessThanOrEqual(2);
			else expect(lines).toHaveLength(1);
		});
	});

	test.describe("on one album", () => {
		test.use({ libraryShape: { tracks: 12, albums: 1, years: [1999, 1999] } });

		test("leaves the album count out", async ({ page, player }) => {
			await openView(page, player, ALL_MUSIC);
			await expect(figure(page, "tracks")).toHaveText("12 tracks");

			expect(await figuresInOrder(page)).toEqual([
				"tracks",
				"duration",
				"span",
			]);
			await expect(figure(page, "albums")).toHaveCount(0);
		});
	});

	test.describe("on a set with no years and no durations", () => {
		test.use({
			libraryShape: {
				tracks: 60,
				albums: 6,
				omit: ["%year%", "%length_seconds%"],
			},
		});

		test("leaves the duration and the years out rather than claiming zero", async ({
			page,
			player,
		}) => {
			await openView(page, player, ALL_MUSIC);
			await expect(figure(page, "tracks")).toHaveText("60 tracks");

			expect(await figuresInOrder(page)).toEqual(["albums", "tracks"]);
		});
	});

	// Brand New in two albums and three loose singles: four tracks moved to a second album, three
	// left with no album tag. A missing tag is "?", as foobar2000 answers a field a file lacks. The
	// backdrop may give a loose single a tile of its own; the album count is albums, and a single
	// is not one.
	test.describe("on a set with singles that carry no album tag", () => {
		test.use({
			retagged: {
				"Jaws Theme Swimming": { "%album%": "Your Favorite Weapon" },
				"Me vs. Maradona vs. Elvis": { "%album%": "Your Favorite Weapon" },
				Guernica: { "%album%": "Your Favorite Weapon" },
				"Play Crack the Sky": { "%album%": "Your Favorite Weapon" },
				Tautou: { "%album%": "?" },
				"The Boy Who Blocked His Own Shot": { "%album%": "?" },
				"Good to Know That If I Ever Need Attention All I Have to Do Is Die": {
					"%album%": "?",
				},
			},
		});

		test("the artist's header counts two albums, not one per single", async ({
			page,
			player,
		}) => {
			await openView(page, player, {
				name: "Brand New",
				path: () => artistRoute("Brand New"),
				title: "Brand New",
			});
			await expect(figure(page, "tracks")).toHaveText("11 tracks");

			await expect(figure(page, "albums")).toHaveText("2 albums");
		});

		test("All music counts the six albums, not one per single", async ({
			page,
			player,
		}) => {
			await openView(page, player, ALL_MUSIC);
			await expect(figure(page, "tracks")).toHaveText("54 tracks");

			await expect(figure(page, "albums")).toHaveText("6 albums");
		});
	});
});

const buttonNames = (page: Page) =>
	viewHeader(page)
		.getByRole("button")
		.evaluateAll((buttons) =>
			buttons.map((button) => button.textContent?.trim() ?? ""),
		);

const expectUnderTheFigures = async (page: Page, control: Locator) => {
	const figures = await boxOf(figureLine(page));
	expect((await boxOf(control)).y).toBeGreaterThanOrEqual(figures.bottom - 1);
};

test.describe("the actions", () => {
	for (const { view, further, fooJean } of [
		{ view: ALL_MUSIC, further: null, fooJean: {} },
		{
			view: SEVEN_VIEWS[6],
			further: en["search.saveAsPlaylist"],
			fooJean: {},
		},
		// An install that can make autoplaylists, which is what draws the genre's own action.
		{
			view: SEVEN_VIEWS[2],
			further: en["genre.createAutoPlaylist"],
			fooJean: { maxAutoPlaylists: 100 },
		},
		{ view: THE_PLAYLIST, further: en["playlist.sort"], fooJean: {} },
	])
		test.describe(`on ${view.name}`, () => {
			test.use({ fooJean });

			test(`draws Play, Shuffle${further ? ` and ${further}` : ""} under the figures, anything past the pair a full line on a phone`, async ({
				page,
				player,
				isMobile,
			}) => {
				await openView(page, player, view);
				await expect(figure(page, "tracks")).toBeVisible();

				const expected = ["Play", "Shuffle", ...(further ? [further] : [])];
				await expect.poll(() => buttonNames(page)).toEqual(expected);
				for (const label of expected)
					await expectUnderTheFigures(
						page,
						viewHeader(page).getByRole("button", { name: label, exact: true }),
					);

				if (further && isMobile) {
					const header = await boxOf(viewHeader(page));
					const padding = await paddingOf(viewHeader(page));
					const third = await boxOf(
						viewHeader(page).getByRole("button", {
							name: further,
							exact: true,
						}),
					);
					expect(third.width).toBeCloseTo(
						header.width - padding.left - padding.right,
						0,
					);
				}
			});
		});

	test.describe("with playback control off at the player", () => {
		test.use({ fooJean: { canControlPlayback: false } });

		test("Play and Shuffle stay under the figures, disabled with the reason", async ({
			page,
			player,
		}) => {
			await openView(page, player, ALL_MUSIC);
			await expect(figure(page, "tracks")).toBeVisible();

			const play = viewHeader(page).getByRole("button", { name: /^Play\b/ });
			const shuffle = viewHeader(page).getByRole("button", {
				name: /^Shuffle\b/,
			});
			await expectDisabledWithReason(play);
			await expectDisabledWithReason(shuffle);
			await expectUnderTheFigures(page, play);
			await expectUnderTheFigures(page, shuffle);
		});
	});

	test.describe("on a player that offers no shuffling order", () => {
		test.use({ playerState: OFFERS_NO_SHUFFLE });

		test("Shuffle stays under the figures, disabled", async ({
			page,
			player,
		}) => {
			await openView(page, player, ALL_MUSIC);
			await expect(figure(page, "tracks")).toBeVisible();

			const shuffle = viewHeader(page).getByRole("button", {
				name: "Shuffle",
				exact: true,
			});
			await expect(shuffle).toBeDisabled();
			await expectUnderTheFigures(page, shuffle);
		});
	});
});

const AA = 4.5;

for (const theme of ["light", "dark"] as const)
	test.describe(`what the header says, in the ${theme} theme`, () => {
		test.use({ settings: { "jean.theme": theme } });

		for (const { view, eyebrowPhrase } of [
			{ view: ALL_MUSIC, eyebrowPhrase: en["home.yourLibrary"] },
			{ view: THE_PLAYLIST, eyebrowPhrase: en["playlist.eyebrow"] },
		])
			test(`${view.name}'s eyebrow, name and figures read at 4.5:1 or better over the covers`, async ({
				page,
				player,
			}) => {
				await openView(page, player, view);
				await coversShown(page);
				await expect(figure(page, "tracks")).toBeVisible();

				const measured: [string, Locator][] = [
					["the eyebrow", eyebrow(page, eyebrowPhrase)],
					["the name", title(page)],
					...(await figureLine(page).locator("span[data-figure]").all()).map(
						(span, at) => [`figure ${at + 1}`, span] as [string, Locator],
					),
				];

				for (const [what, target] of measured) {
					const ratio = await worstContrastBehind(page, target);
					expect(
						ratio,
						`${what} reads at ${ratio.toFixed(2)}:1`,
					).toBeGreaterThanOrEqual(AA);
				}
			});
	});

test.describe("the backdrop and a screen reader", () => {
	test("is hidden: no image of it is in the accessibility tree, and the header reads as words and buttons", async ({
		page,
		player,
	}) => {
		await openView(page, player, ALL_MUSIC);
		await coversShown(page);

		await expect(backdrop(page)).toHaveAttribute("aria-hidden", "true");
		const alts = await backdrop(page)
			.locator("img")
			.evaluateAll((images) =>
				images.map((image) => image.getAttribute("alt")),
			);
		expect(alts.length).toBeGreaterThan(0);
		expect(alts.every((alt) => alt === "")).toBe(true);

		const fromTheBackdrop = await viewHeader(page)
			.getByRole("img")
			.evaluateAll(
				(images) =>
					images.filter((image) => image.closest("[data-backdrop]")).length,
			);
		expect(fromTheBackdrop).toBe(0);

		const tree = await viewHeader(page).ariaSnapshot();
		const roles = [...tree.matchAll(/^\s*- (\w+)/gm)].map((match) => match[1]);
		expect(roles).not.toContain("img");
		expect(roles).toContain("heading");
		expect(roles).toContain("button");
		expect(tree).toContain(en["home.yourLibrary"]);
	});
});

test.describe("scrolling the list", () => {
	for (const view of [ALL_MUSIC, THE_PLAYLIST])
		test(`${view.name}'s header, backdrop and all, scrolls away with the list`, async ({
			page,
			player,
		}) => {
			await openView(page, player, view);
			await coversShown(page);
			const header = await boxOf(viewHeader(page));

			await scrollTo(page, header.height + 400);
			await expect
				.poll(() => scrollTop(page))
				.toBeGreaterThan(header.height + 100);

			const main = await boxOf(page.locator("main"));
			expect((await boxOf(viewHeader(page))).bottom).toBeLessThanOrEqual(
				main.y,
			);
			expect((await boxOf(backdrop(page))).bottom).toBeLessThanOrEqual(main.y);
		});
});

test.describe("at 320px", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the narrowest phone is the case at stake",
	);

	for (const view of [ALL_MUSIC, THE_ARTIST])
		test(`${view.name}'s backdrop pushes neither the page nor the list sideways`, async ({
			page,
			player,
		}) => {
			await page.setViewportSize({ width: 320, height: 640 });
			await openView(page, player, view);
			await coversShown(page);

			// What the header adds to `main`'s sideways overflow, measured against the same page with
			// the header taken out. All music's toolbar overflows `main` at 320px on its own, which is
			// not this criterion's to hold.
			const overflow = await page.evaluate(() => {
				const root = document.documentElement;
				const main = document.querySelector("main") as HTMLElement;
				const header = main.querySelector("header") as HTMLElement;
				const withHeader = main.scrollWidth - main.clientWidth;
				header.style.setProperty("display", "none");
				const withoutHeader = main.scrollWidth - main.clientWidth;
				header.style.removeProperty("display");
				return {
					page: root.scrollWidth - root.clientWidth,
					addedByTheHeader: withHeader - withoutHeader,
				};
			});
			expect(overflow).toEqual({ page: 0, addedByTheHeader: 0 });
		});
});

const FRAMES_SAMPLED = 12;

const recordTheReveal = (page: Page) =>
	page.addInitScript((count: number) => {
		const samples: number[] = [];
		Reflect.set(window, "__reveal", samples);

		const shown = (layer: Element) => {
			const images = [...layer.querySelectorAll("img")];
			if (images.length === 0) return -1;
			return Math.min(
				...images.map((image) => {
					let opacity = 1;
					for (
						let at: Element | null = image;
						at && at !== layer.parentElement;
						at = at.parentElement
					)
						opacity *= Number(getComputedStyle(at).opacity);
					return opacity;
				}),
			);
		};

		let seen = false;
		new MutationObserver(() => {
			if (seen) return;
			const layer = document.querySelector(
				'main header [data-backdrop][data-ready="true"]',
			);
			if (!layer) return;
			seen = true;
			Reflect.set(window, "__shownNow", () => shown(layer));
			const next = () => {
				samples.push(shown(layer));
				if (samples.length < count) requestAnimationFrame(next);
			};
			requestAnimationFrame(next);
		}).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-ready"],
		});
	}, FRAMES_SAMPLED);

test.describe("with reduced motion", () => {
	test("the covers go from nothing to full strength between two frames, with no fade in between", async ({
		page,
		player,
	}) => {
		await recordTheReveal(page);
		await openView(page, player, ALL_MUSIC);
		await coversShown(page);

		const read = () =>
			page.evaluate(() => [...(Reflect.get(window, "__reveal") as number[])]);
		await expect.poll(async () => (await read()).length).toBe(FRAMES_SAMPLED);

		// Where the covers come to rest, read once two readings a poll apart agree. Read from the
		// frames alone, a slow fade would agree with itself.
		const now = () =>
			page.evaluate(() =>
				(Reflect.get(window, "__shownNow") as () => number)(),
			);
		let previous = -1;
		await expect
			.poll(
				async () => {
					const reading = await now();
					const still = reading === previous;
					previous = reading;
					return still;
				},
				{ intervals: [250] },
			)
			.toBe(true);
		const settled = await now();
		expect(settled, "the covers never showed").toBeGreaterThan(0);

		// The reduced-motion reset still lets a transition start, so the first frame or two can read
		// nothing; what it never shows is a value on the way. Each frame is either nothing or the
		// covers at rest, and the last is the covers at rest.
		const hundredths = (value: number) => Math.round(value * 100) / 100;
		const frames = (await read()).map(hundredths);
		const atRest = hundredths(settled);
		expect(
			frames.map((frame) =>
				frame === 0 || frame === atRest ? frame : `${frame} on the way`,
			),
		).toEqual(frames.map((frame) => (frame === 0 ? 0 : atRest)));
		expect(frames.at(-1)).toBe(atRest);
	});
});

test.describe("with more contrast asked for", () => {
	test("the header drops its backdrop", async ({ page, player }) => {
		await openView(page, player, ALL_MUSIC);
		await coversShown(page);
		await expect(backdrop(page)).toBeVisible();

		await page.emulateMedia({ contrast: "more" });

		await expect(backdrop(page)).toBeHidden();
		await expect(viewHeader(page).locator("img:visible")).toHaveCount(0);
	});
});

test.describe("the header's height", () => {
	for (const view of [ALL_MUSIC, THE_ARTIST])
		test(`${view.name}'s header is at least 320px tall on a desktop and 260px on a phone`, async ({
			page,
			player,
			isMobile,
		}) => {
			await openView(page, player, view);
			await coversShown(page);

			expect((await boxOf(viewHeader(page))).height).toBeGreaterThanOrEqual(
				floorFor(isMobile),
			);
		});
});

test.describe("on a phone", () => {
	test.skip(
		({ isMobile }) => !isMobile,
		"the phone's own layout is the case at stake",
	);

	for (const { view, eyebrowPhrase } of [
		{ view: ALL_MUSIC, eyebrowPhrase: en["home.yourLibrary"] },
		{ view: THE_ARTIST, eyebrowPhrase: en["artist.eyebrow"] },
	])
		test(`${view.name}'s eyebrow, name and figures start at the header's left padding`, async ({
			page,
			player,
		}) => {
			await openView(page, player, view);
			await expect(figure(page, "tracks")).toBeVisible();

			const header = await boxOf(viewHeader(page));
			const padding = await paddingOf(viewHeader(page));
			const edge = header.x + padding.left;

			expect((await boxOf(eyebrow(page, eyebrowPhrase))).x).toBeCloseTo(
				edge,
				0,
			);
			expect((await boxOf(title(page))).x).toBeCloseTo(edge, 0);
			expect((await boxOf(figureLine(page))).x).toBeCloseTo(edge, 0);
		});
});

test.describe("what the header no longer carries", () => {
	for (const view of [ALL_MUSIC, THE_ARTIST])
		test(`${view.name} draws no played meter and no genre`, async ({
			page,
			player,
		}) => {
			await openView(page, player, view);
			await expect(figure(page, "tracks")).toBeVisible();

			await expect(viewHeader(page).getByText(/% played/)).toHaveCount(0);
			await expect(viewHeader(page).locator('a[href^="#/genre/"]')).toHaveCount(
				0,
			);
		});
});

const SUBPIXEL_SLACK = 1;

const bottomRuleOf = (locator: Locator) =>
	locator.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			width: Number.parseFloat(style.borderBottomWidth),
			style: style.borderBottomStyle,
			bottom: element.getBoundingClientRect().bottom,
		};
	});

const toolbarTop = (page: Page) =>
	page.getByRole("group", { name: "Track layout" }).evaluate((toggle) => {
		let bar: HTMLElement | null = toggle.parentElement;
		while (bar && getComputedStyle(bar).position !== "sticky")
			bar = bar.parentElement;
		if (!bar) throw new Error("the layout toggle is in no sticky bar");
		return bar.getBoundingClientRect().top;
	});

const THE_TRACKS_TAB: View = {
	name: "the artist's Tracks tab",
	path: () => artistRoute("Babasónicos", "tracks"),
	title: "Babasónicos",
};

test.describe("the header's bottom edge", () => {
	for (const view of [ALL_MUSIC, THE_PLAYLIST, THE_TRACKS_TAB])
		test(`on ${view.name}, the list's toolbar follows the header's rule directly`, async ({
			page,
			player,
		}) => {
			await openView(page, player, view);
			await expect(figure(page, "tracks")).toBeVisible();

			const header = await bottomRuleOf(viewHeader(page));
			const tabs = viewHeader(page).getByRole("navigation");
			const edge = (await tabs.count()) > 0 ? await bottomRuleOf(tabs) : header;
			expect(edge.style).toBe("solid");
			expect(edge.width).toBeGreaterThanOrEqual(1);
			expect(
				Math.abs((await toolbarTop(page)) - header.bottom),
			).toBeLessThanOrEqual(SUBPIXEL_SLACK);
		});

	test("on the artist page, the tab strip is the header's one rule", async ({
		page,
		player,
	}) => {
		await openView(page, player, THE_ARTIST);
		await expect(figure(page, "tracks")).toBeVisible();

		const header = await bottomRuleOf(viewHeader(page));
		const tabs = await bottomRuleOf(viewHeader(page).getByRole("navigation"));
		expect(header.width).toBe(0);
		expect(tabs.style).toBe("solid");
		expect(tabs.width).toBeGreaterThanOrEqual(1);
		expect(Math.abs(tabs.bottom - header.bottom)).toBeLessThanOrEqual(
			SUBPIXEL_SLACK,
		);
	});
});

// A removal shrinks the rows at once, and the playlist's own item count moves only when the
// playlist list is read again. A figure line that waits for the two to agree goes blank on every
// removal, for as long as that read takes.
const recordBlanking = (page: Page) =>
	page.evaluate(() => {
		const seen = { figureLost: false };
		Reflect.set(window, "__blanking", seen);
		const look = () => {
			if (
				!document.querySelector(
					'main header p[data-figures] span[data-figure="tracks"]',
				)
			)
				seen.figureLost = true;
		};
		new MutationObserver(look).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		});
		look();
	});

const figureLost = (page: Page) =>
	page.evaluate(
		() =>
			(Reflect.get(window, "__blanking") as { figureLost: boolean }).figureLost,
	);

test.describe("the figure line through a playlist removal", () => {
	test("keeps its figures through the removal, and counts one track fewer once it lands", async ({
		page,
		player,
		isMobile,
	}) => {
		const key = "p5";
		const before = titlesIn(player, key).map(String);
		await page.goto(`/#/${guidOfPlaylist(player, key)}`);
		await expect(trackRow(page, 0)).toBeAttached();
		await expect(figure(page, "tracks")).toHaveText(`${before.length} tracks`);

		const list = await holdRequests(
			page,
			(request) =>
				request.method() === "GET" &&
				new URL(request.url()).pathname === "/api/playlists",
		);
		await openRowMenu(page, isMobile, 1, "Add to queue");
		await recordBlanking(page);
		await page.getByRole("menuitem", { name: "Remove from playlist" }).click();

		await expectSettlesAt(
			player,
			() => titlesIn(player, key).map(String),
			before.filter((_, at) => at !== 1),
		);
		const after = before.length - 1;
		await expect(figure(page, "tracks")).toHaveText(`${after} tracks`);
		await list.untilHeld();
		await expect(figure(page, "tracks")).toHaveText(`${after} tracks`);
		expect(await figureLost(page), "while the playlist list was held").toBe(
			false,
		);
		list.releaseAll();
		await untilQuiet(player);
		await expect(figure(page, "tracks")).toHaveText(`${after} tracks`);
		expect(await figureLost(page), "once the playlist list had answered").toBe(
			false,
		);
	});
});

test.describe("while the figures are being counted", () => {
	test("the figure line holds its place with a skeleton, and says Loading once when the count is overdue", async ({
		page,
		player,
	}) => {
		const question = await holdRequests(
			page,
			(request) => new URL(request.url()).pathname === "/api/library/genre",
		);
		const genre = SEVEN_VIEWS[2];
		await page.goto(`/#/${genre.path(player)}`);
		await expect(title(page)).toHaveText(genre.title);
		await question.untilHeld();

		const line = figureLine(page);
		await expect(line).toBeVisible();
		await expect(
			page.locator(
				'main header p[data-figures][aria-busy="true"], main header p[data-figures] [aria-busy="true"]',
			),
		).toHaveCount(1);
		const skeletons = await line.evaluate(
			(element) =>
				[...element.querySelectorAll('[aria-hidden="true"]')].filter(
					(bar) =>
						bar.tagName.toLowerCase() !== "svg" &&
						bar.getBoundingClientRect().width > 0,
				).length,
		);
		expect(skeletons).toBeGreaterThan(0);
		const saidLoading = (text: string | null) =>
			(text ?? "").split(en["skeleton.loading"]).length - 1;
		expect(saidLoading(await line.textContent())).toBe(1);
		// The line's own height, rather than where the buttons sit: the header stacks from the bottom,
		// so a line that shrank while counting would move the name and leave the buttons where they are.
		const whileCounting = await boxOf(line);

		question.releaseAll();
		await expect(figure(page, "tracks")).toHaveText("12 tracks");
		expect(saidLoading(await line.textContent())).toBe(0);
		await expect(
			page.locator('main header p[data-figures] [aria-busy="true"]'),
		).toHaveCount(0);
		await expect(line).not.toHaveAttribute("aria-busy", "true");

		const counted = await boxOf(line);
		expect(
			Math.abs(counted.height - whileCounting.height),
			`the figure line was ${whileCounting.height}px tall while counting and ${counted.height}px after`,
		).toBeLessThanOrEqual(2);
	});
});

const headerCover = (page: Page) =>
	viewHeader(page).locator("[data-header-cover]");

const sharpCover = (page: Page) => headerCover(page).locator("[data-artwork]");

const coverName = (album: string) =>
	en["album.coverAlt"].replace("{album}", album);

const THE_ALBUM = SEVEN_VIEWS[1];

const LAFCADIO: View = {
	name: "a light-sleeved album",
	path: () => albumRoute("As Tall as Lions", "Lafcadio"),
	title: "Lafcadio",
};

const COVER_PX = { desktop: 176, phone: 92 };

test.describe("the album page", () => {
	test("draws the album's own cover in its header, and no other view does", async ({
		page,
		player,
	}) => {
		await openView(page, player, THE_ALBUM);
		await expect(sharpCover(page)).toBeVisible();
		await expect(sharpCover(page)).toHaveAttribute("data-artwork", "ok");

		for (const view of SEVEN_VIEWS.filter((other) => other !== THE_ALBUM)) {
			await openView(page, player, view);
			await expect(figure(page, "tracks")).toBeVisible();
			await expect(
				headerCover(page),
				`${view.name} draws the album page's cover`,
			).toHaveCount(0);
		}
	});

	test("draws the cover 176px square on a desktop and 92px on a phone", async ({
		page,
		player,
		isMobile,
	}) => {
		await openView(page, player, THE_ALBUM);
		await expect(sharpCover(page)).toHaveAttribute("data-artwork", "ok");

		const side = isMobile ? COVER_PX.phone : COVER_PX.desktop;
		const cover = await boxOf(sharpCover(page));
		expect(cover.width).toBeCloseTo(side, 0);
		expect(cover.height).toBeCloseTo(side, 0);
	});

	test("puts the cover left of the name on a desktop and above it on a phone, on the name's left edge", async ({
		page,
		player,
		isMobile,
	}) => {
		await openView(page, player, THE_ALBUM);
		await expect(sharpCover(page)).toHaveAttribute("data-artwork", "ok");

		const cover = await boxOf(sharpCover(page));
		const name = await boxOf(title(page));
		if (isMobile) {
			expect(cover.bottom).toBeLessThanOrEqual(name.y + 1);
			expect(cover.x).toBeCloseTo(name.x, 0);
		} else {
			expect(cover.right).toBeLessThanOrEqual(name.x + 1);
			expect(cover.y, "the cover sits wholly below the name").toBeLessThan(
				name.bottom,
			);
			expect(
				cover.bottom,
				"the cover sits wholly above the name",
			).toBeGreaterThan(name.y);
		}
	});

	test("names the cover for a screen reader, and keeps the backdrop's copy of it hidden", async ({
		page,
		player,
	}) => {
		await openView(page, player, THE_ALBUM);
		await coversShown(page);
		await expect(sharpCover(page)).toHaveAttribute("data-artwork", "ok");

		await expect(
			viewHeader(page).getByRole("img", { name: coverName(THE_ALBUM.title) }),
		).toBeVisible();
		const named = await viewHeader(page)
			.getByRole("img")
			.evaluateAll((images) =>
				images.map((image) => ({
					alt: image.getAttribute("alt"),
					inTheBackdrop: image.closest("[data-backdrop]") !== null,
				})),
			);
		expect(named).toEqual([
			{ alt: coverName(THE_ALBUM.title), inTheBackdrop: false },
		]);
	});

	test("draws the same cover blurred behind it, as the backdrop's one pick", async ({
		page,
		player,
	}) => {
		await openView(page, player, THE_ALBUM);
		await expect(sharpCover(page)).toHaveAttribute("data-artwork", "ok");
		await coversShown(page);

		await expect(backdrop(page).locator("[data-artwork]")).toHaveCount(1);
	});

	for (const theme of ["light", "dark"] as const)
		test.describe(`in the ${theme} theme`, () => {
			test.use({ settings: { "jean.theme": theme } });

			for (const view of [THE_ALBUM, LAFCADIO])
				test(`${view.name}'s eyebrow, name and figures read at 4.5:1 or better beside its cover`, async ({
					page,
					player,
				}) => {
					await openView(page, player, view);
					await expect(sharpCover(page)).toHaveAttribute("data-artwork", "ok");
					await coversShown(page);
					await expect(figure(page, "tracks")).toBeVisible();

					const measured: [string, Locator][] = [
						[
							"the eyebrow",
							viewHeader(page).locator('a[href^="#/artist/"]').first(),
						],
						["the name", title(page)],
						...(await figureLine(page).locator("span[data-figure]").all()).map(
							(span, at) => [`figure ${at + 1}`, span] as [string, Locator],
						),
					];

					for (const [what, target] of measured) {
						const ratio = await worstContrastBehind(page, target);
						expect(
							ratio,
							`${what} reads at ${ratio.toFixed(2)}:1`,
						).toBeGreaterThanOrEqual(AA);
					}
				});
		});
});
