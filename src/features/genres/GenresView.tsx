import { ArrowDownAZ, ArrowDownWideNarrow } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { genreRoute } from "@/domain/library/genreRoute";
import type { Library } from "@/domain/library/useLibrary";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { fuzzyScore, plural, squash } from "@/shared/lib/text";
import { Segmented } from "@/shared/ui/Segmented";
import { completionFor, GenreFinder } from "./GenreFinder";
import styles from "./GenresView.module.css";
import { GenreTile } from "./GenreTile";
import { genresOf } from "./genres";

type Order = "largest" | "name";

const ORDERS = [
	{ value: "largest" as const, label: "Largest", icon: ArrowDownWideNarrow },
	{ value: "name" as const, label: "A–Z", icon: ArrowDownAZ },
];

// Every genre in the library, as somewhere to go. The home screen's bars are a distribution and stop
// at fourteen; this is the index, and it is the only place the whole list exists.
// Rejected on the way here: a wall of pills (nothing to aim at once there are more than twenty), the
// bars again at full length (a chart is for comparing, not for finding), and a per-genre icon set
// (hundreds of drawings for tags Jean cannot predict).
export function GenresView({
	library,
	onOpenRoute,
}: {
	library: Library;
	onOpenRoute: (route: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [order, setOrder] = useStoredState<Order>("jean.genreOrder", "largest");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const gridRef = useRef<HTMLDivElement | null>(null);

	// The store's own object, not `library`: that is a new identity every render and this pass walks
	// every row in the library.
	const { snapshot } = library;
	const genres = useMemo(() => genresOf(snapshot.rows), [snapshot.rows]);

	const shown = useMemo(() => {
		// Squashed once here rather than once per candidate, which is the whole reason `fuzzyScore`
		// takes a prepared query.
		const wanted = squash(query);
		const scored = genres
			.map((genre) => ({
				genre,
				score: wanted ? fuzzyScore(genre.match, wanted) : 1,
			}))
			.filter((entry) => entry.score > 0);

		// A query ranks by how well it answered; without one the chosen order stands. `genresOf`
		// already sorted by size, so only the alphabetical case has anything to do.
		if (wanted)
			scored.sort(
				(a, b) => b.score - a.score || b.genre.trackCount - a.genre.trackCount,
			);
		else if (order === "name")
			scored.sort((a, b) => a.genre.key.localeCompare(b.genre.key));

		return scored.map((entry) => entry.genre);
	}, [genres, query, order]);

	const best = shown[0] ?? null;
	const completion = completionFor(query, best?.name ?? null);

	// Arrows walk the grid rather than the DOM, so Tab is not the only way through a hundred and forty
	// tiles. The column count is read off the grid itself: it is a `repeat(auto-fill)`, so nothing in
	// JavaScript knows it until the browser has laid it out.
	const onGridKeyDown = (event: ReactKeyboardEvent) => {
		const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
		const grid = gridRef.current;
		if (!grid) return;

		const tiles = [...grid.querySelectorAll<HTMLElement>("[data-genre-tile]")];
		const at = tiles.indexOf(document.activeElement as HTMLElement);
		if (at < 0) return;

		const columns = getComputedStyle(grid)
			.gridTemplateColumns.split(" ")
			.filter(Boolean).length;

		// A tile is an anchor, and a browser activates one with Enter alone. Space is what a hand
		// reaches for anyway, and without this it fell through to the page's type-to-find and put the
		// caret in the field instead.
		if (event.key === " ") {
			event.preventDefault();
			// Stopped as well as prevented: Space is the player's own play/pause, and a tile that opened
			// a genre *and* paused the music would be doing two things with one key. Play/pause still
			// works everywhere else on this page -- the suppression is the focused tile's, not the
			// screen's, and a text field is already covered by the keymap's `ignoreInputs`.
			event.stopPropagation();
			tiles[at].click();
			return;
		}

		const step =
			steps[event.key] ??
			(event.key === "ArrowDown"
				? columns
				: event.key === "ArrowUp"
					? -columns
					: 0);
		if (step === 0) return;

		event.preventDefault();
		tiles[Math.min(Math.max(at + step, 0), tiles.length - 1)]?.focus();
	};

	// Typing anywhere on the page lands in the field, which is what makes this page keyboard-first
	// without autofocusing it -- autofocus on a phone opens the keyboard over the thing you came to look at.
	const onPageKeyDown = useCallback((event: ReactKeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		// Space belongs to whatever has focus -- it opens a tile, and no genre is found by typing one.
		if (event.key.length !== 1 || event.key === " ") return;
		if (document.activeElement === inputRef.current) return;
		inputRef.current?.focus();
	}, []);

	// `/` is "find in what I am looking at" everywhere in Jean, and this page is a thing to find in.
	// `S` switches the order rather than setting one, because there are two.
	useKeymap(SCOPE.genres, {
		findGenre: (event) => {
			event.preventDefault();
			inputRef.current?.focus();
			inputRef.current?.select();
		},
		switchGenreOrder: () =>
			setOrder((current) => (current === "largest" ? "name" : "largest")),
	});

	const openBest = () => {
		if (best) onOpenRoute(genreRoute(best.name));
	};

	const trackCount = useMemo(
		() => genres.reduce((total, genre) => total + genre.trackCount, 0),
		[genres],
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: type-to-find, see above
		<div className={styles.view} onKeyDown={onPageKeyDown}>
			<header className={styles.header}>
				<p className={styles.eyebrow}>Your library</p>
				<h1 className={styles.title}>Genres</h1>
				{genres.length > 0 ? (
					<p className={styles.summary}>
						{plural(genres.length, "genre")} across{" "}
						{plural(trackCount, "track")}
					</p>
				) : null}
			</header>

			{genres.length > 0 ? (
				<div className={styles.controls}>
					<GenreFinder
						query={query}
						onChange={setQuery}
						completion={completion}
						matchCount={shown.length}
						onAccept={() => best && setQuery(best.name)}
						onOpen={openBest}
						inputRef={inputRef}
					/>

					{/* Only where there is a list long enough for the order to matter. The label is not
					    decoration: it gives this block the field's height, so the two sit on one baseline
					    rather than the control floating half way up the field beside it. */}
					{genres.length > 1 && !query ? (
						<div className={styles.sort}>
							<p className={styles.sortLabel} id="genre-order">
								Sort by
							</p>
							<Segmented
								value={order}
								onChange={setOrder}
								options={ORDERS}
								label="Order genres"
							/>
						</div>
					) : null}
				</div>
			) : null}

			{shown.length > 0 ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: roving arrows over links, see above
				<div className={styles.grid} ref={gridRef} onKeyDown={onGridKeyDown}>
					{shown.map((genre) => (
						<GenreTile key={genre.key} genre={genre} source={library.source} />
					))}
				</div>
			) : (
				<p className={styles.notice}>
					{library.isLoading
						? "Reading your library..."
						: genres.length === 0
							? "Nothing in your library carries a genre tag."
							: `No genre here answers to "${query}".`}
				</p>
			)}
		</div>
	);
}
