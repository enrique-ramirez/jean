const MAX_UNSIGNED_64 = 2n ** 64n - 1n;

export const readsAsCount = (value: string) =>
	/^\d{1,20}$/.test(value) && BigInt(value) <= MAX_UNSIGNED_64;
