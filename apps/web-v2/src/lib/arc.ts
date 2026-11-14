/**
 * Arc: where the escrow lives. Which Arc network (mainnet or testnet) comes from `chain.ts`.
 * Pure helpers (no React) so node tests can import them.
 */
// Explicit .ts so node (which runs the tests without a bundler) can resolve it.
import { ARC, ARC_USDC } from "./chain.ts";
export { ARC, ARC_USDC };

type Request = (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;

export function chainIdNumber(id: unknown) {
  if (typeof id === "number") return id;
  if (typeof id !== "string" || !id) return 0;
  const n = id.startsWith("0x") || id.startsWith("0X") ? Number.parseInt(id, 16) : Number(id);
  return Number.isFinite(n) ? n : 0;
}


/** A wallet step failed for a reason the person can act on. `message` is written for them. */
export class WalletStepError extends Error {
  kind: "unsupported_network" | "wrong_network" | "insufficient_usdc" | "rejected";
  constructor(kind: WalletStepError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

const codeOf = (e: unknown) => (e as { code?: number })?.code;
const textOf = (e: unknown) => (e as { message?: string })?.message ?? "";
const isReject = (e: unknown) => codeOf(e) === 4001 || /user rejected|user denied|rejected the request/i.test(textOf(e));

/** True when a wallet_switchEthereumChain error means "this wallet doesn't know the chain yet". */
function unknownChain(error: unknown) {
  const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
  return e?.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized|not (been )?added|unknown chain|unsupported chain|4902/i.test(e?.message ?? "");
}

/** True when the wallet has no way to use a network it wasn't built with (Phantom, some exchange wallets). */
function cannotAddChains(error: unknown) {
  const c = codeOf(error);
  return c === 4200 || c === -32601 || /not supported|unsupported method|does not support|method not found|not implemented/i.test(textOf(error));
}

const unsupported = (wallet?: string) =>
  new WalletStepError(
    "unsupported_network",
    `${wallet || "This wallet"} can't use ${ARC.name}: it only works on the networks it ships with. Signing in and World ID work, but locking USDC, Ready and the escrow steps need a wallet that can add a network. Connect MetaMask, Rabby, Coinbase Wallet or OKX Wallet for those.`,
  );

/**
 * Switch the wallet to Arc, adding the network first if the wallet doesn't have it.
 * Handles the error shapes of MetaMask, Rabby, OKX, Coinbase, Trust and WalletConnect, and says so plainly when a
 * wallet cannot add networks at all.
 */
export async function switchToArc(request: Request, wallet?: string) {
  const current = await request({ method: "eth_chainId" }).catch(() => null);
  if (chainIdNumber(current) === ARC.id) return;
  try {
    await request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.hex }] });
    if (chainIdNumber(await request({ method: "eth_chainId" }).catch(() => null)) === ARC.id) return;
  } catch (error) {
    if (isReject(error)) throw new WalletStepError("rejected", `You declined the network switch. ${ARC.name} is where the escrow lives, so this step needs it.`);
    if (!unknownChain(error) && codeOf(error) !== -32603 && !cannotAddChains(error)) throw error;
  }
  try {
    await request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: ARC.hex, chainName: ARC.name, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [ARC.rpc], blockExplorerUrls: [ARC.explorer] }],
    });
  } catch (error) {
    if (isReject(error)) throw new WalletStepError("rejected", `You declined adding ${ARC.name}. This step needs it.`);
    throw unsupported(wallet);
  }
  // Some wallets add without switching.
  if (chainIdNumber(await request({ method: "eth_chainId" }).catch(() => null)) !== ARC.id) {
    try {
      await request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.hex }] });
    } catch (error) {
      if (isReject(error)) throw new WalletStepError("rejected", `You declined the network switch. This step needs ${ARC.name}.`);
      throw unsupported(wallet);
    }
  }
  if (chainIdNumber(await request({ method: "eth_chainId" }).catch(() => null)) !== ARC.id) throw unsupported(wallet);
}

/**
 * Last check before a transaction is sent: the wallet must really be on the configured Arc network.
 * `switchToArc` already tries to get it there; this says so plainly if it still isn't.
 */
export async function assertOnArc(request: Request) {
  const now = chainIdNumber(await request({ method: "eth_chainId" }).catch(() => null));
  if (now !== ARC.id) {
    throw new WalletStepError("wrong_network", `Your wallet is on chain ${now || "unknown"}, but this step runs on ${ARC.name} (chain ${ARC.id}). Switch networks in your wallet, then try again.`);
  }
}

/* ------------------------------------------------- USDC reads on Arc */

const pad32 = (hex: string) => hex.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
const toBig = (v: unknown) => (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v) ? BigInt(v) : 0n);
export const usdcText = (base: bigint) => {
  const s = (base / 10_000n).toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};

export async function usdcBalance(request: Request, holder: string) {
  return toBig(await request({ method: "eth_call", params: [{ to: ARC_USDC, data: `0x70a08231${pad32(holder)}` }, "latest"] }));
}
export async function usdcAllowance(request: Request, holder: string, spender: string) {
  return toBig(await request({ method: "eth_call", params: [{ to: ARC_USDC, data: `0xdd62ed3e${pad32(holder)}${pad32(spender)}` }, "latest"] }));
}

/**
 * Before any wallet prompt: is there enough USDC on Arc for this deposit (plus a little for gas, which Arc also
 * charges in USDC)? Failing here is free; failing inside the wallet costs a confusing error or a reverted transaction.
 */
export async function assertUsdc(request: Request, holder: string, amount: bigint) {
  let have: bigint;
  try {
    have = await usdcBalance(request, holder);
  } catch {
    return; // The wallet's RPC wouldn't answer a read. Let the transaction itself decide.
  }
  const gas = 20_000n; // 0.02 USDC covers approve + deposit on Arc with room to spare
  if (have < amount + gas) {
    const hint = ARC.faucet ? `Get test USDC from ${ARC.faucet} (choose ${ARC.name}), then try again.` : `Add USDC to this wallet on ${ARC.name}, then try again.`;
    throw new WalletStepError("insufficient_usdc", `This wallet has ${usdcText(have)} USDC on ${ARC.name}. This step needs ${usdcText(amount)} plus a few cents for gas. ${hint}`);
  }
}
