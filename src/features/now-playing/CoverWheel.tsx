import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { takeSkipAsked } from "@/shared/api/beefweb";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./CoverWheel.module.css";

const STEP = 22;
const REACH = 0.45;
const GIVE = 0.15;
const FLICK_PX = 50;
const UNANSWERED_MS = 4000;

interface Sleeve {
	src: string;
	// `null` where the sleeve is a guess rather than a known picture: a prefilled neighbour is only
	// *probably* the next track, so nothing about it may be kept under its address.
	identity?: string | null;
	alt: string;
}

// Three nodes serve every position on the rim, so sleeves are recycled rather than remounted: a touch whose target
// leaves the document stops being delivered.
const nodeOf = (at: number) => ((at % 3) + 3) % 3;

export function useCoverWheel({
	audibleTrackKey,
	audibleCover,
	playerTrackKey,
	artwork,
	alt,
	nextArtwork,
	previousArtwork,
	onSkip,
}: {
	audibleTrackKey: string | null;
	// What the audible picture *is*. `audibleTrackKey` is a playlist position and says only that the
	// track changed; it must never reach the cache as an identity.
	audibleCover: string | null;
	playerTrackKey: string | null;
	artwork: string | null;
	alt: string;
	nextArtwork: string | null;
	previousArtwork: string | null;
	onSkip: (by: number) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState(0);
	const [sleeves, setSleeves] = useState<Record<number, Sleeve>>({});
	const [isAwaiting, setIsAwaiting] = useState(false);

	const settled = useRef(0);
	const dragging = useRef(0);
	const reach = useRef(0);
	const unanswered = useRef<{ to: number; from: number } | null>(null);
	const undo = useRef<ReturnType<typeof setTimeout> | null>(null);

	const paint = useCallback((isFree: boolean) => {
		const wheel = ref.current;
		if (!wheel) return;
		wheel.toggleAttribute("data-free", isFree);
		wheel.style.setProperty(
			"--turn",
			`${settled.current + dragging.current}deg`,
		);
	}, []);

	const attach = useCallback(
		(node: HTMLDivElement | null) => {
			ref.current = node;
			if (node) paint(false);
		},
		[paint],
	);

	const turnTo = useCallback(
		(at: number) => {
			settled.current = -at * STEP;
			setPosition(at);
			paint(false);
		},
		[paint],
	);

	const seen = useRef<string | null>(null);
	useEffect(() => {
		if (!audibleTrackKey || audibleTrackKey === seen.current) return;
		const isFirst = seen.current === null;
		seen.current = audibleTrackKey;

		const sleeve = artwork
			? { src: artwork, alt, identity: audibleCover }
			: null;
		const asked = unanswered.current;
		const outside = takeSkipAsked();

		if (asked) {
			unanswered.current = null;
			setIsAwaiting(false);
			if (undo.current) clearTimeout(undo.current);
			if (sleeve) setSleeves((held) => ({ ...held, [asked.to]: sleeve }));
			return;
		}

		const at = isFirst ? position : position + (outside ?? 1);
		if (!isFirst) turnTo(at);
		if (sleeve) setSleeves((held) => ({ ...held, [at]: sleeve }));
	}, [audibleTrackKey, audibleCover, artwork, alt, position, turnTo]);

	const confirmed = useRef<string | null>(null);
	useEffect(() => {
		if (!playerTrackKey || playerTrackKey === confirmed.current) return;
		confirmed.current = playerTrackKey;
		if (undo.current) clearTimeout(undo.current);
	}, [playerTrackKey]);

	useEffect(() => {
		setSleeves((held) => {
			const filled = { ...held };
			let added = false;
			for (const [at, src] of [
				[position + 1, nextArtwork],
				[position - 1, previousArtwork],
			] as const) {
				if (!src || filled[at]) continue;
				filled[at] = { src, alt: "", identity: null };
				added = true;
			}
			return added ? filled : held;
		});
	}, [nextArtwork, previousArtwork, position]);

	useEffect(
		() => () => {
			if (undo.current) clearTimeout(undo.current);
		},
		[],
	);

	const onDrag = useCallback(
		(dx: number) => {
			const wheel = ref.current;
			if (!wheel) return;
			if (!reach.current)
				reach.current = (wheel.clientWidth || window.innerWidth) * REACH;

			const of = dx / reach.current;
			const past = Math.max(0, Math.abs(of) - 1);
			dragging.current =
				Math.sign(of) * (Math.min(Math.abs(of), 1) + past * GIVE) * STEP;
			paint(true);
		},
		[paint],
	);

	const skip = useCallback(
		(by: number) => {
			const to = position + by;
			turnTo(to);

			unanswered.current = { to, from: position };
			setIsAwaiting(true);
			if (undo.current) clearTimeout(undo.current);
			undo.current = setTimeout(() => {
				const pending = unanswered.current;
				if (!pending) return;
				unanswered.current = null;
				setIsAwaiting(false);
				turnTo(pending.from);
			}, UNANSWERED_MS);

			onSkip(by);
		},
		[position, onSkip, turnTo],
	);

	const onDragEnd = useCallback(
		(dx: number, wasFlick: boolean) => {
			const across = reach.current;
			reach.current = 0;
			dragging.current = 0;

			const far = across > 0 && Math.abs(dx / across) >= 0.5;
			const flicked = wasFlick && Math.abs(dx) >= FLICK_PX;
			if (!far && !flicked) {
				paint(false);
				return;
			}

			skip(dx < 0 ? 1 : -1);
		},
		[skip, paint],
	);

	return {
		ref: attach,
		isAwaiting,
		skip,
		onDrag,
		onDragEnd,
		slots: [position - 1, position, position + 1].map((at) => ({
			at,
			node: nodeOf(at),
			sleeve: sleeves[at] ?? null,
			isCurrent: at === position,
		})),
	};
}

export function CoverWheel({
	ref,
	slots,
}: Pick<ReturnType<typeof useCoverWheel>, "ref" | "slots">) {
	return (
		<div className={styles.wheel} ref={ref} data-cover-wheel="">
			{slots.map(({ at, node, sleeve, isCurrent }) => (
				<div
					key={node}
					className={styles.slot}
					style={{ "--at": at } as CSSProperties}
					data-current={isCurrent || undefined}
				>
					<Artwork
						src={sleeve?.src}
						identity={sleeve?.identity}
						alt={sleeve?.alt ?? ""}
						className={styles.cover}
					/>
				</div>
			))}
		</div>
	);
}
