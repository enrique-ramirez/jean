import { Search, X } from "lucide-react";
import {
	type RefObject,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
} from "react";
import { useDebounced } from "@/shared/hooks/useDebounced";
import { useEarnedHover } from "@/shared/hooks/useEarnedHover";
import { useResettingState } from "@/shared/hooks/useResettingState";
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
	const [active, setActive] = useResettingState(0, [query]);
	const debouncedActive = useDebounced(active, 90);

	const preview = useEffectEvent((index: number) => onPreview(index));

	const navigatedFor = useRef<string | null>(null);

	const aimedAt = useEarnedHover(results);

	// Follows the cursor, deliberately not the query: previewing per keystroke relays out the sticky
	// toolbar the field sits in, and Android's keyboard then loses its composition and returns the
	// letters scrambled.
	const previewIndex = results[debouncedActive];

	useEffect(() => {
		if (navigatedFor.current !== query) return;
		if (previewIndex !== undefined) preview(previewIndex);
	}, [previewIndex, query]);

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
		navigatedFor.current = query;
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
						<span role="status" className={matches ? styles.count : undefined}>
							{matches ? (
								<>
									<span aria-hidden="true">{matches.size}</span>
									<span className="visually-hidden">
										{t("finder.matches", { count: matches.size })}
									</span>
								</>
							) : null}
						</span>
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
								// A press blurs the focused field before its `click` lands.
								onPointerDown={(event) => event.preventDefault()}
								onClick={() => onConfirm(index)}
								onMouseEnter={(event) => {
									if (!aimedAt(event)) return;
									navigatedFor.current = query;
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
								{/* biome-ignore lint/style/noJsxLiterals: whether a number sign before a position is a phrase is the owner's decision */}
								<span className={styles.position}>#{index + 1}</span>
							</button>
						))
					)}
				</div>
			) : null}
		</div>
	);
}
