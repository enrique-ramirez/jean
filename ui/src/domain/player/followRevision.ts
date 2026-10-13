import type { Result } from "@/shared/api/client";

export interface FollowRevisionOptions<T> {
	resource: string;
	read: (origin: string) => Promise<Result<T>>;
	apply: (value: T, revision: number) => void;
	active?: () => boolean;
}

export interface FollowRevision {
	announce(origin: string, revision: number): void;
	settled(): Promise<void>;
	forget(): void;
}

export function followRevision<T>({
	resource,
	read,
	apply,
	active,
}: FollowRevisionOptions<T>): FollowRevision {
	let origin: string | null = null;
	let desired: number | null = null;
	let held: number | null = null;
	let reading = false;
	let failing = false;
	let generation = 0;
	let lastRead: Promise<void> = Promise.resolve();

	async function readOnce(): Promise<void> {
		const target = desired;
		const readOrigin = origin;
		const startedAt = generation;
		if (target === null || readOrigin === null) return;

		reading = true;
		const answer = await read(readOrigin);
		if (startedAt !== generation) return;
		reading = false;

		if (!answer.ok) {
			if (!failing) {
				console.error(
					`foo_jean did not answer a read of the ${resource} from ${readOrigin}: ${answer.message}`,
				);
				failing = true;
			}
			return;
		}

		failing = false;
		held = target;
		apply(answer.value, target);
		if (desired !== held) await readOnce();
	}

	return {
		announce(nextOrigin, revision) {
			if (active && !active()) return;
			origin = nextOrigin;
			desired = revision;
			if (held === revision || reading) return;
			lastRead = readOnce();
		},
		settled: () => lastRead,
		forget() {
			generation += 1;
			reading = false;
			held = null;
			desired = null;
			failing = false;
		},
	};
}
