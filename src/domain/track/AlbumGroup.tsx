import { Fragment } from "react";

import { Artwork } from "@/shared/ui/Artwork";
import styles from "./AlbumGroup.module.css";
import { FIELD, featuring, sameTagValue, value } from "./fields";
import type { AlbumRun } from "./grouping";
import type { TrackRenderProps } from "./listTypes";
import { refAt } from "./project";
import { TrackRow } from "./TrackRow";

export const ALBUM_COVER = 160;
export const ALBUM_COVER_COMPACT = 72;

export function AlbumGroup({
	group,
	rows,
	indices,
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
}: TrackRenderProps & { group: AlbumRun }) {
	const coverSize = isCompactViewport ? ALBUM_COVER_COMPACT : ALBUM_COVER;
	const itemIndexOf = (position: number) => refAt(indices, position);

	const runs = group.discs ?? [
		{ number: null, start: group.start, count: group.count },
	];

	const track = (index: number) => {
		const artist = value(rows[index], FIELD.artist);
		const guest = featuring(artist, group.albumArtist);

		return (
			<TrackRow
				key={index}
				row={rows[index]}
				index={index}
				itemIndex={itemIndexOf(index)}
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
				isMatch={matches?.has(index) ?? false}
				showArtist={guest === null && !sameTagValue(artist, group.albumArtist)}
				note={guest}
				onSelect={onSelect}
			/>
		);
	};

	return (
		<section className={styles.group} data-compact={isCompactViewport}>
			<div className={styles.aside}>
				<Artwork
					src={source.artworkUrl(itemIndexOf(group.start))}
					size={coverSize}
					className={styles.art}
					alt={`${group.album} cover`}
				/>
				<div className={styles.caption}>
					<div className={styles.title}>{group.album}</div>
					<div className={styles.meta}>
						{group.albumArtist}
						{group.year ? ` · ${group.year}` : ""}
					</div>
				</div>
			</div>

			<div className={styles.tracks}>
				{runs.map((run) => (
					<Fragment key={run.start}>
						{run.number === null ? null : (
							<h3 className={styles.disc}>Disc {run.number}</h3>
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
