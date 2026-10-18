import { Shapes } from "lucide-react";
import {
	Fragment,
	type MouseEvent,
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { QuestionFailure } from "@/domain/library/QuestionFailure";
import type { Library } from "@/domain/library/useLibrary";
import type {
	LibrarySearch,
	SearchSectionLabel,
	Suggestion,
} from "@/domain/library/useLibrarySearch";
import {
	artistOf,
	coverIdentity,
	coverKey,
	FIELD,
	titleOf,
	value,
} from "@/domain/track/fields";
import { rowAt } from "@/domain/track/libraryColumns";
import { trackRows } from "@/domain/track/project";
import { useTrackContextMenu } from "@/domain/track/useTrackContextMenu";
import { libraryArtworkUrl } from "@/shared/api/artwork";
import { useEarnedHover } from "@/shared/hooks/useEarnedHover";
import { useSwipe } from "@/shared/hooks/useSwipe";
import {
	type Translate,
	useFormats,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { BusyNote, busyProps } from "@/shared/ui/Skeleton";
import styles from "./SearchDropdown.module.css";

export const optionId = (position: number) => `search-result-${position}`;

const ART = 36;

const NO_SELECTION = new Set<number>();

function Heading({
	label,
	count,
}: {
	label: SearchSectionLabel;
	count: number;
}) {
	const t = useTranslate();
	const format = useFormats();

	return (
		<p className={styles.heading}>
			{/* biome-ignore-start lint/style/noJsxLiterals: whether parentheses round a count are a phrase is the owner's decision */}
			{t(label)} <span className={styles.count}>({format.number(count)})</span>
			{/* biome-ignore-end lint/style/noJsxLiterals: whether parentheses round a count are a phrase is the owner's decision */}
		</p>
	);
}

const joined = (...parts: (string | null | false)[]) =>
	parts.filter(Boolean).join(" · ");

/**
 * The kinds differ by what leads the row and by what the second line answers, and by nothing else.
 *
 * Every cover is asked for by identity as well as by address: the album a query names and a track on
 * it are two rows in one panel pointing at one sleeve.
 */
function faceOf(
	suggestion: Suggestion,
	library: Library,
	t: Translate,
): { key: string; leading: ReactNode; title: string; under: string } {
	const coverAt = (path: string | null) =>
		path === null ? null : libraryArtworkUrl(library.origin, path);
	const cover = (ref: number, className: string) => (
		<Artwork
			src={library.source.artworkUrl(ref)}
			identity={coverIdentity(rowAt(library.columns, ref))}
			size={ART}
			className={className}
		/>
	);

	switch (suggestion.kind) {
		case "artist": {
			const { artist } = suggestion;
			return {
				key: `artist:${artist.name}`,
				leading: (
					<Artwork
						src={coverAt(artist.cover)}
						size={ART}
						className={styles.face}
					/>
				),
				title: artist.name,
				under: joined(
					artist.albumCount > 0 &&
						t("artist.albumCount", {
							count: artist.albumCount,
							total: artist.albumCount,
						}),
					t("view.trackCount", {
						count: artist.trackCount + artist.guestCount,
						total: artist.trackCount + artist.guestCount,
					}),
				),
			};
		}

		case "album": {
			const { album } = suggestion;
			const identity = coverKey(album.artist, album.album);
			return {
				key: identity,
				leading: (
					<Artwork
						src={coverAt(album.cover)}
						identity={identity}
						size={ART}
						className={styles.cover}
					/>
				),
				title: album.album,
				under: joined(
					album.artist,
					t("view.trackCount", {
						count: album.trackCount,
						total: album.trackCount,
					}),
				),
			};
		}

		case "genre": {
			const { genre } = suggestion;
			return {
				key: `genre:${genre.name}`,
				leading: (
					<span className={styles.glyph} aria-hidden="true">
						<Shapes size={17} strokeWidth={2} />
					</span>
				),
				title: genre.name,
				under: t("view.trackCount", {
					count: genre.trackCount,
					total: genre.trackCount,
				}),
			};
		}

		default: {
			const row = rowAt(library.columns, suggestion.ref);
			return {
				key: `track:${suggestion.ref}`,
				leading: cover(suggestion.ref, styles.cover),
				title: titleOf(row, t),
				under: joined(artistOf(row, t), value(row, FIELD.album)),
			};
		}
	}
}

/**
 * `dvh` is no help here: neither platform shrinks the layout viewport for the software keyboard, so a
 * panel sized to the screen puts its own last rows behind the keys with no scroll left to reach them.
 * The inset is written to the element rather than to state, since iOS emits a stream of these while
 * the keyboard animates.
 */
function useAnchoredBounds(
	anchor: RefObject<HTMLElement | null>,
	panel: RefObject<HTMLElement | null>,
) {
	useLayoutEffect(() => {
		const element = panel.current;
		const from = anchor.current;
		if (!element || !from) return undefined;

		const viewport = window.visualViewport;

		const apply = () => {
			const box = from.getBoundingClientRect();
			const bar = from.closest("header") ?? from;
			element.style.setProperty("--anchor-bottom", `${box.bottom}px`);
			element.style.setProperty(
				"--bar-bottom",
				`${bar.getBoundingClientRect().bottom}px`,
			);
			element.style.setProperty("--anchor-left", `${box.left}px`);
			element.style.setProperty("--anchor-width", `${box.width}px`);
			element.style.setProperty(
				"--keyboard-inset",
				`${
					viewport
						? Math.max(
								0,
								window.innerHeight - viewport.height - viewport.offsetTop,
							)
						: 0
				}px`,
			);
		};

		apply();
		window.addEventListener("resize", apply);
		viewport?.addEventListener("resize", apply);
		viewport?.addEventListener("scroll", apply);

		return () => {
			window.removeEventListener("resize", apply);
			viewport?.removeEventListener("resize", apply);
			viewport?.removeEventListener("scroll", apply);
		};
	}, [anchor, panel]);
}

export function SearchDropdown({
	search,
	library,
	anchor,
	listId,
	active,
	onActive,
	onSelect,
	onDismiss,
}: {
	search: LibrarySearch;
	library: Library;
	anchor: RefObject<HTMLElement | null>;
	listId: string;
	active: number;
	onActive: (index: number) => void;
	onSelect: (suggestion: Suggestion) => void;
	onDismiss: () => void;
}) {
	const t = useTranslate();
	const panel = useRef<HTMLDivElement | null>(null);
	const list = useRef<HTMLDivElement | null>(null);
	const { sections, suggestions, failure } = search;
	const aimedAt = useEarnedHover(suggestions);

	useAnchoredBounds(anchor, panel);

	const swipe = useSwipe({ onUp: onDismiss });

	const trackStart = suggestions.findIndex((entry) => entry.kind === "track");
	const tracks = useMemo(
		() =>
			trackRows(
				library.columns,
				Int32Array.from(
					suggestions.flatMap((entry) =>
						entry.kind === "track" ? [entry.ref] : [],
					),
				),
			),
		[library.columns, suggestions],
	);
	const menu = useTrackContextMenu({
		rows: tracks,
		source: library.source,
		selection: NO_SELECTION,
		onSelectOnly: (position) => onActive(trackStart + position),
	});

	useLayoutEffect(() => {
		if (active < 0) return;
		list.current
			?.querySelector(`[id="${optionId(active)}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const isEmpty = suggestions.length === 0 && !failure;
	let cursor = 0;

	return (
		<div className={styles.panel} ref={panel} {...swipe}>
			{failure ? (
				<QuestionFailure
					{...failure}
					className={styles.failure}
					focusTo={() => search.inputRef.current}
				/>
			) : null}
			{isEmpty && library.isLoading ? (
				<p className={styles.notice}>
					{t("search.reading", {
						loaded: library.loaded,
						total: library.total,
					})}
				</p>
			) : null}
			{isEmpty && !library.isLoading && search.isPending ? (
				<div className={styles.waiting} {...busyProps(true)}>
					<BusyNote />
				</div>
			) : null}
			{isEmpty && !library.isLoading && !search.isPending ? (
				<p className={styles.notice}>{t("search.noMatch")}</p>
			) : null}
			{suggestions.length > 0 ? (
				<div
					className={styles.results}
					id={listId}
					role="listbox"
					ref={list}
					{...menu.triggerProps}
				>
					{sections.map((section) => {
						const sectionStart = cursor;
						cursor += section.suggestions.length;

						return (
							<Fragment key={section.label}>
								<Heading label={section.label} count={section.count} />

								{section.suggestions.map((suggestion, offset) => {
									const index = sectionStart + offset;
									const isActive = index === active;
									const { key, leading, title, under } = faceOf(
										suggestion,
										library,
										t,
									);

									return (
										<button
											key={key}
											type="button"
											id={optionId(index)}
											role="option"
											aria-selected={isActive}
											className={styles.result}
											data-active={isActive}
											data-kind={suggestion.kind}
											data-row={
												suggestion.kind === "track"
													? index - trackStart
													: undefined
											}
											onMouseEnter={(event: MouseEvent) => {
												if (aimedAt(event)) onActive(index);
											}}
											onClick={() => onSelect(suggestion)}
										>
											{leading}
											<span className={styles.text}>
												<span className={styles.title}>{title}</span>
												<span className={styles.under}>{under}</span>
											</span>
										</button>
									);
								})}
							</Fragment>
						);
					})}
				</div>
			) : null}
			{menu.element}
		</div>
	);
}
