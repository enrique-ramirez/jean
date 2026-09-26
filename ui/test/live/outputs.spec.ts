import {
	capabilities,
	type OutputDevice,
	outputs,
	player,
	switchOutput,
} from "./component.ts";
import { expect, test } from "./fixtures.ts";

// Switching the player's output device on a real foobar2000, as far as a client can drive it. A
// switch made at the player, a device unplugged with the picker open, and whether foobar2000's own
// Preferences shows the same device are left for a person.
//
// foobar2000 keeps the volume and the mute per output device, so a device switched to can come up
// unmuted at full level. Nothing here starts playback, and it refuses to start unless the player
// is already stopped.
//
// `changeOutput` in the component's config.json decides which half runs: the switches with it on,
// the refusal with it off. Run the file once each way.

// foobar2000's own null output has no hardware behind it, so it is never one of the three.
const NULL_OUTPUT = "Null Output";
const SWITCHED = 3;

// A refused switch has nothing to wait for, so its absence is read several times over a window
// longer than the tens of milliseconds a switch takes to reach the poll.
const QUIET_READS = 5;
const QUIET_GAP_MS = 200;

// Two GUIDs the way foobar2000 prints them: upper case, no braces.
const GUID = "[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}";
const DEVICE_ID = new RegExp(`^${GUID}:${GUID}$`);

const UNISSUED_ID = "live-check:no-such-output-device";

interface Owner {
	deviceId: string;
	volume: number;
	muted: boolean;
}

let owner: Owner | null = null;

const reported = async () => {
	const [{ outputDeviceId }, { active }] = await Promise.all([
		player(),
		outputs(),
	]);
	return { polled: outputDeviceId, listed: active };
};

// Throws rather than retrying: a player found playing mid-run is sending sound to whatever device
// was switched to last, at that device's own level.
const requireStopped = async () => {
	const { playback } = await player();
	if (playback !== "stopped")
		throw new Error(`the player is ${playback}; stopping the run here`);
};

const switchTo = async (device: OutputDevice) => {
	const answer = await switchOutput(device.id);
	expect(answer.status, `switching to ${device.name}`).toBe(204);
	await requireStopped();
	await expect
		.poll(reported, { message: `after switching to ${device.name}` })
		.toEqual({ polled: device.id, listed: device.id });
	console.log(`[outputs] on ${device.name}: ${device.id}`);
};

const expectNothingMoved = async (from: string) => {
	const seen: Awaited<ReturnType<typeof reported>>[] = [];
	for (let read = 0; read < QUIET_READS; read++) {
		seen.push(await reported());
		await new Promise((done) => setTimeout(done, QUIET_GAP_MS));
	}
	expect(seen).toEqual(Array(QUIET_READS).fill({ polled: from, listed: from }));
};

// The owner's device first where it is one of the three, so the walk starts where the player was.
const threeToWalk = (devices: OutputDevice[], active: string) => {
	const real = devices.filter((device) => device.name !== NULL_OUTPUT);
	const own = real.filter((device) => device.id === active);
	const others = real.filter((device) => device.id !== active);
	return [...own, ...others].slice(0, SWITCHED);
};

test.beforeAll(async () => {
	const before = await player();
	if (before.playback !== "stopped")
		throw new Error(
			"Stop the player first: a device switched to comes up at its own level.",
		);
	const { active } = await outputs();
	if (active === null || before.outputDeviceId !== active)
		throw new Error(
			`Put the player on a device it lists first, or it cannot be put back: GET /api/outputs says ${active}, GET /api/state says ${before.outputDeviceId}.`,
		);
	owner = { deviceId: active, volume: before.volume, muted: before.muted };
});

// Runs whatever failed above it, and again after every failure, since a failure starts a fresh
// worker: every device switched to is the player's real output until this puts the owner's back.
test.afterAll(async () => {
	if (!owner) return;
	const now = await reported();
	if (now.polled !== owner.deviceId || now.listed !== owner.deviceId) {
		const answer = await switchOutput(owner.deviceId);
		console.log(
			`[outputs] putting back ${owner.deviceId}: ${answer.status} ${answer.error ?? ""}`,
		);
	}
	const after = await player();
	console.log(
		`[outputs] left on ${after.outputDeviceId}, ${after.volume} dB, muted ${after.muted}, ${after.playback}`,
	);
	expect(after.outputDeviceId).toBe(owner.deviceId);
	expect({ volume: after.volume, muted: after.muted }).toEqual({
		volume: owner.volume,
		muted: owner.muted,
	});
});

test("every device the player lists has its own id, two GUIDs printed the way foobar2000 prints them and joined by a colon", async () => {
	const { devices } = await outputs();
	for (const device of devices)
		console.log(`[outputs] listed: ${device.name}: ${device.id}`);

	expect(devices.filter((device) => !DEVICE_ID.test(device.id))).toEqual([]);
	expect(new Set(devices.map((device) => device.id)).size).toBe(devices.length);
});

test("three outputs switched through and back are each reported active by both the poll and the device list", async () => {
	const allowed = await capabilities();
	test.skip(
		!allowed.canChangeOutput,
		"changeOutput is off in config.json; this half runs with it on",
	);

	const { devices, active } = await outputs();
	const three = threeToWalk(devices, active as string);
	expect(
		three.length,
		`the player lists ${devices.length} devices, and three that are not ${NULL_OUTPUT} are needed`,
	).toBe(SWITCHED);
	const [first, second, third] = three;

	await test.step("forward", async () => {
		await switchTo(first);
		await switchTo(second);
		await switchTo(third);
	});
	await test.step("back", async () => {
		await switchTo(second);
		await switchTo(first);
	});
});

// The second id differs from a listed one by a trailing character only, so a player matched on a
// prefix, or on the output module alone, would take it as that device.
test("an id the player never listed is refused with a 409 and the device stays where it was", async () => {
	const allowed = await capabilities();
	test.skip(
		!allowed.canChangeOutput,
		"changeOutput is off in config.json; this half runs with it on",
	);

	const { devices, active } = await outputs();
	const from = active as string;
	const other = devices.find((device) => device.id !== from);
	expect(other, "the player lists a second device").toBeDefined();

	for (const deviceId of [UNISSUED_ID, `${(other as OutputDevice).id}0`]) {
		const answer = await switchOutput(deviceId);
		console.log(`[outputs] ${deviceId}: ${answer.status} ${answer.error}`);
		expect(answer.status, deviceId).toBe(409);
		await expectNothingMoved(from);
	}
});

test("with changeOutput off in config.json a switch is refused with a 403 naming the key and the file, the device stays, and the list still answers", async () => {
	const allowed = await capabilities();
	test.skip(
		allowed.canChangeOutput,
		"changeOutput is on in config.json; this case runs with it off",
	);

	const { devices, active } = await outputs();
	const from = active as string;
	const other = devices.find((device) => device.id !== from);
	expect(other, "the player lists a second device").toBeDefined();

	const answer = await switchOutput((other as OutputDevice).id);
	console.log(
		`[outputs] with changeOutput off: ${answer.status} ${answer.error}`,
	);
	expect(answer.status).toBe(403);
	expect(answer.error).toContain("changeOutput");
	expect(answer.error).toContain("config.json");
	await expectNothingMoved(from);
});
