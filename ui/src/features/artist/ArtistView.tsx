import { Play, Shuffle } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Artist } from "@/domain/artist/Artist";
import type { ArtistTracks } from "@/domain/artist/artists";
import { libraryNoticeFor } from "@/domain/library/LibraryNotice";
import {
	isLibraryReading,
	readingNotice,
} from "@/domain/library/libraryStatus";
import { QuestionFailure } from "@/domain/library/QuestionFailure";
import type { QuestionFailed } from "@/domain/library/questionFailed";
import type { Library } from "@/domain/library/useLibrary";
import { byWait, type Wait } from "@/domain/library/useOverdue";
import {
	useCanControlPlayback,
	whenControllable,
} from "@/domain/player/usePlaybackControl";
import { albumsOf } from "@/domain/track/albums";
import { useAvailableFields } from "@/domain/track/fieldAvailability";
import { CREDIT_TAGS, FIELD, titleOf, value } from "@/domain/track/fields";
import { LibraryCards } from "@/domain/track/LibraryCards";
import { isLoaded } from "@/domain/track/libraryColumns";
import {
	EMPTY_VIEW,
	project,
	type Refs,
	type TrackView,
} from "@/domain/track/project";
import { type ArtistTab, albumRoute, href } from "@/domain/track/routes";
import { summarise } from "@/domain/track/stats";
import { ViewHeader } from "@/domain/track/ViewHeader";
import { useDeferredPress } from "@/shared/hooks/useDeferredPress";
import { useSpoken, useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Artwork } from "@/shared/ui/Artwork";
import { Button } from "@/shared/ui/Button";
import { BusyNote, busyProps, Skeleton } from "@/shared/ui/Skeleton";
import styles from "./ArtistView.module.css";

const inLibrarySpace = (refs: Refs, view: TrackView) =>
	Int32Array.from(refs, (at) => view.indices[at]);

const recordsOf = (view: TrackView | null) =>
	view
		? albumsOf(view)
				.map((album) => ({ ...album, refs: inLibrarySpace(album.refs, view) }))
				.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
		: [];

type AlbumRecord = ReturnType<typeof recordsOf>[number];

const PLACEHOLDER_RECORDS = 6;

function PendingOverview() {
	return (
		<div className={styles.overview} {...busyProps(true)}>
			<section className={styles.section}>
				<div className={styles.records}>
					{Array.from({ length: PLACEHOLDER_RECORDS }, (_, at) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: placeholders are interchangeable and never reorder
							key={at}
							className={styles.record}
						>
							<span className={styles.sleeve}>
								<Skeleton height="100%" />
							</span>
							<Skeleton width="70%" />
							<Skeleton width="40%" />
						</span>
					))}
				</div>
			</section>
			<BusyNote />
		</div>
	);
}

export type SlideDirection = 1 | -1 | 0;

function Records({
	heading,
	records,
	library,
	showsCredit,
}: {
	heading: string;
	records: AlbumRecord[];
	library: Library;
	showsCredit: boolean;
}) {
	const t = useTranslate();
	if (records.length === 0) return null;

	return (
		<section className={styles.section}>
			<h2 className={styles.heading}>{heading}</h2>
			<div className={styles.records}>
				{records.map((album) => (
					<a
						key={album.key}
						className={styles.record}
						href={href(albumRoute(album.artistTag, album.album))}
					>
						<span className={styles.sleeve}>
							<Artwork
								src={library.source.artworkUrl(album.refs[0])}
								size="100%"
								className={styles.cover}
							/>
						</span>
						<span className={styles.recordTitle}>{album.album}</span>
						{showsCredit && album.artistTag ? (
							<span className={styles.recordMeta}>{album.artistTag}</span>
						) : null}
						<span className={styles.recordMeta}>
							{album.year ? (
								<span className="tabular">{album.year}</span>
							) : null}
							<span>
								{t("view.trackCount", {
									count: album.trackCount,
									total: album.trackCount,
								})}
							</span>
						</span>
					</a>
				))}
			</div>
		</section>
	);
}

