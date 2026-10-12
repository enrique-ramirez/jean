import { Disc3, ListMusic, Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useMemo,
	useRef,
	useState,
} from "react";

import { useEarnedHover } from "@/shared/hooks/useEarnedHover";
import { useResettingState } from "@/shared/hooks/useResettingState";
import { useTabTrap } from "@/shared/hooks/useTabTrap";
import { useFormats, useTranslate } from "@/shared/i18n/useTranslate";
import { fold, matchesTokens, tokenize } from "@/shared/lib/text";
import { Input } from "@/shared/ui/Input";
import styles from "./CommandPalette.module.css";

export interface PaletteEntry {
	route: string;
	title: string;
	count?: number;
}

const foldedTitle = (entry: PaletteEntry) => fold(entry.title);

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
	const t = useTranslate();
	const format = useFormats();
	const paletteRef = useRef<HTMLDivElement | null>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useResettingState(0, [query]);

	const titles = useMemo(
		() => ({
			views: views.map(foldedTitle),
			playlists: playlists.map(foldedTitle),
		}),
		[views, playlists],
	);

	const { matchedViews, matchedPlaylists, results } = useMemo(() => {
		const tokens = tokenize(query);
		const matching = (entries: PaletteEntry[], folded: string[]) =>
			tokens.length === 0
				? entries
				: entries.filter((_, at) => matchesTokens(folded[at], tokens));

		const matchedViews = matching(views, titles.views);
		const matchedPlaylists = matching(playlists, titles.playlists);
		return {
			matchedViews,
			matchedPlaylists,
			results: [...matchedViews, ...matchedPlaylists],
		};
	}, [query, views, playlists, titles]);

	const aimedAt = useEarnedHover(results);

	useTabTrap(paletteRef, "input");

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
				<span className={styles.count}>{format.number(entry.count)}</span>
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
				ref={paletteRef}
				className={styles.palette}
				role="dialog"
				aria-modal="true"
				aria-label={t("palette.goTo")}
			>
				<Input
					size="md"
					className={styles.field}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={t("palette.goTo")}
					aria-label={t("palette.goTo")}
					spellCheck="false"
					autoComplete="off"
					leading={<Search size={16} strokeWidth={2} aria-hidden="true" />}
				/>

				<div className={styles.results} role="listbox">
					{results.length === 0 ? (
						<p className={styles.empty}>{t("palette.noMatch")}</p>
					) : (
						<>
							{matchedViews.map((entry, position) =>
								row(entry, position, true),
							)}

							{matchedPlaylists.length > 0 ? (
								<p className={styles.heading}>{t("palette.playlists")}</p>
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
