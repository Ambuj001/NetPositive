export type Brand = {
  id: string;
  name: string;
  category: string;
  color: string;
  glyph: string;
  domains: string[];
  /** verification happens on the merchant's own portal for high-risk brands */
  merchantPortal?: boolean;
  /** Official brand logo in /public/brands (trademark of its owner, shown only to identify the brand). */
  logo?: string;
  /** Logo artwork runs to the edges, so give it breathing room on the tile. */
  logoPad?: boolean;
};

export const BRANDS: Brand[] = [
  { id: "lifestyle", name: "Lifestyle", category: "Fashion", color: "#f97316", glyph: "L", domains: ["lifestylestores.com"], logo: "/brands/lifestyle.png" },
  { id: "myntra", name: "Myntra", category: "Fashion", color: "#ff3f6c", glyph: "M", domains: ["myntra.com"], logo: "/brands/myntra.png" },
  { id: "amazon", name: "Amazon Pay", category: "Everything", color: "#ff9900", glyph: "a", domains: ["amazon.in"], logo: "/brands/amazon.svg", logoPad: true },
  { id: "croma", name: "Croma", category: "Electronics", color: "#12daa8", glyph: "C", domains: ["croma.com"], logo: "/brands/croma.png" },
  { id: "tanishq", name: "Tanishq", category: "Jewellery", color: "#c9a14a", glyph: "T", domains: ["tanishq.co.in"], merchantPortal: true, logo: "/brands/tanishq.png", logoPad: true },
  { id: "mmt", name: "MakeMyTrip", category: "Travel", color: "#2b7fff", glyph: "m", domains: ["makemytrip.com"], logo: "/brands/mmt.png" },
  { id: "swiggy", name: "Swiggy", category: "Food", color: "#fc8019", glyph: "S", domains: ["swiggy.com"], logo: "/brands/swiggy.png" },
  { id: "nykaa", name: "Nykaa", category: "Beauty", color: "#fc2779", glyph: "N", domains: ["nykaa.com"], logo: "/brands/nykaa.png" },
  { id: "kalyan", name: "Kalyan Jewellers", category: "Jewellery", color: "#b8862b", glyph: "K", domains: ["kalyanjewellers.net"], merchantPortal: true, logo: "/brands/kalyan.svg" },
  { id: "bookmyshow", name: "BookMyShow", category: "Entertainment", color: "#e5373f", glyph: "B", domains: ["bookmyshow.com"], logo: "/brands/bookmyshow.png" },
  { id: "flipkart", name: "Flipkart", category: "Everything", color: "#2874f0", glyph: "F", domains: ["flipkart.com"], logo: "/brands/flipkart.png" },
  { id: "ajio", name: "AJIO", category: "Fashion", color: "#2c4152", glyph: "A", domains: ["ajio.com"], logo: "/brands/ajio.png" },
  { id: "nike", name: "Nike", category: "Fashion", color: "#111111", glyph: "N", domains: ["nike.com"], logo: "/brands/nike.png", logoPad: true },
  { id: "tatacliq", name: "Tata CLiQ", category: "Everything", color: "#da1c5c", glyph: "T", domains: ["tatacliq.com"], logo: "/brands/tatacliq.png" },
  { id: "bigbasket", name: "BigBasket", category: "Groceries", color: "#84c225", glyph: "b", domains: ["bigbasket.com"], logo: "/brands/bigbasket.png" },
  { id: "blinkit", name: "Blinkit", category: "Groceries", color: "#f8cb46", glyph: "b", domains: ["blinkit.com"] },
  { id: "zomato", name: "Zomato", category: "Food", color: "#e23744", glyph: "Z", domains: ["zomato.com"], logo: "/brands/zomato.png" },
  { id: "tajhotels", name: "Taj Hotels", category: "Travel", color: "#a0815c", glyph: "T", domains: ["tajhotels.com"], logo: "/brands/tajhotels.png", logoPad: true },
];

/** Exact lookup; undefined when the brand isn't in the list. */
export const findBrand = (id: string) => BRANDS.find((b) => b.id === id);

export const brand = (id: string) => BRANDS.find((b) => b.id === id) ?? BRANDS[0];

export type Order = {
  id: string;
  brandId: string;
  amount: number;
  rate: number;
  seller: string;
  sellerTrades: number;
  city: string;
  postedMin: number;
  expiresMin: number;
  /** Who started the order. Missing means a crypto spender. */
  initiator?: "spender" | "buyer";
  /** Full wallet address of the crypto spender who locked the USDC. Missing for demo orders. */
  spender?: string;
  /** True for made-up sample rows. They exist only under `vite dev` and are labelled wherever they show. */
  demo?: boolean;
};
