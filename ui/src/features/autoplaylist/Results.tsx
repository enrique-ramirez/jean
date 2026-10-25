import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import {
	artistOf,
	FIELD,
	numberOf,
	titleOf,
	value,
} from "@/domain/track/fields";
import type { ListedRows } from "@/domain/track/project";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { formatTime } from "@/shared/lib/time";
import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import {
	scaledHeight,
	scaledVirtualizerOptions,
	scrollShift,
} from "@/shared/ui/scaledScroll";
import styles from "./Results.module.css";
import type { Previewed } from "./usePreviewedQuery";

const ESTIMATED_ROW = 38;
const OVERSCAN = 12;

function Rows({
	view,
	scroller,
}: {
	view: ListedRows;
	scroller: RefObject<HTMLDivElement | null>;
}) {
	const t = useTranslate();
	const virtualizer = useVirtualizer({
		count: view.length,
		getScrollElement: () => scroller.current,
		estimateSize: () => ESTIMATED_ROW,
		overscan: OVERSCAN,
		...scaledVirtualizerOptions,
	});
	const shift = scrollShift(virtualizer);

	const items = virtualizer.getVirtualItems();
	const first = items[0]?.index ?? 0;
	const end = (items.at(-1)?.index ?? -1) + 1;
	const { viewport } = view;
	const lastFirst = useRef(first);
	useEffect(() => {
		if (!viewport || end === 0) return;
		const direction = Math.sign(first - lastFirst.current) as -1 | 0 | 1;
		lastFirst.current = first;
		viewport.watch(first, end, direction);
	}, [viewport, first, end]);
	useEffect(() => viewport?.leave, [viewport]);

	return (
		<ul
			className={styles.rows}
			style={{ height: scaledHeight(virtualizer.getTotalSize()) }}
		>
			{virtualizer.getVirtualItems().map((item) => {
				if (view.isPending(item.index))
					return (
						<li
							key={item.key}
							ref={virtualizer.measureElement}
							data-index={item.index}
							data-result-row
							className={styles.row}
							style={{ transform: `translateY(${item.start - shift}px)` }}
							{...busyProps(true)}
						>
							<Skeleton width="70%" />
							<Skeleton width="50%" />
							<BusyNote />
						</li>
					);

				const row = view.at(item.index);
				const artist = artistOf(row, t);
				const album = value(row, FIELD.album);
				const seconds = numberOf(row, FIELD.duration);

				return (
					<li
						key={item.key}
						ref={virtualizer.measureElement}
						data-index={item.index}
						data-result-row
						className={styles.row}
						style={{ transform: `translateY(${item.start - shift}px)` }}
					>
						<span className={styles.title}>{titleOf(row, t)}</span>
						<span className={styles.by}>
							{album === null
								? artist
								: t("autoplaylist.artistAlbum", { artist, album })}
						</span>
						<span className={styles.length}>
							{seconds === null ? "--" : formatTime(seconds)}
						</span>
					</li>
				);
			})}
		</ul>
	);
}

function Notice({
	state,
	idle,
}: {
	state: Exclude<Previewed, { kind: "matches" }>;
	idle: IdlePhrase;
}) {
	const t = useTranslate();

	switch (state.kind) {
		case "unreadable":
			return (
				<div className={styles.notice} data-tone="error" role="alert">
					<p className={styles.problem}>{t("autoplaylist.queryFailed")}</p>
					<code className={styles.message}>{state.error}</code>
				</div>
			);
		case "noLibrary":
			return (
				<p className={styles.notice} data-tone="warn">
					{t("genre.noMediaLibrary")}
				</p>
			);
		case "idle":
			return <p className={styles.notice}>{t(idle)}</p>;
		case "empty":
			return <p className={styles.notice}>{t("autoplaylist.noMatches")}</p>;
		case "failed":
			return (
				<p className={styles.notice} role="alert">
					{t("genre.previewFailed")}
				</p>
			);
		case "pending":
			return (
				<p className={styles.notice}>
					{t(state.isBusy ? "genre.previewBusy" : "genre.asking")}
				</p>
			);
	}
}

const isAlert = (state: Previewed) =>
	state.kind === "unreadable" || state.kind === "failed";

export type IdlePhrase = "autoplaylist.typeQuery" | "autoplaylist.foreignQuery";

export function Results({
	state,
	isStale,
	idle = "autoplaylist.typeQuery",
}: {
	state: Previewed;
	isStale: boolean;
	idle?: IdlePhrase;
}) {
	const t = useTranslate();
	const scroller = useRef<HTMLDivElement | null>(null);
	const matched = state.kind === "matches" ? state.view.indices : null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new list fires this rather than being read in it.
	useLayoutEffect(() => {
		scroller.current?.scrollTo(0, 0);
	}, [matched]);

	return (
		<>
			<p
				className={styles.stats}
				role="status"
				data-stats
				data-stale={isStale || undefined}
			>
				{state.kind === "matches"
					? t("autoplaylist.stats.tracks", { count: state.stats.tracks })
					: null}
			</p>

			<div
				className={styles.results}
				ref={scroller}
				data-results
				data-stale={isStale || undefined}
				aria-busy={isStale}
			>
				<div role="status">
					{state.kind === "matches" || isAlert(state) ? null : (
						<Notice state={state} idle={idle} />
					)}
				</div>
				{state.kind === "matches" ? (
					<Rows view={state.view} scroller={scroller} />
				) : isAlert(state) ? (
					<Notice state={state} idle={idle} />
				) : null}
			</div>
		</>
	);
}
