import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useLayoutEffect, useRef } from "react";

import {
	artistOf,
	FIELD,
	numberOf,
	titleOf,
	value,
} from "@/domain/track/fields";
import type { TrackView } from "@/domain/track/project";
import { formatDuration } from "@/domain/track/stats";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { formatTime } from "@/shared/lib/time";
import styles from "./Results.module.css";
import type { Previewed } from "./usePreviewedQuery";

const ESTIMATED_ROW = 38;
const OVERSCAN = 12;

function Rows({
	view,
	scroller,
}: {
	view: TrackView;
	scroller: RefObject<HTMLDivElement | null>;
}) {
	const t = useTranslate();
	const virtualizer = useVirtualizer({
		count: view.length,
		getScrollElement: () => scroller.current,
		estimateSize: () => ESTIMATED_ROW,
		overscan: OVERSCAN,
	});

	return (
		<ul className={styles.rows} style={{ height: virtualizer.getTotalSize() }}>
			{virtualizer.getVirtualItems().map((item) => {
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
						style={{ transform: `translateY(${item.start}px)` }}
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
	const view = state.kind === "matches" ? state.view : null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new list fires this rather than being read in it.
	useLayoutEffect(() => {
		scroller.current?.scrollTo(0, 0);
	}, [view]);

	const length =
		state.kind === "matches" ? formatDuration(state.stats.seconds) : null;

	return (
		<>
			<p
				className={styles.stats}
				role="status"
				data-stats
				data-stale={isStale || undefined}
			>
				{state.kind === "matches"
					? [
							t("autoplaylist.stats.albumArtists", {
								count: state.stats.albumArtists,
							}),
							t("autoplaylist.stats.albums", { count: state.stats.albums }),
							t("autoplaylist.stats.tracks", { count: state.stats.tracks }),
							length,
						]
							.filter((part) => part !== null)
							.join(t("autoplaylist.separator"))
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
