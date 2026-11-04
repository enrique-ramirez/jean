import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWait } from "@/domain/library/useOverdue";
import { DETAIL_EXPRESSIONS } from "@/domain/track/detailFields";
import type { DetailsAsked } from "@/domain/track/showDetails";
import { TrackDetails } from "@/domain/track/TrackDetails";
import { isStreamPath } from "@/domain/track/trackPath";
import { readTrackColumns } from "@/domain/track/trackRead";
import { fooJeanOrigin } from "@/shared/api/discovery";
import { PLAYER_JOINER } from "@/shared/api/multiValue";
import type { WriteFields } from "@/shared/api/tags";
import type { TrackAddress, TrackColumns } from "@/shared/api/types";
import { useEscapeCapture } from "@/shared/hooks/useEscapeCapture";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { leaveGuarded } from "@/shared/hooks/useLeaveGuard";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { useKeyboardOwner } from "@/shared/keyboard/keyboardOwner";
import styles from "./DetailsPanel.module.css";

const STALE_STRUCTURE = 409;

// Asked for after the details' own columns, to tell a station from a file: the list's rows carry no path.
const PATH_COLUMN = DETAIL_EXPRESSIONS.length;
const COLUMNS = [...DETAIL_EXPRESSIONS, "%path%"];

// The forms come in the order the row's source prefers them. A refusal for a structure the player
// has moved past is the one answer another form can mend; any other failure is the answer.
async function readTrack(
	origin: string,
	addresses: readonly TrackAddress[],
): Promise<TrackColumns | null> {
	for (const address of addresses) {
		const answer = await readTrackColumns(origin, address, COLUMNS);
		if (answer.ok) return answer.columns;
		if (answer.reason !== "refused" || answer.status !== STALE_STRUCTURE)
			return null;
	}
	return null;
}

interface Answered {
	key: string;
	row: TrackColumns | null;
}

export function DetailsPanel({
	asked,
	isOpen,
	isCompactViewport,
	onDismiss,
}: {
	asked: DetailsAsked | null;
	isOpen: boolean;
	isCompactViewport: boolean;
	onDismiss: () => void;
}) {
	const t = useTranslate();
	const { discovery } = useFooJean();
	const origin = fooJeanOrigin(discovery);

	const [attempt, setAttempt] = useState(0);
	const [answered, setAnswered] = useState<Answered | null>(null);

	const key = asked ? `${asked.id}:${attempt}` : null;
	const addresses = asked?.addresses;

	useEffect(() => {
		if (!isOpen || !origin || !addresses || !key) return;
		let isCurrent = true;
		void readTrack(origin, addresses).then((row) => {
			if (isCurrent) setAnswered({ key, row });
		});
		return () => {
			isCurrent = false;
		};
	}, [isOpen, origin, addresses, key]);

	const settled = answered?.key === key ? answered : null;
	const wait = useWait(isOpen && asked !== null && !settled, key ?? "");
	const failed = settled !== null && settled.row === null;

	const keyboardOwner = useKeyboardOwner();

	const close = useCallback(
		() =>
			leaveGuarded(() => {
				onDismiss();
				asked?.returnFocus?.focus({ preventScroll: true });
			}),
		[onDismiss, asked],
	);

	useEscapeCapture(isOpen && keyboardOwner === null ? close : null);

	const swipe = useSwipe({ onRight: close });

	const [saved, setSaved] = useState<{
		id: number;
		title?: string;
		artist?: string;
	} | null>(null);
	const formLife = `${asked?.id}:${isOpen}`;
	const own = saved?.id === asked?.id ? saved : null;
	const named = {
		title: own?.title ?? asked?.title ?? "",
		artist: own?.artist ?? asked?.artist ?? "",
	};
	const noteSaved = (fields: WriteFields) => {
		if (!asked) return;
		const joined = (value: string | string[] | undefined) =>
			typeof value === "string" ? value : value?.join(PLAYER_JOINER);
		const title = joined(fields.TITLE);
		const artist = joined(fields.ARTIST);
		setSaved((earlier) => ({
			...(earlier?.id === asked.id ? earlier : { id: asked.id }),
			...(title !== undefined ? { title } : null),
			...(artist !== undefined ? { artist } : null),
		}));
	};

	const focusHeading = useCallback(
		(heading: HTMLElement | null) => {
			if (heading && isOpen) heading.focus({ preventScroll: true });
		},
		[isOpen],
	);

	// A closed panel waits out its slide off the edge and is then taken out of the page, so nothing
	// of it is left to reach. Opening unparks it in the same render and slides it in a frame later,
	// once the style it slides from has been computed.
	const [isParked, setParked] = useState(!isOpen);
	if (isOpen && isParked) setParked(false);
	const panel = useRef<HTMLElement | null>(null);
	const [isSlidIn, setSlidIn] = useState(false);
	useEffect(() => {
		if (!isOpen) {
			setSlidIn(false);
			return undefined;
		}
		const frame = requestAnimationFrame(() => {
			void panel.current?.offsetWidth;
			setSlidIn(true);
		});
		return () => cancelAnimationFrame(frame);
	}, [isOpen]);

	return (
		<>
			{isCompactViewport && isOpen ? (
				<button
					type="button"
					className={styles.scrim}
					aria-label={t("details.close")}
					onClick={close}
				/>
			) : null}

			<section
				className={styles.panel}
				ref={panel}
				data-open={isOpen && isSlidIn}
				style={isParked ? { display: "none" } : undefined}
				onTransitionEnd={(event) => {
					if (!isOpen && event.target === event.currentTarget) setParked(true);
				}}
				aria-label={t("details.panelTitle")}
				{...swipe}
				inert={isOpen ? undefined : true}
			>
				<header className={styles.header}>
					{asked ? (
						<div className={styles.heading}>
							<h2
								key={asked.id}
								ref={focusHeading}
								className={styles.title}
								tabIndex={-1}
							>
								{named.title}
							</h2>
							<p className={styles.artist}>{named.artist}</p>
						</div>
					) : (
						<div className={styles.heading} />
					)}

					<button
						type="button"
						className={styles.close}
						aria-label={t("details.close")}
						onClick={close}
					>
						<X size={17} strokeWidth={2} />
					</button>
				</header>

				<div className={styles.scroller}>
					{asked ? (
						<TrackDetails
							key={formLife}
							row={settled?.row ?? null}
							isPending={wait.isOverdue}
							failed={failed}
							addresses={asked.addresses}
							onSaved={noteSaved}
							isStream={isStreamPath(settled?.row?.[PATH_COLUMN])}
						/>
					) : null}

					{failed ? (
						<button
							type="button"
							className={styles.retry}
							onClick={() => setAttempt((count) => count + 1)}
						>
							{t("action.tryAgain")}
						</button>
					) : null}
				</div>
			</section>
		</>
	);
}
