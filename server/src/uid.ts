const TICK_MULTIPLIER = 10_000n;
const COUNTER_MAX = TICK_MULTIPLIER - 1n;
const JAN1_2023_MS = Date.UTC(2023, 0, 1);
const BASE64_CHARS = "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$";
const BASE64_LOOKUP = new Map(BASE64_CHARS.split("").map((ch, idx) => [ch, idx]));
const SIX_BIT_MASK = 0x3fn;
const TWO_TO_64 = 1n << 64n;
const TWO_TO_63 = 1n << 63n;
const BITS_PER_SYMBOL = 6n;
const MAX_DIGITS = 11;

let lastTick = 0n;
let counter = 0n;

function currentTick(): bigint {
  const msSince = BigInt(Date.now() - JAN1_2023_MS);
  return msSince * TICK_MULTIPLIER;
}

export function generateUid(): string {
	return intToUid(generateUidInt());
}

export function generateUidInt(): bigint {
  const tick = currentTick();
  if (tick === lastTick) {
    counter += 1n;
    if (counter > COUNTER_MAX) {
      throw new Error("UID counter overflow in the same tick window.");
    }
  } else {
    counter = 0n;
    lastTick = tick;
  }

  return tick * TICK_MULTIPLIER + counter;
}

export function intToUid(value: bigint): string {
  let num = value;
  if (num < 0n) {
    num = TWO_TO_64 + num;
  }

  const raw = new Array<string>(MAX_DIGITS).fill(BASE64_CHARS[0]);
  let index = MAX_DIGITS - 1;

  do {
    const sixBits = Number(num & SIX_BIT_MASK);
    raw[index--] = BASE64_CHARS[sixBits];
    num >>= BITS_PER_SYMBOL;
  } while (num > 0n && index >= 0);

  return raw.slice(index + 1).join("") || BASE64_CHARS[0];
}

export function intFromUid(base64String: string): bigint {
  let result = 0n;
  let strIndex = base64String.length - 1;

  for (let i = 0; i < MAX_DIGITS; i += 1, strIndex -= 1) {
    let value = 0n;
    if (strIndex >= 0) {
      const ch = base64String[strIndex];
      const lookup = BASE64_LOOKUP.get(ch);
      if (lookup === undefined) {
        throw new Error(`Illegal character "${ch}" in UID ${base64String}`);
      }
      value = BigInt(lookup);
    }

    result |= value << BigInt(6 * i);
  }

  if (result >= TWO_TO_63) {
    return result - TWO_TO_64;
  }

  return result;
}
