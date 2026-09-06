import { Search, X } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { TrackColumns } from "@/shared/api/types";
import { useDebounced } from "@/shared/hooks/useDebounced";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import styles from "./Finder.module.css";
import { FIELD, value } from "./fields";

// Finds without filtering: the list keeps every track and its order, and only Enter starts playback.
export function Finder({
	inputRef,
	rows,
	label,
	results,
	matches,
	query,
	onQueryChange,
	onPreview,
	onConfirm,
	onClose,
}: {
	// The hook's, and so is the caret: it puts it here when the field appears and again on every later `/`, which is one rule in one place rather than a mount effect that only ever answers the first of them.
	inputRef: RefObject<HTMLInputElement | null>;
	rows: TrackColumns[];
	label: string;
	results: number[];
	matches: Set<number> | null;
	query: string;
	onQueryChange: (query: string) => void;
	onPreview: (index: number) => void;
	onConfirm: (index: number) => void;
	onClose: () => void;
}) {
	const listRef = useRef<HTMLDivElement | null>(null);
	const [active, setActive] = useState(0);
	const debouncedActive = useDebounced(active, 90);

	// Held in a ref: the parent passes a new closure every render, and depending on it directly would make previewing re-run itself forever.
	const previewRef = useRef(onPreview);
	previewRef.current = onPreview;

	// Whether the active result is where the user put it, or merely where a new query reset it. Only the first previews.
	const navigated = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new query resets the cursor, not a read
	useEffect(() => {
		setActive(0);
		navigated.current = false;
	}, [query]);

	// A list appearing under a stationary cursor gets a mouseenter it did not earn, on every open and every keystroke, which would hand the active result to whatever landed under the mouse.
	// `moved` covers the ordinary case and is re-armed per result set in a layout effect, so the reset lands before the mouseenter that follows paint; the coordinate check covers the first move onto a result, where mouseenter arrives before the mousemove that would have set the flag.
	const moved = useRef(false);
	const lastSeen = useRef<{ x: number; y: number } | null>(null);

	useEffect(() => {
		const track = (event: MouseEvent) => {
			moved.current = true;
			lastSeen.current = { x: event.clientX, y: event.clientY };
		};
		window.addEventListener("mousemove", track);
		return () => window.removeEventListener("mousemove", track);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-armed per result set, see above
	useLayoutEffect(() => {
		moved.current = false;
	}, [results]);

	const aimedAt = (event: ReactMouseEvent) => {
		if (moved.current) return true;
		// The first enter has no earlier position to compare against, so it is rejected and its coordinates become the reference.
		const previous = lastSeen.current;
		lastSeen.current = { x: event.clientX, y: event.clientY };
		return (
			previous !== null &&
			(event.clientX !== previous.x || event.clientY !== previous.y)
		);
	};

	// Follows the cursor, deliberately not the query: previewing per keystroke relays out the sticky toolbar the field sits in, and Android's keyboard then loses its composition and returns the letters scrambled.
	const previewIndex = results[debouncedActive];

	useEffect(() => {
		if (!navigated.current) return;
		if (previewIndex !== undefined) previewRef.current(previewIndex);
	}, [previewIndex]);

	const revealActive = useRef(false);

	useLayoutEffect(() => {
		if (!revealActive.current) return;
		revealActive.current = false;

		const list = listRef.current;
		const option = list?.children[active];
		if (!list || !(option instanceof HTMLElement)) return;

		const above = option.offsetTop - list.scrollTop;
		const below = above + option.offsetHeight - list.clientHeight;
		// One branch each way, and neither when the row is already whole: scrolling a visible row to an edge is motion that answers nothing.
		if (above < 0) list.scrollTop += above;
		else if (below > 0) list.scrollTop += below;
	}, [active]);

	const step = (delta: number) => {
		if (results.length === 0) return;
		navigated.current = true;
		// Only a key scrolls: a hover already proves the row is on screen, and scrolling under a stationary pointer fires mouseenter, which moves the cursor, which scrolls again.
		revealActive.current = true;
		setActive((current) => (current + delta + results.length) % results.length);
	};

	useKeymap(SCOPE.finder, {
		finderNext: () => step(1),
		finderPrevious: () => step(-1),
		finderConfirm: () => {
			const index = results[active];
			if (index !== undefined) onConfirm(index);
		},
		finderClose: onClose,
	});

	return (
		<div className={styles.finder}>
			<Search size={15} strokeWidth={2} aria-hidden="true" />
			<input
				ref={inputRef}
				className={styles.input}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				placeholder={label}
				aria-label={label}
				spellCheck="false"
				autoComplete="off"
			/>
			{matches ? <span className={styles.count}>{matches.size}</span> : null}
			<button
				type="button"
				className={styles.close}
				onClick={onClose}
				aria-label="Close finder"
			>
				<X size={14} strokeWidth={2} />
			</button>

			{query.trim().length > 0 ? (
				<div className={styles.results} role="listbox" ref={listRef}>
					{results.length === 0 ? (
						<p className={styles.empty}>Nothing here matches that.</p>
					) : (
						results.map((index: number, position: number) => (
							<button
								key={index}
								type="button"
								role="option"
								aria-selected={position === active}
								className={styles.result}
								data-active={position === active}
								onPointerDown={(event) => event.preventDefault()}
								onClick={() => onConfirm(index)}
								onMouseEnter={(event) => {
									if (!aimedAt(event)) return;
									navigated.current = true;
									setActive(position);
								}}
							>
								<span className={styles.names}>
									<span className={styles.resultTitle}>
										{value(rows[index], FIELD.title) ?? "Unknown"}
									</span>
									<span className={styles.resultArtist}>
										{value(rows[index], FIELD.artist) ?? "Unknown artist"}
									</span>
								</span>
								<span className={styles.position}>#{index + 1}</span>
							</button>
						))
					)}
				</div>
			) : null}
		</div>
	);
}
