import { Fragment, useEffect, useRef, useState } from "react";
import type { Member } from "@/domain/artist/credits";
import { PLAYER_JOINER, valuesIn } from "@/shared/api/multiValue";
import type { WriteFields } from "@/shared/api/tags";
import type { TrackAddress, TrackColumns } from "@/shared/api/types";
import {
	type Formats,
	type Translate,
	useFormats,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import { useKeyboardOwnership } from "@/shared/keyboard/keyboardOwner";
import { Button } from "@/shared/ui/Button";
import { ArtistLinks } from "./ArtistLinks";
import {
	DETAIL_FIELDS,
	type DetailPhrase,
	DETAIL_FIELD as F,
	readDetail,
	rowWith,
} from "./detailFields";
import { readTimestamp, readValue } from "./fields";
import { albumRoute, genreRoute, href } from "./routes";
import styles from "./TrackDetails.module.css";
import {
	changesIn,
	type Editing,
	failureWords,
	openForm,
	requestFor,
	TrackDetailsForm,
	withPendingChips,
} from "./TrackDetailsForm";
import { writtenAfter } from "./tagEdits";
import { useDiscardGuard } from "./useDiscardGuard";
import { useTagWriting } from "./useTagWriter";

const read = (row: TrackColumns, field: number) =>
	readValue(readDetail(row, field));

function counted(
	row: TrackColumns,
	position: number,
	total: number,
	t: Translate,
) {
	const at = read(row, position);
	if (!at) return null;
	const of = read(row, total);
	return of && of !== at ? t("details.of", { at, of }) : at;
}

function released(row: TrackColumns, format: Formats) {
	const year = read(row, F.year);
	const date = read(row, F.date);
	if (!date || date === year) return year;
	return /^\d{4}-\d{2}-\d{2}$/.test(date)
		? format.date(new Date(`${date}T00:00:00`), {
				year: "numeric",
				month: "long",
				day: "numeric",
			})
		: date;
}

function played(raw: string | null, format: Formats) {
	if (!raw) return null;
	const at = readTimestamp(raw);
	return at === null
		? raw
		: format.date(at, { year: "numeric", month: "short", day: "numeric" });
}

interface Row {
	credit?: true;
	genres?: true;
	label: DetailPhrase;
	value: string | null;
	href?: string;
}

interface Group {
	title: DetailPhrase;
	rows: Row[];
}

function GenreLinks({ genres }: { genres: string }) {
	return valuesIn(genres).map((genre, at) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: the position in the tag is the identity
		<Fragment key={at}>
			{at > 0 ? PLAYER_JOINER : null}
			<a className="tag-link" href={href(genreRoute(genre))}>
				{genre}
			</a>
		</Fragment>
	));
}

function groupsOf(row: TrackColumns, format: Formats, t: Translate): Group[] {
	const album = read(row, F.album);
	const bitrate = read(row, F.bitrate);
	const profile = read(row, F.codecProfile);
	const sampleRate = read(row, F.sampleRate);
	const plays = Number(read(row, F.playCount) ?? 0);

	return [
		{
			title: "details.group.release",
			rows: [
				{
					label: "details.album",
					value: album,
					// The pair the record is addressed by, the way the library groups them: the album
					// artist where the file has one, and whoever it is by where it does not.
					href: album
						? href(
								albumRoute(
									read(row, F.albumArtist) ?? read(row, F.artist),
									album,
								),
							)
						: undefined,
				},
				{
					label: "details.albumArtist",
					value: read(row, F.albumArtist),
					credit: true,
				},
				{ label: "details.released", value: released(row, format) },
				{
					label: "details.genre",
					value: read(row, F.genre),
					genres: true,
				},
				{ label: "details.publisher", value: read(row, F.publisher) },
				{ label: "details.composer", value: read(row, F.composer) },
				{
					label: "details.track",
					value: counted(row, F.trackNumber, F.totalTracks, t),
				},
				{
					label: "details.disc",
					value: counted(row, F.discNumber, F.totalDiscs, t),
				},
				{ label: "details.bpm", value: read(row, F.bpm) },
			],
		},
		{
			title: "details.group.file",
			rows: [
				{
					label: "details.format",
					value:
						[read(row, F.codec), profile].filter(Boolean).join(" · ") || null,
				},
				{ label: "details.bitrate", value: bitrate ? `${bitrate} kbps` : null },
				{
					label: "details.sampleRate",
					value: sampleRate ? `${Number(sampleRate) / 1000} kHz` : null,
				},
				{ label: "details.channels", value: read(row, F.channels) },
				{ label: "details.size", value: read(row, F.fileSize) },
				{ label: "details.replayGain", value: read(row, F.trackGain) },
				{ label: "details.albumGain", value: read(row, F.albumGain) },
				{ label: "details.file", value: read(row, F.fileName) },
			],
		},
		{
			title: "details.group.listening",
			rows: [
				{
					label: "details.plays",
					value: plays > 0 ? format.number(plays) : null,
				},
				{
					label: "details.firstPlayed",
					value: played(read(row, F.firstPlayed), format),
				},
				{
					label: "details.lastPlayed",
					value: played(read(row, F.lastPlayed), format),
				},
			],
		},
	];
}

