import { ArrowDownAZ, ArrowDownWideNarrow } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { genreRoute } from "@/domain/library/genreRoute";
import type { Library } from "@/domain/library/useLibrary";
import { genresOf } from "@/domain/track/genres";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { completionFor, fuzzyScore, plural, squash } from "@/shared/lib/text";
import { Segmented } from "@/shared/ui/Segmented";
import { GenreFinder } from "./GenreFinder";
import styles from "./GenresView.module.css";
import { GenreTile } from "./GenreTile";

type Order = "largest" | "name";

const ORDERS = [
	{ value: "largest" as const, label: "Largest", icon: ArrowDownWideNarrow },
	{ value: "name" as const, label: "A–Z", icon: ArrowDownAZ },
];

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

	const { snapshot } = library;
	const genres = useMemo(() => genresOf(snapshot.rows), [snapshot.rows]);

	const shown = useMemo(() => {
		const wanted = squash(query);
		const scored = genres
			.map((genre) => ({
				genre,
				score: wanted ? fuzzyScore(genre.match, wanted) : 1,
			}))
			.filter((entry) => entry.score > 0);

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

		// A tile is an anchor, and a browser activates one with Enter alone. Space is stopped as well as
		// prevented, since it is the player's play/pause everywhere else on the page.
		if (event.key === " ") {
			event.preventDefault();
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

	const onPageKeyDown = useCallback((event: ReactKeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key.length !== 1 || event.key === " ") return;
		if (document.activeElement === inputRef.current) return;
		inputRef.current?.focus();
	}, []);

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
		// biome-ignore lint/a11y/noStaticElementInteractions: type-to-find focuses the field
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
				// biome-ignore lint/a11y/noStaticElementInteractions: roving arrows over links
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
