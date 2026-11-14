import type { Order } from "./data";

/**
 * Made-up sample orders for working on the pages when no backend is running. They exist only under `vite dev`:
 * a production build gets an empty list (the rows are dropped from the bundle), and wherever they show they are
 * labelled as demo data and can't be opened.
 */
const DEMO_ROWS: Omit<Order, "demo">[] = !import.meta.env.DEV ? [] : [
  { id: "VR-24817", brandId: "lifestyle", amount: 10000, rate: 90, seller: "spender.eth", sellerTrades: 14, city: "Bengaluru", postedMin: 2, expiresMin: 28 },
  { id: "VR-24816", brandId: "amazon", amount: 25000, rate: 89.6, seller: "0xmeera", sellerTrades: 41, city: "Mumbai", postedMin: 4, expiresMin: 26 },
  { id: "VR-24814", brandId: "myntra", amount: 5000, rate: 90.4, seller: "kabir.base", sellerTrades: 7, city: "Delhi", postedMin: 6, expiresMin: 24 },
  { id: "VR-24811", brandId: "croma", amount: 40000, rate: 89.2, seller: "ishaan.eth", sellerTrades: 63, city: "Hyderabad", postedMin: 9, expiresMin: 21 },
  { id: "VR-24809", brandId: "mmt", amount: 15000, rate: 89.9, seller: "anya.lens", sellerTrades: 22, city: "Pune", postedMin: 11, expiresMin: 19 },
  { id: "VR-24805", brandId: "tanishq", amount: 50000, rate: 88.8, seller: "dev.eth", sellerTrades: 108, city: "Chennai", postedMin: 14, expiresMin: 16 },
  { id: "VR-24802", brandId: "nykaa", amount: 3000, rate: 90.8, seller: "sana.base", sellerTrades: 3, city: "Kolkata", postedMin: 17, expiresMin: 13 },
  { id: "VR-24799", brandId: "swiggy", amount: 2000, rate: 91, seller: "arjun.eth", sellerTrades: 19, city: "Jaipur", postedMin: 21, expiresMin: 9 },
];
export const DEMO_ORDERS: Order[] = DEMO_ROWS.map((o) => ({ ...o, id: `DEMO-${o.id.slice(3)}`, demo: true }));
