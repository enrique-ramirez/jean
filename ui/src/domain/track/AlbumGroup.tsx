import { Fragment } from "react";

import { useTranslate } from "@/shared/i18n/useTranslate";
import { Artwork } from "@/shared/ui/Artwork";
import { Skeleton } from "@/shared/ui/Skeleton";
import styles from "./AlbumGroup.module.css";
import { ArtistLinks } from "./ArtistLinks";
import { coverIdentity, FIELD, featuring, sameTagValue, value } from "./fields";
import { isMatch } from "./finderSets";
import {
	type AlbumSpan,
	coverRefOf,
	coverRowOf,
	discsOf,
	headingOf,
} from "./grouping";
import type { TrackRenderProps } from "./listTypes";
import { albumRoute, href } from "./routes";
import { TrackRow } from "./TrackRow";

export const ALBUM_COVER = 160;
export const ALBUM_COVER_COMPACT = 72;

export function AlbumGroup({
	group,
	rows,
	source,
	columns,
	template,
	heat,
	patina,
	activeIndex,
	isPlaying,
	cursor,
	selection,
	matches,
	onSelect,
	isCompactViewport,
	rowId,
}: TrackRenderProps & { group: AlbumSpan; rowId: (index: number) => string }) {
	const t = useTranslate();
	const coverSize = isCompactViewport ? ALBUM_COVER_COMPACT : ALBUM_COVER;
	const heading = headingOf(group, rows);
	const title = heading ? (heading.album ?? t("track.unknownAlbum")) : "";

	const discs = discsOf(group, rows) ?? [
		{ number: null, start: group.start, count: group.count },
	];

	const track = (index: number) => {
		const artist = value(rows.at(index), FIELD.artist);
		const guest = featuring(artist, heading?.albumArtist);

		return (
			<TrackRow
				key={index}
				id={rowId(index)}
				rows={rows}
				index={index}
				itemIndex={rows.ref(index)}
				source={source}
				columns={columns}
				template={template}
				showArtwork={false}
				heat={heat[index]}
				patina={patina[index]}
				isActive={index === activeIndex}
				isPlaying={isPlaying}
				isSelected={selection.has(index)}
				isCursor={index === cursor}
				isMatch={isMatch(matches, index)}
				showArtist={
					heading !== null &&
					guest === null &&
					!sameTagValue(artist, heading.albumArtist)
				}
				note={guest}
				onSelect={onSelect}
			/>
		);
	};

	return (
		<section
			className={styles.group}
			data-compact={isCompactViewport}
			data-span-start={group.start}
			data-span-count={group.count}
		>
			<div className={styles.aside}>
				<div className={styles.cover} data-album-cover="">
					<Artwork
						src={source.artworkUrl(coverRefOf(group, rows))}
						identity={coverIdentity(coverRowOf(group, rows))}
						size={coverSize}
						className={styles.art}
						alt={t("album.coverAlt", { album: title })}
					/>
				</div>
				<div className={styles.caption}>
					{heading ? (
						<>
							<div className={styles.title}>
								{heading.album ? (
									<a
										className="tag-link"
										href={href(albumRoute(heading.albumArtist, heading.album))}
									>
										{title}
									</a>
								) : (
									title
								)}
							</div>
							<div className={styles.meta}>
								{heading.albumArtist ? (
									<ArtistLinks credit={heading.albumArtist} />
								) : (
									t("track.unknownArtist")
								)}
								{heading.year ? ` · ${heading.year}` : ""}
							</div>
						</>
					) : (
						<>
							<div className={styles.title}>
								<Skeleton width="70%" />
							</div>
							<div className={styles.meta}>
								<Skeleton width="45%" />
							</div>
						</>
					)}
				</div>
			</div>

			<div className={styles.tracks}>
				{discs.map((run) => (
					<Fragment key={run.start}>
						{run.number === null ? null : (
							<h3 className={styles.disc}>
								{t("album.disc", { number: run.number })}
							</h3>
						)}
						{Array.from({ length: run.count }, (_, offset) =>
							track(run.start + offset),
						)}
					</Fragment>
				))}
			</div>
		</section>
	);
}
