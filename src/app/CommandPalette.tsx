import { ListMusic, Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import type { PlaylistInfo } from "@/shared/api/types";

import { fold, matchesTokens, tokenize } from "@/shared/lib/text";
import styles from "./CommandPalette.module.css";

// Jumps between playlists rather than searching their tracks, which is the library field's job up in the top bar.
export function CommandPalette({
	playlists,
	onSelect,
	onDismiss,
}: {
	playlists: PlaylistInfo[];
	onSelect: (id: string) => void;
	onDismiss: () => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);

	// Through the same `fold()` as every other typeable list, so accented titles are still found from unaccented input.
	const tokens = tokenize(query);
	const results =
		tokens.length === 0
			? playlists
			: playlists.filter((playlist) =>
					matchesTokens(fold(playlist.title), tokens),
				);

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
			onSelect(results[active].id);
		} else if (event.key === "Escape") {
			onDismiss();
		}
	};

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
				aria-label="Go to playlist"
			>
				<div className={styles.field}>
					<Search size={16} strokeWidth={2} aria-hidden="true" />
					<input
						ref={inputRef}
						className={styles.input}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onKeyDown}
						placeholder="Go to playlist"
						aria-label="Go to playlist"
						spellCheck="false"
						autoComplete="off"
					/>
				</div>

				<div className={styles.results} role="listbox">
					{results.length === 0 ? (
						<p className={styles.empty}>No playlist matches that.</p>
					) : (
						results.map((playlist, position) => (
							<button
								key={playlist.id}
								type="button"
								role="option"
								aria-selected={position === active}
								className={styles.result}
								data-active={position === active}
								onMouseEnter={() => setActive(position)}
								onClick={() => onSelect(playlist.id)}
							>
								<ListMusic size={15} strokeWidth={2} aria-hidden="true" />
								{playlist.title}
								<span className={styles.count}>
									{playlist.itemCount.toLocaleString()}
								</span>
							</button>
						))
					)}
				</div>
			</div>
		</div>
	);
}
