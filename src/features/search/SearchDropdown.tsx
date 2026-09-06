import { type RefObject, useLayoutEffect, useRef } from "react";
import type { Library } from "@/domain/library/useLibrary";
import type { LibrarySearch } from "@/domain/library/useLibrarySearch";
import { artistOf, FIELD, titleOf, value } from "@/domain/track/fields";
import { useEarnedHover } from "@/shared/hooks/useEarnedHover";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./SearchDropdown.module.css";

export const optionId = (position: number) => `search-result-${position}`;

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
	onSelect: (ref: number) => void;
	onDismiss: () => void;
}) {
	const panel = useRef<HTMLDivElement | null>(null);
	const list = useRef<HTMLDivElement | null>(null);
	const { preview, draftMatched, draftCount } = search;
	const aimedAt = useEarnedHover(preview);

	useAnchoredBounds(anchor, panel);

	// Up rather than down: the panel hangs from the top, so up is the way it came. `useSwipe` holds it
	// back until the list has nothing left to scroll, and a list short enough not to scroll is at both
	// ends at once.
	const swipe = useSwipe({ onUp: onDismiss });

	useLayoutEffect(() => {
		list.current?.children[active]?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const rows = preview.map((position) => {
		const ref = draftMatched ? draftMatched[position] : position;
		return { position, ref, row: library.rows[ref] };
	});

	return (
		<div className={styles.panel} ref={panel} {...swipe}>
			{rows.length === 0 ? (
				<p className={styles.notice}>
					{library.isLoading
						? `Searching ${library.loaded.toLocaleString()} of ${library.total.toLocaleString()}...`
						: "Nothing in your library matches that."}
				</p>
			) : (
				<>
					<p className={styles.heading}>
						Tracks <span className={styles.count}>({draftCount})</span>
					</p>

					<div className={styles.results} id={listId} role="listbox" ref={list}>
						{rows.map(({ position, row, ref }, index) => (
							<button
								key={position}
								type="button"
								id={optionId(index)}
								role="option"
								aria-selected={index === active}
								className={styles.result}
								data-active={index === active}
								onMouseEnter={(event) => {
									if (aimedAt(event)) onActive(index);
								}}
								onClick={() => onSelect(ref)}
							>
								<Artwork
									src={library.source.artworkUrl(ref)}
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
						))}
					</div>
				</>
			)}
		</div>
	);
}
