import { Shapes } from "lucide-react";
import {
	Fragment,
	type MouseEvent,
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
} from "react";
import type { Library } from "@/domain/library/useLibrary";
import type {
	LibrarySearch,
	SearchSectionLabel,
	Suggestion,
} from "@/domain/library/useLibrarySearch";
import {
	artistOf,
	coverIdentity,
	FIELD,
	titleOf,
	value,
} from "@/domain/track/fields";
import { useEarnedHover } from "@/shared/hooks/useEarnedHover";
import { useSwipe } from "@/shared/hooks/useSwipe";
import {
	type Translate,
	useFormats,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./SearchDropdown.module.css";

export const optionId = (position: number) => `search-result-${position}`;

const ART = 36;

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
			{t(label)} <span className={styles.count}>({format.number(count)})</span>
		</p>
	);
}

const joined = (...parts: (string | null | false)[]) =>
	parts.filter(Boolean).join(" · ");

/**
 * The kinds differ by what leads the row and by what the second line answers, and by nothing else.
 *
 * Every cover is asked for by identity as well as by address: the album a query names and a track on
 * it are two rows in one panel pointing at one sleeve, and beefweb addresses that sleeve differently
 * for each of them.
 */
function faceOf(
	suggestion: Suggestion,
	library: Library,
	t: Translate,
): { key: string; leading: ReactNode; title: string; under: string } {
	const cover = (ref: number, className: string) => (
		<Artwork
			src={library.source.artworkUrl(ref)}
			identity={coverIdentity(library.rows[ref])}
			size={ART}
			className={className}
		/>
	);

	switch (suggestion.kind) {
		case "artist": {
			const { artist } = suggestion;
			return {
				key: `artist:${artist.key}`,
				leading:
					artist.coverRefs.length > 0 ? (
						cover(artist.coverRefs[0], styles.face)
					) : (
						<Artwork src={null} size={ART} className={styles.face} />
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
			return {
				key: `album:${album.key}`,
				leading: cover(album.refs[0], styles.cover),
				title: album.album,
				under: joined(
					album.artistTag,
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
				key: `genre:${genre.key}`,
				// A genre has no artwork and never will, and the slot is kept anyway so its name sits on
				// the same line as every other row's.
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
			const row = library.rows[suggestion.ref];
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
 * The panel is drawn below the field on a pointer viewport and fills the screen below the top bar on
 * a compact one, and both of those are one set of coordinates rather than two components -- so they
 * are measured here and spent in the stylesheet, where the breakpoint lives.
 *
 * `dvh` is no help for the second one: neither platform shrinks the layout viewport for the software
 * keyboard, so a panel sized to the screen puts its own last rows behind the keys with no scroll
 * left to reach them. The inset is written to the element rather than to state, since iOS emits a
 * stream of these while the keyboard animates.
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
			// The panel hangs from the field on a pointer viewport and from the whole bar on a compact one,
			// where it is full-bleed and would otherwise stack its own edge against the bar's.
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
	const { sections, suggestions } = search;
	const aimedAt = useEarnedHover(suggestions);

	useAnchoredBounds(anchor, panel);

	// Up rather than down: the panel hangs from the top, so up is the way it came. `useSwipe` holds it
	// back until the list has nothing left to scroll, and a list short enough not to scroll is at both
	// ends at once.
	const swipe = useSwipe({ onUp: onDismiss });

	// Found by id rather than by child position: the headings are children of the list too, so the
	// cursor's index and the element's index are several rows apart by the fourth section.
	useLayoutEffect(() => {
		if (active < 0) return;
		list.current
			?.querySelector(`[id="${optionId(active)}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [active]);

	// Where each section starts in the flat list the keyboard walks.
	let from = 0;

	return (
		<div className={styles.panel} ref={panel} {...swipe}>
			{suggestions.length === 0 ? (
				<p className={styles.notice}>
					{library.isLoading
						? t("search.reading", {
								loaded: library.loaded,
								total: library.total,
							})
						: t("search.noMatch")}
				</p>
			) : (
				<div className={styles.results} id={listId} role="listbox" ref={list}>
					{sections.map((section) => {
						const starts = from;
						from += section.suggestions.length;

						return (
							<Fragment key={section.label}>
								<Heading label={section.label} count={section.count} />

								{section.suggestions.map((suggestion, offset) => {
									const index = starts + offset;
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
			)}
		</div>
	);
}