const visibleGroups = (row: TrackColumns, format: Formats, t: Translate) =>
	groupsOf(row, format, t)
		.map((group) => ({
			...group,
			rows: group.rows.filter((line) => line.value !== null),
		}))
		.filter((group) => group.rows.length > 0);

function GroupView({
	group,
	members,
}: {
	group: Group;
	members?: readonly Member[];
}) {
	const t = useTranslate();
	return (
		<section className={styles.group}>
			<h2 className={styles.groupTitle}>{t(group.title)}</h2>
			<dl className={styles.rows}>
				{group.rows.map((line) => (
					<div key={line.label} className={styles.row}>
						<dt className={styles.label}>{t(line.label)}</dt>
						<dd className={styles.value}>
							{line.credit ? (
								<ArtistLinks credit={line.value} members={members} />
							) : line.genres && line.value ? (
								<GenreLinks genres={line.value} />
							) : line.href && line.value ? (
								<a className="tag-link" href={line.href}>
									{line.value}
								</a>
							) : (
								line.value
							)}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

export function DetailsNotice({ children }: { children: string }) {
	return <p className={styles.notice}>{children}</p>;
}

const FORM_KEYBOARD = "trackForm";

export interface TrackDetailsProps {
	row: TrackColumns | null;
	isPending: boolean;
	failed?: boolean;
	members?: readonly Member[];
	addresses?: readonly TrackAddress[];
	isStream?: boolean;
	// The panel names none: it remounts the view for each opening and each close.
	trackKey?: string;
	// Called once the file holds a save's values, for a host that keeps the row it read.
	onSaved?: (fields: WriteFields) => void;
}

export function TrackDetails({
	row: hosted,
	isPending,
	failed = false,
	members,
	addresses = [],
	isStream = false,
	trackKey,
	onSaved,
}: TrackDetailsProps) {
	const t = useTranslate();
	const format = useFormats();
	const { hasWritableAddress, saveTags } = useTagWriting();

	const [editing, setEditing] = useState<Editing | null>(null);
	const [written, setWritten] = useState<{
		base: TrackColumns;
		fields: WriteFields;
	} | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const saving = useRef(false);

	const row =
		hosted && written?.base === hosted
			? rowWith(hosted, written.fields)
			: hosted;

	const permitted =
		isStream || !row
			? []
			: DETAIL_FIELDS.filter((field) =>
					hasWritableAddress(field.tag, addresses),
				);

	// While the form is open it owns Escape: a host listening on the window would otherwise close
	// itself over a form whose focus is on a chip or a button, neither of which counts as typing.
	useKeyboardOwnership(FORM_KEYBOARD, editing !== null);

	const { prompt, leave } = useDiscardGuard({
		isDirty: editing !== null && changesIn(editing).hasChanges,
		question: t("details.discardQuestion"),
	});

	const view = useRef<HTMLDivElement | null>(null);
	const refocusEdit = useRef(false);
	useEffect(() => {
		if (editing || !refocusEdit.current) return;
		refocusEdit.current = false;
		view.current
			?.querySelector<HTMLElement>("[data-edit]")
			?.focus({ preventScroll: true });
	}, [editing]);

	const startEditing = () => {
		if (!row) return;
		setFailure(null);
		setEditing(openForm(row, addresses, trackKey, permitted));
	};

	const stopEditing = () =>
		leave(() => {
			refocusEdit.current = true;
			setEditing(null);
		});

	const save = async () => {
		if (!editing || saving.current) return;

		const made = withPendingChips(editing);
		const { fields } = changesIn(made);
		setEditing(made);
		if (Object.keys(fields).length === 0) return;

		saving.current = true;
		setIsSaving(true);
		setFailure(null);
		const outcome = await saveTags(requestFor(made, fields));
		saving.current = false;
		setIsSaving(false);

		if (outcome.kind === "saved") {
			setWritten((earlier) =>
				writtenAfter(earlier, hosted, made.trackKey, trackKey, outcome.fields),
			);
			refocusEdit.current = true;
			setEditing(null);
			onSaved?.(outcome.fields);
		} else if (outcome.kind === "unconfirmed") {
			setFailure(t("details.saveUnconfirmed"));
		} else {
			setFailure(failureWords(outcome.failure, t));
		}
	};

	if (editing) {
		return (
			<>
				<TrackDetailsForm
					editing={editing}
					onChange={setEditing}
					onSubmit={() => void save()}
					onCancel={stopEditing}
					isSaving={isSaving}
					failure={failure}
					isNotPlaying={trackKey !== editing.trackKey}
				>
					{visibleGroups(editing.row, format, t)
						.filter((group) => group.title !== "details.group.release")
						.map((group) => (
							<GroupView key={group.title} group={group} members={members} />
						))}
				</TrackDetailsForm>
				{prompt}
			</>
		);
	}

	if (failed) return <DetailsNotice>{t("details.failed")}</DetailsNotice>;
	if (isPending) return <DetailsNotice>{t("details.reading")}</DetailsNotice>;
	if (!row) return null;

	return (
		<div ref={view} className={styles.details}>
			{permitted.length > 0 ? (
				<div className={styles.bar}>
					<Button data-edit="" onClick={startEditing}>
						{t("details.edit")}
					</Button>
				</div>
			) : null}
			{visibleGroups(row, format, t).map((group) => (
				<GroupView key={group.title} group={group} members={members} />
			))}
		</div>
	);
}
