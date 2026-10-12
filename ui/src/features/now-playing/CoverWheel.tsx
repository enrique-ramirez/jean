import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { ASKED_MS, takeSkipAsked } from "@/shared/api/playback";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./CoverWheel.module.css";

const STEP = 22;
const REACH = 0.45;
const GIVE = 0.15;
const FLICK_PX = 50;

interface Sleeve {
	src: string;
	identity?: string;
}

export interface NeighbourArtwork {
	src: string;
	identity: string;
}

const nodeOf = (at: number) => ((at % 3) + 3) % 3;

export function useCoverWheel({
	audibleTrackKey,
	audibleCover,
	playerTrackKey,
	artwork,
	neighbourArtworkSrc,
	alt,
	nextArtwork,
	previousArtwork,
	onSkip,
}: {
	audibleTrackKey: string | null;
	// What the audible picture *is*. `audibleTrackKey` is a playlist position and says only that the
	// track changed; it must never reach the cache as an identity.
	audibleCover: string | undefined;
	playerTrackKey: string | null;
	// `undefined` is the address not resolved yet, same as `Artwork`'s own `src`: nothing is
	// committed to a slot until this is truthy, so a canonicalising caller can leave it unset
	// rather than reach for the off-library fallback while the read it needs is still in flight.
	artwork: string | null | undefined;
	// The address a neighbour would have fetched this same track under. A slot already showing a
	// sleeve from that address is showing the right picture and must be left alone.
	neighbourArtworkSrc: string | null;
	alt: string;
	nextArtwork: NeighbourArtwork | null;
	previousArtwork: NeighbourArtwork | null;
	onSkip: (by: number) => boolean;
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

	const paintTurn = useCallback(() => {
		ref.current?.style.setProperty(
			"--turn",
			`${settled.current + dragging.current}deg`,
		);
	}, []);

	const followFinger = useCallback(() => {
		ref.current?.setAttribute("data-free", "");
		paintTurn();
	}, [paintTurn]);

	const easeToRest = useCallback(() => {
		ref.current?.removeAttribute("data-free");
		paintTurn();
	}, [paintTurn]);

	const attach = useCallback(
		(node: HTMLDivElement | null) => {
			ref.current = node;
			if (node) easeToRest();
		},
		[easeToRest],
	);

	const turnTo = useCallback(
		(at: number) => {
			settled.current = -at * STEP;
			setPosition(at);
			easeToRest();
		},
		[easeToRest],
	);

	const seen = useRef<string | null>(null);
	const centre = useRef<number | null>(null);
	useEffect(() => {
		if (!audibleTrackKey || audibleTrackKey === seen.current) return;
		const isFirst = seen.current === null;
		seen.current = audibleTrackKey;

		const asked = unanswered.current;
		const outside = takeSkipAsked();
		const at = asked
			? asked.to
			: isFirst
				? position
				: position + (outside ?? 1);
		centre.current = at;

		if (asked) {
			unanswered.current = null;
			setIsAwaiting(false);
			if (undo.current) clearTimeout(undo.current);
		} else if (!isFirst) {
			turnTo(at);
		}
	}, [audibleTrackKey, position, turnTo]);

	// Runs again on its own once `artwork` catches up: the poll that names the track lands a beat
	// after the position it plays at, so the first pass here can find nothing to draw yet.
	// biome-ignore lint/correctness/useExhaustiveDependencies: audibleTrackKey re-fires this for the new centre, not a read
	useEffect(() => {
		const at = centre.current;
		if (at === null) return;

		setSleeves((held) => {
			if (held[at]?.src === neighbourArtworkSrc) return held;
			if (!artwork) return held;
			if (held[at]?.src === artwork && held[at]?.identity === audibleCover)
				return held;
			return { ...held, [at]: { src: artwork, identity: audibleCover } };
		});
	}, [audibleTrackKey, artwork, audibleCover, neighbourArtworkSrc]);

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
			for (const [at, neighbour] of [
				[position + 1, nextArtwork],
				[position - 1, previousArtwork],
			] as const) {
				if (!neighbour || filled[at]) continue;
				filled[at] = { src: neighbour.src, identity: neighbour.identity };
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
			followFinger();
		},
		[followFinger],
	);

	const skip = useCallback(
		(by: number): boolean => {
			if (!onSkip(by)) return false;
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
			}, ASKED_MS);
			return true;
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
				easeToRest();
				return;
			}

			if (!skip(dx < 0 ? 1 : -1)) easeToRest();
		},
		[skip, easeToRest],
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
			alt: at === position && !isAwaiting ? alt : "",
		})),
	};
}

export function CoverWheel({
	ref,
	slots,
}: Pick<ReturnType<typeof useCoverWheel>, "ref" | "slots">) {
	return (
		<div className={styles.wheel} ref={ref} data-cover-wheel="">
			{slots.map(({ at, node, sleeve, isCurrent, alt }) => (
				<div
					key={node}
					className={styles.slot}
					style={{ "--at": at } as CSSProperties}
					data-current={isCurrent || undefined}
				>
					<Artwork
						src={sleeve?.src}
						identity={sleeve?.identity}
						alt={alt}
						className={styles.cover}
						revealsInstantly={!isCurrent}
					/>
				</div>
			))}
		</div>
	);
}
