import { Disc3, ListMusic, Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";

import { fold, matchesTokens, tokenize } from "@/shared/lib/text";
import { Input } from "@/shared/ui/Input";
import styles from "./CommandPalette.module.css";

/** Somewhere to go, addressed the way the hash addresses it: a playlist's route is its id, so views and playlists share one space and one handler. */
export interface PaletteEntry {
	route: string;
	title: string;
	count?: number;
}

// Jumps between the places the sidebar lists rather than searching their tracks, which is the library field's job up in the top bar.
export function CommandPalette({
	views,
	playlists,
	onSelect,
	onDismiss,
}: {
	views: PaletteEntry[];
	playlists: PaletteEntry[];
	onSelect: (route: string) => void;
	onDismiss: () => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);

	// Through the same `fold()` as every other typeable list, so accented titles are still found from unaccented input.
	const tokens = tokenize(query);
	const matching = (entries: PaletteEntry[]) =>
		tokens.length === 0
			? entries
			: entries.filter((entry) => matchesTokens(fold(entry.title), tokens));

	const matchedViews = matching(views);
	const matchedPlaylists = matching(playlists);
	// The arrow keys and Enter run down the whole panel, so the sections are two lists on screen and one everywhere else.
	const results = [...matchedViews, ...matchedPlaylists];

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new query resets the cursor, not a read
	useEffect(() => {
		setActive(0);
	}, [query]);

	const onKeyDown = (event: ReactKeyboardEvent) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive((current) => (current + 1) % Math.max(results.length, 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive(
				(current) =>
					(current - 1 + results.length) % Math.max(results.length, 1),
			);
		} else if (event.key === "Enter" && results[active]) {
			onSelect(results[active].route);
		} else if (event.key === "Escape") {
			onDismiss();
		}
	};

	const row = (entry: PaletteEntry, position: number, isView: boolean) => (
		<button
			key={entry.route}
			type="button"
			role="option"
			aria-selected={position === active}
			className={styles.result}
			data-active={position === active}
			onMouseEnter={() => setActive(position)}
			onClick={() => onSelect(entry.route)}
		>
			{isView ? (
				<Disc3 size={15} strokeWidth={2} aria-hidden="true" />
			) : (
				<ListMusic size={15} strokeWidth={2} aria-hidden="true" />
			)}
			{entry.title}
			{entry.count === undefined ? null : (
				<span className={styles.count}>{entry.count.toLocaleString()}</span>
			)}
		</button>
	);

	return (
		// A dismissal scrim, not a control: Escape is the keyboard route out and the panel above owns it.
		// biome-ignore lint/a11y/noStaticElementInteractions: scrim, see above
		<div
			className={styles.backdrop}
			role="presentation"
			onClick={(event) => {
				if (event.target === event.currentTarget) onDismiss();
			}}
		>
			<div
				className={styles.palette}
				role="dialog"
				aria-modal="true"
				aria-label="Go to"
			>
				<Input
					size="md"
					className={styles.field}
					inputRef={inputRef}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder="Go to"
					aria-label="Go to"
					spellCheck="false"
					autoComplete="off"
					leading={<Search size={16} strokeWidth={2} aria-hidden="true" />}
				/>

				<div className={styles.results} role="listbox">
					{results.length === 0 ? (
						<p className={styles.empty}>Nothing here matches that.</p>
					) : (
						<>
							{matchedViews.map((entry, position) =>
								row(entry, position, true),
							)}

							{/* Headed like the sidebar is, and for the same reason: without it the playlists run straight on from the views above them. Drawn only when the filter left something under it. */}
							{matchedPlaylists.length > 0 ? (
								<p className={styles.heading}>Playlists</p>
							) : null}
							{matchedPlaylists.map((entry, position) =>
								row(entry, matchedViews.length + position, false),
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
