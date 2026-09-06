import { Disc3, ListMusic, Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { useEarnedHover } from "@/shared/hooks/useEarnedHover";
import { fold, matchesTokens, tokenize } from "@/shared/lib/text";
import { Input } from "@/shared/ui/Input";
import styles from "./CommandPalette.module.css";

export interface PaletteEntry {
	route: string;
	title: string;
	count?: number;
}

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

	const { matchedViews, matchedPlaylists, results } = useMemo(() => {
		const tokens = tokenize(query);
		const matching = (entries: PaletteEntry[]) =>
			tokens.length === 0
				? entries
				: entries.filter((entry) => matchesTokens(fold(entry.title), tokens));

		const matchedViews = matching(views);
		const matchedPlaylists = matching(playlists);
		return {
			matchedViews,
			matchedPlaylists,
			results: [...matchedViews, ...matchedPlaylists],
		};
	}, [query, views, playlists]);

	const aimedAt = useEarnedHover(results);

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
			onMouseEnter={(event) => {
				if (aimedAt(event)) setActive(position);
			}}
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
		// biome-ignore lint/a11y/noStaticElementInteractions: a dismissal scrim, not a control
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
