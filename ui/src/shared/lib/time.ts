export function formatTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	const pad = (value: number) => String(value).padStart(2, "0");

	return hours > 0
		? `${hours}:${pad(minutes)}:${pad(total % 60)}`
		: `${minutes}:${pad(total % 60)}`;
}
