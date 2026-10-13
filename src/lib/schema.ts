import * as v from "valibot";

export const UInt53 = v.pipe(v.number(), v.minValue(0), v.safeInteger());
