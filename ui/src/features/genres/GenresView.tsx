import { ArrowDownAZ, ArrowDownWideNarrow } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { genreRoute } from "@/domain/library/genreRoute";
import { libraryNoticeFor } from "@/domain/library/LibraryNotice";
import {
	isLibraryReading,
	readingNotice,
} from "@/domain/library/libraryStatus";
import type { Library } from "@/domain/library/useLibrary";
import { genresOf } from "@/domain/track/genres";
import { trackRows } from "@/domain/track/project";
import { useStoredState } from "@/shared/hooks/useStoredState";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { completionFor, fuzzyScore, squash } from "@/shared/lib/text";
import type { IconComponent } from "@/shared/ui/icons";
import { Segmented } from "@/shared/ui/Segmented";
import { GenreFinder } from "./GenreFinder";
import styles from "./GenresView.module.css";
import { GenreTile } from "./GenreTile";

type Order = "largest" | "name";

const ORDERS = [
	{
		value: "largest" as const,
		label: "genre.largest",
		icon: ArrowDownWideNarrow,
	},
	{ value: "name" as const, label: "genre.alphabetical", icon: ArrowDownAZ },
] as const satisfies readonly {
	value: Order;
	label: Phrase;
	icon: IconComponent;
}[];

export function GenresView({
	library,
	onOpenRoute,
}: {
	library: Library;
	onOpenRoute: (route: string) => void;
}) {
	const t = useTranslate();
	const [query, setQuery] = useState("");
	const [order, setOrder] = useStoredState<Order>("jean.genreOrder", "largest");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const gridRef = useRef<HTMLDivElement | null>(null);

	const { snapshot } = library;
	const rows = useMemo(() => trackRows(snapshot.columns), [snapshot.columns]);
	const genres = useMemo(() => genresOf(rows), [rows]);

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
		event.stopPropagation();
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

	const orders = useMemo(
		() => ORDERS.map((option) => ({ ...option, label: t(option.label) })),
		[t],
	);

	const trackCount = useMemo(
		() => genres.reduce((total, genre) => total + genre.trackCount, 0),
		[genres],
	);

	const notice = libraryNoticeFor(library);
	if (notice) return notice;

	const { status } = library;
	const isReading = isLibraryReading(status);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: type-to-find focuses the field
		<div className={styles.view} onKeyDown={onPageKeyDown}>
			<header className={styles.header}>
				<p className={styles.eyebrow}>{t("home.yourLibrary")}</p>
				<h1 className={styles.title}>{t("home.genres")}</h1>
				{genres.length > 0 ? (
					<p className={styles.summary}>
						{t("genre.summary", {
							genres: t("genre.count", { count: genres.length }),
							tracks: t("view.trackCount", {
								count: trackCount,
								total: trackCount,
							}),
						})}
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
								{t("genre.sortBy")}
							</p>
							<Segmented
								value={order}
								onChange={setOrder}
								options={orders}
								label={t("genre.order")}
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
					{isReading
						? readingNotice(status, "library.reading", t)
						: genres.length === 0
							? t("genre.noTags")
							: t("genre.noMatch", { query })}
				</p>
			)}
		</div>
	);
}
