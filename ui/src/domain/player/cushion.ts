export const CUSHION_MS = 250;
export const CUSHION_AFTER_STALL_MS = 1500;

// Holds what arrives while the element has nothing to play, and lets it all through once there is
// a cushion's worth. A connection with no stall behind it holds nothing until the first seek; a
// stall grows the cushion.
export class Cushion {
	private held: Uint8Array[] = [];
	private heldMs = 0;
	private filling: boolean;
	private goalMs: number;

	constructor(afterStall: boolean) {
		this.filling = afterStall;
		this.goalMs = afterStall ? CUSHION_AFTER_STALL_MS : CUSHION_MS;
	}

	add(chunk: Uint8Array, ms: number): Uint8Array[] {
		if (!this.filling) return [chunk];

		this.held.push(chunk);
		this.heldMs += ms;
		if (this.heldMs < this.goalMs) return [];

		const released = this.held;
		this.filling = false;
		this.held = [];
		this.heldMs = 0;
		return released;
	}

	stalled(): void {
		this.goalMs = CUSHION_AFTER_STALL_MS;
		this.filling = true;
	}

	flush(): void {
		this.filling = true;
		this.held = [];
		this.heldMs = 0;
	}
}