export function ArtistView({
	name,
	library,
	tracks,
	wait,
	failure,
	tab,
	direction,
	tabs,
	tracksPanel,
	onPlay,
	onShuffle,
	canPlay,
	canShuffle,
}: {
	name: string;
	library: Library;
	tracks: ArtistTracks;
	wait: Wait;
	failure: QuestionFailed | null;
	tab: ArtistTab;
	direction: SlideDirection;
	tabs: ReactNode;
	tracksPanel: ReactNode;
	onPlay: (refs: Refs, position: number) => void;
	onShuffle: (refs: Refs) => void;
	canPlay: boolean;
	canShuffle: boolean;
}) {
	const t = useTranslate();
	const say = useSpoken();
	const canControlPlayback = useCanControlPlayback();
	const { snapshot } = library;
	const isSplitting = !isLoaded(snapshot.columns, CREDIT_TAGS);

	const own = useMemo(
		() => project(snapshot, tracks.own) ?? null,
		[snapshot, tracks.own],
	);
	const shared = useMemo(
		() => project(snapshot, tracks.shared) ?? null,
		[snapshot, tracks.shared],
	);
	const guest = useMemo(
		() => project(snapshot, tracks.guest) ?? null,
		[snapshot, tracks.guest],
	);

	const isAwaiting = isSplitting || wait.isWaiting;
	const stats = useMemo(
		() => (isAwaiting ? null : summarise(own ?? EMPTY_VIEW)),
		[own, isAwaiting],
	);

	const discography = useMemo(() => recordsOf(own), [own]);
	const withOthers = useMemo(() => recordsOf(shared), [shared]);

	const { hasPlayCounts } = useAvailableFields();

	const held =
		(own?.length ?? 0) + (shared?.length ?? 0) + (guest?.length ?? 0);
	const allRefs = tracks.all;
	const isPlayable =
		(held > 0 || isAwaiting) && !wait.isOverdue && canControlPlayback;

	const press = useDeferredPress<"play" | "shuffle">(isAwaiting, (kind) => {
		if (allRefs.length === 0) return;
		if (kind === "play") onPlay(allRefs, 0);
		else onShuffle(allRefs);
	});

	useKeymap(
		SCOPE.playlist,
		{ playAll: () => press("play") },
		{ enabled: isPlayable && canPlay },
	);
	useKeymap(
		SCOPE.playlist,
		{ shufflePlay: () => press("shuffle") },
		{ enabled: isPlayable && canShuffle },
	);

	const notice = libraryNoticeFor(library);
	if (notice) return notice;

	const { status } = library;
	const isReading = isLibraryReading(status);

	const overview = isSplitting ? (
		<PendingOverview />
	) : (
		<div className={styles.overview}>
			{held === 0 ? (
				failure ? (
					<QuestionFailure {...failure} />
				) : (
					<p className={styles.notice}>
						{isReading
							? readingNotice(status, "library.reading", t)
							: byWait(wait, {
									settled: t("artist.nothingBy"),
									quiet: null,
									reading: t("library.reading"),
								})}
					</p>
				)
			) : null}

			{own ? (
				<LibraryCards
					stats={stats}
					rows={own}
					hasPlayCounts={hasPlayCounts}
					isOverdue={wait.isOverdue}
				/>
			) : null}

			{held > 0 ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>{t("artist.about")}</h2>
					<Artist name={name} />
				</section>
			) : null}

			<Records
				heading={t("artist.discography")}
				records={discography}
				library={library}
				showsCredit={false}
			/>

			<Records
				heading={t("artist.withOthers")}
				records={withOthers}
				library={library}
				showsCredit
			/>

			{guest && guest.length > 0 ? (
				<section className={styles.section}>
					<h2 className={styles.heading}>{t("artist.appearsOn")}</h2>
					<ul className={styles.guests}>
						{Array.from({ length: guest.length }, (_, position) => {
							const row = guest.at(position);
							return (
								<li key={`${tracks.guest[position]}`}>
									<button
										type="button"
										className={styles.guestRow}
										onClick={() => onPlay(tracks.guest, position)}
									>
										<Artwork
											src={library.source.artworkUrl(tracks.guest[position])}
											size={36}
										/>
										<span className={styles.guestText}>
											<span className={styles.guestTitle}>
												{titleOf(row, t)}
											</span>
											<span className={styles.guestUnder}>
												{value(row, FIELD.artist)}
											</span>
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			) : null}
		</div>
	);

	return (
		<div>
			<ViewHeader
				eyebrow={t("artist.eyebrow")}
				title={name}
				stats={stats}
				isStatsPending={wait.isOverdue}
				covers={{ source: library.source, rows: own ?? EMPTY_VIEW, seed: name }}
				tabs={tabs}
				actions={
					held > 0 || isAwaiting ? (
						<>
							<Button
								variant="primary"
								icon={Play}
								disabled={canControlPlayback && (!canPlay || wait.isOverdue)}
								{...whenControllable(
									canControlPlayback,
									() => press("play"),
									say("player.play"),
									say,
								)}
							>
								{t("player.play")}
							</Button>
							{canShuffle ? (
								<Button
									icon={Shuffle}
									disabled={canControlPlayback && wait.isOverdue}
									{...whenControllable(
										canControlPlayback,
										() => press("shuffle"),
										t("player.shuffle"),
										t,
									)}
								>
									{t("player.shuffle")}
								</Button>
							) : null}
						</>
					) : null
				}
			/>

			<div key={tab} className={styles.panel} data-direction={direction}>
				{tab === "tracks" ? tracksPanel : overview}
			</div>
		</div>
	);
}
