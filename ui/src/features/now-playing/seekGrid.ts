const READOUT_GRAIN_SECONDS = 0.5;

export function seekGrid(duration: number, devicePixels: number) {
	const stepsPerGrain =
		duration > 0
			? Math.max(
					1,
					Math.ceil((READOUT_GRAIN_SECONDS * devicePixels) / duration),
				)
			: 1;
	const stepsPerSecond = stepsPerGrain / READOUT_GRAIN_SECONDS;

	return (at: number) => Math.floor(at * stepsPerSecond) / stepsPerSecond;
}
