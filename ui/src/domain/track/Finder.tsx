import { Search, X } from "lucide-react";
import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useDebounced } from "@/shared/hooks/useDebounced";
import { useEarnedHover } from "@/shared/hooks/useEarnedHover";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Input } from "@/shared/ui/Input";
import styles from "./Finder.module.css";
import { artistOf, titleOf } from "./fields";
import type { TrackRows } from "./project";

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
	inputRef: RefObject<HTMLInputElement | null>;
	rows: TrackRows;
	label: string;
	results: number[];
	matches: Set<number> | null;
	query: string;
	onQueryChange: (query: string) => void;
	onPreview: (index: number) => void;
	onConfirm: (index: number) => void;
	onClose: () => void;
}) {
	const t = useTranslate();
	const listRef = useRef<HTMLDivElement | null>(null);
	const [active, setActive] = useState(0);
	const debouncedActive = useDebounced(active, 90);

	// Held in a ref: the parent passes a new closure every render, and depending on it directly would
	// make previewing re-run itself forever.
	const previewRef = useRef(onPreview);
	previewRef.current = onPreview;

	const navigated = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new query resets the cursor, not a read
	useEffect(() => {
		setActive(0);
		navigated.current = false;
	}, [query]);

	const aimedAt = useEarnedHover(results);

	// Follows the cursor, deliberately not the query: previewing per keystroke relays out the sticky
	// toolbar the field sits in, and Android's keyboard then loses its composition and returns the
	// letters scrambled.
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
		if (above < 0) list.scrollTop += above;
		else if (below > 0) list.scrollTop += below;
	}, [active]);

	const step = (delta: number) => {
		if (results.length === 0) return;
		navigated.current = true;
		// Only a key scrolls: scrolling under a stationary pointer fires mouseenter, which moves the
		// cursor, which scrolls again.
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
			<Input
				size="sm"
				className={styles.field}
				inputRef={inputRef}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				placeholder={label}
				aria-label={label}
				spellCheck="false"
				autoComplete="off"
				leading={<Search size={15} strokeWidth={2} aria-hidden="true" />}
				trailing={
					<>
						{matches ? (
							<span className={styles.count}>{matches.size}</span>
						) : null}
						<button
							type="button"
							className={styles.close}
							onClick={onClose}
							aria-label={t("finder.close")}
						>
							<X size={14} strokeWidth={2} />
						</button>
					</>
				}
			/>

			{query.trim().length > 0 ? (
				<div className={styles.results} role="listbox" ref={listRef}>
					{results.length === 0 ? (
						<p className={styles.empty}>{t("finder.noMatch")}</p>
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
										{titleOf(rows.at(index), t)}
									</span>
									<span className={styles.resultArtist}>
										{artistOf(rows.at(index), t)}
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
