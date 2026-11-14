/**
 * The one place that says which Arc network this build talks to, and which escrow contract it trusts.
 * Everything else imports from here (through `arc.ts`). Pure functions plus one read of the build-time env, done
 * defensively so node tests (where `import.meta.env` does not exist) can import it.
 *
 *   VITE_ARC_NETWORK      mainnet | testnet   (default: testnet)
 *   VITE_ARC_RPC_URL      optional RPC override for reads from the browser
 *   VITE_ESCROW_CONTRACT  the VoucherEscrowV2 address this build trusts. Required in a production build.
 */
export type ArcNetwork = "mainnet" | "testnet";

export type Chain = {
  network: ArcNetwork;
  id: number;
  hex: string;
  /** What people see: "Arc" or "Arc Testnet". */
  name: string;
  rpc: string;
  explorer: string;
  testnet: boolean;
  /** Where to get test USDC. Null on mainnet. */
  faucet: string | null;
};

/** USDC as an ERC-20 (6 decimals). Same address on both Arc networks. Arc's gas coin is the same USDC at 18 decimals. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000";

export const CHAINS: Record<ArcNetwork, Chain> = {
  mainnet: { network: "mainnet", id: 5042, hex: "0x13b2", name: "Arc", rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io", testnet: false, faucet: null },
  testnet: { network: "testnet", id: 5042002, hex: "0x4cef52", name: "Arc Testnet", rpc: "https://rpc.testnet.arc.io", explorer: "https://testnet.arcscan.app", testnet: true, faucet: "https://faucet.circle.com" },
};

/** Chain ids of every Arc network, whichever one this build targets (both use USDC as the gas coin). */
export const ARC_CHAIN_IDS: number[] = [CHAINS.mainnet.id, CHAINS.testnet.id];

export function resolveNetwork(value: unknown): ArcNetwork {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!v) return "testnet";
  if (v === "mainnet" || v === "testnet") return v;
  throw new Error(`VITE_ARC_NETWORK must be "mainnet" or "testnet", not "${v}".`);
}

export function chainFor(network: ArcNetwork, rpcOverride?: unknown): Chain {
  const rpc = typeof rpcOverride === "string" && rpcOverride.trim() ? rpcOverride.trim() : CHAINS[network].rpc;
  return { ...CHAINS[network], rpc };
}

type Env = Record<string, string | boolean | undefined>;
const env: Env = (import.meta as unknown as { env?: Env }).env ?? {};

/** True under `vite dev`. False in a production build and in node tests. */
export const IS_DEV = env.DEV === true;

/** The network this build targets. */
export const ARC: Chain = chainFor(resolveNetwork(env.VITE_ARC_NETWORK), env.VITE_ARC_RPC_URL);

const isAddress = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

/** The escrow address baked into this build, lower-cased, or null when the variable is not set. */
export const BUILT_ESCROW: string | null = isAddress(env.VITE_ESCROW_CONTRACT) ? env.VITE_ESCROW_CONTRACT.toLowerCase() : null;

export type EscrowTarget = { mode: "chain"; contract: string } | { mode: "mock" };

/** The escrow could not be chosen safely. `message` is written for the person using the app. */
export class EscrowConfigError extends Error {
  kind: "not_configured" | "mismatch";
  constructor(kind: EscrowConfigError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Which escrow contract to use, given what the server says it uses.
 *  - The build-time address wins. If the server names a different one, that is an error, never a silent switch.
 *  - Without a build-time address, the server's value is trusted only in development.
 *  - A server with no contract runs the mock escrow. That is allowed only in development, where nothing on-chain
 *    happens; a production build treats it as "escrow is not configured".
 */
export function pickEscrow(server: string | null | undefined, opts: { built?: string | null; dev?: boolean } = {}): EscrowTarget {
  const built = opts.built === undefined ? BUILT_ESCROW : opts.built;
  const dev = opts.dev === undefined ? IS_DEV : opts.dev;
  const fromServer = isAddress(server) ? server.toLowerCase() : null;
  if (!fromServer) {
    if (dev) return { mode: "mock" };
    throw new EscrowConfigError("not_configured", "Escrow is not configured on the server, so nothing can be locked or paid. No funds have moved.");
  }
  if (built) {
    if (built.toLowerCase() !== fromServer) {
      throw new EscrowConfigError("mismatch", `The server points to escrow contract ${fromServer}, but this app was built for ${built.toLowerCase()}. Stopping so no funds go to the wrong contract.`);
    }
    return { mode: "chain", contract: built.toLowerCase() };
  }
  if (dev) return { mode: "chain", contract: fromServer };
  throw new EscrowConfigError("not_configured", "Escrow is not configured in this build (VITE_ESCROW_CONTRACT is missing), so the app can't check which contract to use. No funds have moved.");
}

/** A line to show when the server is on a different chain than this build, or null when they agree (or it didn't say). */
export function chainMismatch(serverChainId: unknown, chain: Chain = ARC): string | null {
  const n = typeof serverChainId === "number" ? serverChainId : typeof serverChainId === "string" && serverChainId ? Number(serverChainId) : NaN;
  if (!Number.isFinite(n) || n === chain.id) return null;
  return `This app is set up for ${chain.name} (chain ${chain.id}), but the server is on chain ${n}. Stopping here so nothing is sent to the wrong network.`;
}
