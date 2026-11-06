/**
 * The way a buyer chose to pay for a voucher (which card, which bank channel). It is picked when they accept an order and
 * needed again later to send them to the right gift-voucher site, so it is kept in this browser per order.
 * It holds no card numbers, only the names of the card and channel.
 */
export type ChosenRoute = { cardId: string; cardLabel: string; channelId: string; channelName: string };

const KEY = (orderId: string) => `netpositive:route:${orderId}`;

export function saveRoute(orderId: string, route: ChosenRoute) {
  try {
    localStorage.setItem(KEY(orderId), JSON.stringify(route));
  } catch {
    /* storage blocked: the buyer can pick again later */
  }
}

export function readRoute(orderId: string): ChosenRoute | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(orderId)) ?? "null") as Partial<ChosenRoute> | null;
    return v && typeof v.cardId === "string" && typeof v.channelId === "string" && typeof v.cardLabel === "string" && typeof v.channelName === "string" ? (v as ChosenRoute) : null;
  } catch {
    return null;
  }
}
