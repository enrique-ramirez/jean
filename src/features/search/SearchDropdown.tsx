import {
	Fragment,
	type MouseEvent,
	type RefObject,
	useLayoutEffect,
	useRef,
} from "react";
import type { Library } from "@/domain/library/useLibrary";
import type {
	LibrarySearch,
	Suggestion,
} from "@/domain/library/useLibrarySearch";
import { artistOf, FIELD, titleOf, value } from "@/domain/track/fields";
import { useEarnedHover } from "@/shared/hooks/useEarnedHover";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { plural } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./SearchDropdown.module.css";

export const optionId = (position: number) => `search-result-${position}`;

function Heading({ label, count }: { label: string; count: number }) {
	return (
		<p className={styles.heading}>
			{label} <span className={styles.count}>({count.toLocaleString()})</span>
		</p>
	);
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
	const panel = useRef<HTMLDivElement | null>(null);
	const list = useRef<HTMLDivElement | null>(null);
	const { suggestions, artists, artistCount, draftCount } = search;
	const aimedAt = useEarnedHover(suggestions);

	useAnchoredBounds(anchor, panel);

	// Up rather than down: the panel hangs from the top, so up is the way it came. `useSwipe` holds it
	// back until the list has nothing left to scroll, and a list short enough not to scroll is at both
	// ends at once.
	const swipe = useSwipe({ onUp: onDismiss });

	useLayoutEffect(() => {
		list.current?.children[active]?.scrollIntoView({ block: "nearest" });
	}, [active]);

	return (
		<div className={styles.panel} ref={panel} {...swipe}>
			{suggestions.length === 0 ? (
				<p className={styles.notice}>
					{library.isLoading
						? `Searching ${library.loaded.toLocaleString()} of ${library.total.toLocaleString()}...`
						: "Nothing in your library matches that."}
				</p>
			) : (
				<div className={styles.results} id={listId} role="listbox" ref={list}>
					{suggestions.map((suggestion, index) => {
						const isActive = index === active;
						const props = {
							id: optionId(index),
							role: "option" as const,
							"aria-selected": isActive,
							className: styles.result,
							"data-active": isActive,
							"data-kind": suggestion.kind,
							onMouseEnter: (event: MouseEvent) => {
								if (aimedAt(event)) onActive(index);
							},
							onClick: () => onSelect(suggestion),
						};

						if (suggestion.kind === "artist") {
							const { artist } = suggestion;
							return (
								<Fragment key={`artist:${artist.key}`}>
									{index === 0 ? (
										<Heading label="Artists" count={artistCount} />
									) : null}
									<button type="button" {...props}>
										<Artwork
											src={
												artist.coverRefs.length > 0
													? library.source.artworkUrl(artist.coverRefs[0])
													: null
											}
											size={36}
											className={styles.face}
										/>
										<span className={styles.text}>
											<span className={styles.title}>{artist.name}</span>
											<span className={styles.under}>
												{[
													artist.albumCount > 0
														? plural(artist.albumCount, "album")
														: null,
													plural(
														artist.trackCount + artist.guestCount,
														"track",
													),
												]
													.filter(Boolean)
													.join(" · ")}
											</span>
										</span>
									</button>
								</Fragment>
							);
						}

						const row = library.rows[suggestion.ref];
						return (
							<Fragment key={`track:${suggestion.ref}`}>
								{index === artists.length ? (
									<Heading label="Tracks" count={draftCount} />
								) : null}
								<button type="button" {...props}>
									<Artwork
										src={library.source.artworkUrl(suggestion.ref)}
										size={36}
										className={styles.cover}
									/>
									<span className={styles.text}>
										<span className={styles.title}>{titleOf(row)}</span>
										<span className={styles.under}>
											{[artistOf(row), value(row, FIELD.album)]
												.filter(Boolean)
												.join(" · ")}
										</span>
									</span>
								</button>
							</Fragment>
						);
					})}
				</div>
			)}
		</div>
	);
}
