import type { Order } from "./data";

/**
 * Who started an order. A request normally begins with a crypto spender (they lock USDC and wait for a buyer).
 * An order a crypto buyer started has no spender yet, so no spender address is on it.
 */
export type Initiator = "spender" | "buyer";

export const initiatorOf = (r: { crypto_spender?: string | null }): Initiator => (r.crypto_spender ? "spender" : "buyer");

/**
 * What the Pay-with-crypto side may suggest. A crypto spender is looking for someone on the other side of the trade, so only
 * orders started by a crypto buyer count. Other spenders' requests are the same side and are never suggested.
 * An order with no recorded initiator is treated as a spender's.
 */
export const suggestionsFor = (orders: Order[]): Order[] => orders.filter((o) => o.initiator === "buyer");
