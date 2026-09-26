export interface FollowRevisionOptions<T> {
	resource: string;
	read: (origin: string) => Promise<T | null>;
	apply: (value: T, revision: number) => void;
	active?: () => boolean;
}

export interface FollowRevision {
	announce(origin: string, revision: number): void;
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

	async function readOnce(): Promise<void> {
		const target = desired;
		const readOrigin = origin;
		const startedAt = generation;
		if (target === null || readOrigin === null) return;

		reading = true;
		const value = await read(readOrigin);
		if (startedAt !== generation) return;
		reading = false;

		if (value === null) {
			if (!failing) {
				console.error(
					`foo_jean did not answer a read of the ${resource} from ${readOrigin}`,
				);
				failing = true;
			}
			return;
		}

		failing = false;
		held = target;
		apply(value, target);
		if (desired !== held) void readOnce();
	}

	return {
		announce(nextOrigin, revision) {
			if (active && !active()) return;
			origin = nextOrigin;
			desired = revision;
			if (held === revision || reading) return;
			void readOnce();
		},
		forget() {
			generation += 1;
			reading = false;
			held = null;
			desired = null;
			failing = false;
		},
	};
}
