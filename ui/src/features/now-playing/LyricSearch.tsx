import { useQueryClient } from "@tanstack/react-query";
import {
	AudioLines,
	Check,
	ChevronLeft,
	Piano,
	RefreshCw,
	Search,
	TextAlignStart,
	WifiOff,
} from "lucide-react";
import {
	type FormEvent,
	type MutableRefObject,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { orThrow } from "@/shared/api/client";
import { fetchStatus } from "@/shared/api/status";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { formatTime } from "@/shared/lib/time";
import { Button } from "@/shared/ui/Button";
import { LyricPreview } from "./LyricPreview";
import styles from "./LyricSearch.module.css";
import type { PanelVariant } from "./Lyrics";
import {
	kindOf,
	type LrclibKind,
	type LrclibRecord,
	rankRecords,
	searchLrclib,
} from "./lrclib";
import type { LyricDraft } from "./lyricDraft";
import {
	type LyricTarget,
	playingAgainst,
	useNowPlayingLyric,
} from "./useNowPlayingLyric";

const KINDS: LrclibKind[] = ["synced", "plain", "instrumental"];

const KIND_PHRASE = {
	synced: "lyrics.kindSynced",
	plain: "lyrics.kindPlain",
	instrumental: "lyrics.kindInstrumental",
} as const satisfies Record<LrclibKind, Phrase>;

const KIND_ICON = {
	synced: AudioLines,
	plain: TextAlignStart,
	instrumental: Piano,
} as const;

const SAME_LENGTH_S = 1;
const NEAR_LENGTH_S = 10;

type Closeness = "same" | "near" | "far";

const closenessOf = (apartSeconds: number): Closeness =>
	apartSeconds < SAME_LENGTH_S
		? "same"
		: apartSeconds <= NEAR_LENGTH_S
			? "near"
			: "far";

type Outcome =
	| { kind: "searching" }
	| { kind: "found"; records: LrclibRecord[] }
	| { kind: "failed"; isBusy: boolean };

interface Query {
	title: string;
	artist: string;
}

export interface SearchMemory {
	title: string;
	artist: string;
	sent: Query;
	outcome: Outcome;
	previewing: number | null;
}

// LRCLIB's `Lrclib-Client` header names the asking version, which `foo_jean`'s `GET /api/status` states.
const VERSION_KEY = ["componentVersion"];
const UNKNOWN_VERSION = "unknown";

function Difference({
	apart,
	closeness,
}: {
	apart: number;
	closeness: Closeness;
}) {
	const t = useTranslate();

	return closeness === "same" ? (
		<span className={styles.difference}>
			<Check size={12} strokeWidth={2.6} aria-hidden="true" />
			{t("lyrics.sameLength")}
		</span>
	) : (
		<span className={styles.difference}>
			{t(apart > 0 ? "lyrics.longer" : "lyrics.shorter", {
				seconds: Math.round(Math.abs(apart)),
			})}
		</span>
	);
}

function KindChip({ record }: { record: LrclibRecord }) {
	const t = useTranslate();
	const kind = kindOf(record);
	const KindIcon = KIND_ICON[kind];

	return (
		<span className={styles.chip} data-kind={kind}>
			<KindIcon size={12} strokeWidth={2.2} aria-hidden="true" />
			{t(KIND_PHRASE[kind])}
		</span>
	);
}

const apartFrom = (record: LrclibRecord, trackDuration: number | null) =>
	trackDuration === null ? null : record.duration - trackDuration;

function VersionName({ record }: { record: LrclibRecord }) {
	return (
		<span className={styles.versionTitle}>
			<span className={styles.versionName}>{record.trackName}</span>
			<KindChip record={record} />
		</span>
	);
}

function VersionByline({ record }: { record: LrclibRecord }) {
	return (
		<>
			{record.artistName}
			{record.albumName ? (
				<>
					<span className={styles.dash}> — </span>
					{record.albumName}
				</>
			) : null}
		</>
	);
}

function VersionSummary({
	record,
	trackDuration,
}: {
	record: LrclibRecord;
	trackDuration: number | null;
}) {
	const apart = apartFrom(record, trackDuration);

	return (
		<>
			<VersionName record={record} />
			<span className={styles.summaryDetail}>
				<span className={styles.versionDetail}>
					<VersionByline record={record} />
				</span>
				<span className={styles.length}>{formatTime(record.duration)}</span>
				{apart === null ? null : (
					<Difference apart={apart} closeness={closenessOf(Math.abs(apart))} />
				)}
			</span>
		</>
	);
}

function Version({
	record,
	trackDuration,
	onSelect,
}: {
	record: LrclibRecord;
	trackDuration: number | null;
	onSelect: (record: LrclibRecord) => void;
}) {
	const apart = apartFrom(record, trackDuration);
	const closeness = apart === null ? null : closenessOf(Math.abs(apart));

	return (
		<li className={styles.version} data-length={closeness ?? undefined}>
			<button
				type="button"
				className={styles.versionButton}
				onClick={() => onSelect(record)}
			>
				<VersionName record={record} />
				<span className={styles.versionDetail}>
					<VersionByline record={record} />
				</span>
				<span className={styles.versionLength}>
					<span className={styles.length}>{formatTime(record.duration)}</span>
					{apart === null || closeness === null ? null : (
						<Difference apart={apart} closeness={closeness} />
					)}
				</span>
			</button>
		</li>
	);
}

function Group({
	kind,
	records,
	trackDuration,
	onSelect,
}: {
	kind: LrclibKind;
	records: LrclibRecord[];
	trackDuration: number | null;
	onSelect: (record: LrclibRecord) => void;
}) {
	const t = useTranslate();
	const headingId = useId();

	return (
		<>
			<h3 id={headingId} className={styles.group}>
				{t(KIND_PHRASE[kind])} <span>{records.length}</span>
			</h3>
			<ul aria-labelledby={headingId} className={styles.versions}>
				{records.map((record) => (
					<Version
						key={record.id}
						record={record}
						trackDuration={trackDuration}
						onSelect={onSelect}
					/>
				))}
			</ul>
		</>
	);
}

function Notice({
	icon,
	title,
	children,
	action,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className={styles.notice} role="status">
			{icon}
			<p className={styles.noticeTitle}>{title}</p>
			<p className={styles.noticeHint}>{children}</p>
			{action}
		</div>
	);
}

export function LyricSearch({
	target,
	variant,
	snapshot,
	onBack,
	onOpenEditor,
	memory,
	className,
}: {
	target: LyricTarget;
	variant: PanelVariant;
	snapshot: PlayerSnapshot | null | undefined;
	onBack: () => void;
	onOpenEditor: (draft: LyricDraft) => void;
	memory: MutableRefObject<SearchMemory | null>;
	className?: string;
}) {
	const t = useTranslate();
	const { save } = useNowPlayingLyric();
	const [restored] = useState(() =>
		memory.current?.outcome.kind === "searching" ? null : memory.current,
	);
	const [previewing, setPreviewing] = useState<number | null>(
		restored?.previewing ?? null,
	);
	const queryClient = useQueryClient();
	const { discovery } = useFooJean();
	const { origin } = discovery;

	const [title, setTitle] = useState(restored?.title ?? target.title);
	const [artist, setArtist] = useState(restored?.artist ?? target.artist ?? "");
	const [outcome, setOutcome] = useState<Outcome>(
		restored?.outcome ?? { kind: "searching" },
	);
	const sent = useRef<Query>(
		restored?.sent ?? { title: target.title, artist: target.artist ?? "" },
	);

	useEffect(() => {
		memory.current = {
			title,
			artist,
			sent: sent.current,
			outcome,
			previewing,
		};
	}, [memory, title, artist, outcome, previewing]);
	const latest = useRef(0);

	const run = useCallback(
		async (query: Query) => {
			const mine = ++latest.current;
			sent.current = query;
			setOutcome({ kind: "searching" });
			setPreviewing(null);

			const version = await queryClient
				.fetchQuery({
					queryKey: VERSION_KEY,
					staleTime: Infinity,
					queryFn: async () => {
						if (!origin) throw new Error("foo_jean is not discovered");
						return orThrow(await fetchStatus(origin)).version;
					},
				})
				.catch(() => UNKNOWN_VERSION);
			const answer = await searchLrclib(query, { version });
			if (mine !== latest.current) return;

			setOutcome(
				answer.ok
					? { kind: "found", records: answer.value }
					: { kind: "failed", isBusy: answer.error === "busy" },
			);
		},
		[queryClient, origin],
	);

	// StrictMode mounts twice in development; a ref survives that.
	const started = useRef(false);
	useEffect(() => {
		if (started.current || restored) return;
		started.current = true;
		void run(sent.current);
	}, [run, restored]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (title.trim() === "") return;
		void run({ title: title.trim(), artist: artist.trim() });
	};

	const ranked = useMemo(
		() =>
			outcome.kind === "found"
				? rankRecords(outcome.records, target.duration)
				: [],
		[outcome, target.duration],
	);

	const previewed = previewing === null ? null : (ranked[previewing] ?? null);

	const saveVersion = async (text: string) => {
		const saved = await save(target, text);
		if (saved) onBack();
		return saved;
	};

	return (
		<>
			{previewed && previewing !== null ? (
				<LyricPreview
					key={previewed.id}
					className={className}
					record={previewed}
					index={previewing}
					total={ranked.length}
					variant={variant}
					snapshot={snapshot}
					title={target.title}
					isPlayingTarget={playingAgainst(target, snapshot).isPlayingTarget}
					backLabel={t("lyrics.versionCount", { count: ranked.length })}
					summary={
						<VersionSummary
							record={previewed}
							trackDuration={target.duration}
						/>
					}
					onBack={() => setPreviewing(null)}
					onPrevious={() => setPreviewing(previewing - 1)}
					onNext={() => setPreviewing(previewing + 1)}
					onSave={saveVersion}
					onOpenEditor={onOpenEditor}
				/>
			) : null}
			<section
				className={classNames(styles.view, className)}
				aria-label={t("lyrics.versionsOn")}
				hidden={previewed !== null}
			>
				<div className={styles.head}>
					<button
						type="button"
						className={styles.back}
						aria-label={t("lyrics.backToLyrics")}
						onClick={onBack}
					>
						<ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
						{t("panel.lyrics")}
					</button>
					<span className={styles.where}>{t("lyrics.versionsOn")}</span>
				</div>

				<form className={styles.query} onSubmit={submit}>
					<label className={styles.field}>
						<span className={styles.fieldLabel}>{t("lyrics.queryTitle")}</span>
						<input
							value={title}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
					<label className={classNames(styles.field, styles.narrow)}>
						<span className={styles.fieldLabel}>{t("lyrics.queryArtist")}</span>
						<input
							value={artist}
							onChange={(event) => setArtist(event.target.value)}
						/>
					</label>
					<Button type="submit" icon={Search} className={styles.again}>
						{t("lyrics.searchAgain")}
					</Button>
				</form>

				{outcome.kind === "searching" ? (
					<p className={styles.status} role="status">
						{t("lyrics.searching")}
					</p>
				) : null}

				{outcome.kind === "failed" ? (
					<Notice
						icon={<WifiOff size={26} strokeWidth={1.5} aria-hidden="true" />}
						title={t("lyrics.searchFailed")}
						action={
							<Button
								icon={RefreshCw}
								className={styles.again}
								onClick={() => void run(sent.current)}
							>
								{t("lyrics.tryAgain")}
							</Button>
						}
					>
						{t(
							outcome.isBusy ? "lyrics.searchBusy" : "lyrics.searchFailedHint",
						)}
					</Notice>
				) : null}

				{outcome.kind === "found" && ranked.length === 0 ? (
					<Notice
						icon={<Search size={26} strokeWidth={1.5} aria-hidden="true" />}
						title={t("lyrics.searchEmpty")}
					>
						{t("lyrics.searchEmptyHint")}
					</Notice>
				) : null}

				{ranked.length > 0 ? (
					<>
						<p className={styles.tally} role="status">
							{target.duration === null ? (
								<Trans
									phrase="lyrics.versionsTallyNoLength"
									versions={
										<b>{t("lyrics.versionCount", { count: ranked.length })}</b>
									}
								/>
							) : (
								<Trans
									phrase="lyrics.versionsTally"
									versions={
										<b>{t("lyrics.versionCount", { count: ranked.length })}</b>
									}
									duration={formatTime(target.duration)}
								/>
							)}
						</p>
						{KINDS.map((kind) => {
							const records = ranked.filter(
								(record) => kindOf(record) === kind,
							);
							return records.length === 0 ? null : (
								<Group
									key={kind}
									kind={kind}
									records={records}
									trackDuration={target.duration}
									onSelect={(record) => setPreviewing(ranked.indexOf(record))}
								/>
							);
						})}
					</>
				) : null}
			</section>
		</>
	);
}
