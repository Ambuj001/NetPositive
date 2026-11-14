import { assertUsdc, switchToArc, usdcAllowance } from "./arc";
import type { Provider } from "./wallet";

/** Arc testnet. Native gas is USDC at 18 decimals; the escrow pulls the 6-decimal ERC-20 at this address. */
export const ARC_CHAIN_ID = 5042002;
export const ARC_CHAIN_HEX = "0x4cef52";
export const ARC_USDC = "0x3600000000000000000000000000000000000000";

const APPROVE_SELECTOR = "0x095ea7b3";
const DEPOSIT_SELECTOR = "0x1de26e16";

type Rpc = Provider["request"];

function pad32(hex: string) {
  return hex.replace(/^0x/i, "").padStart(64, "0");
}

export function encodeApprove(spender: string, amount: bigint) {
  return APPROVE_SELECTOR + pad32(spender) + pad32(amount.toString(16));
}

export function encodeDeposit(escrowId: string, amount: bigint) {
  const id = escrowId.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(id)) throw new Error("Escrow id is not a 32-byte hash");
  return DEPOSIT_SELECTOR + id.toLowerCase() + pad32(amount.toString(16));
}

async function waitForReceipt(request: Rpc, hash: string) {
  for (let i = 0; i < 40; i++) {
    const receipt = (await request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("The lock transaction reverted.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("The lock transaction is still pending. Check your wallet, then try again.");
}

async function send(request: Rpc, tx: { from: string; to: string; data: string }) {
  const hash = await request({ method: "eth_sendTransaction", params: [{ ...tx, value: "0x0" }] });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Wallet did not return a transaction hash.");
  await waitForReceipt(request, hash);
  return hash;
}

/**
 * Approve Arc USDC and deposit it into escrow for this request.
 * Returns the deposit transaction hash. The request must already exist so `escrowId` is known.
 */
export async function lockUsdc(
  request: Rpc,
  opts: { from: string; escrow: string; escrowId: string; amountBaseUnits: string; wallet?: string; onStep?: (s: "switch" | "approve" | "deposit") => void },
) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(opts.escrow)) throw new Error("Escrow contract address is missing.");
  const amount = BigInt(opts.amountBaseUnits);
  if (amount <= 0n) throw new Error("Lock amount must be greater than zero.");
  opts.onStep?.("switch");
  await switchToArc(request, opts.wallet);
  await assertUsdc(request, opts.from, amount);
  // An approval left over from an earlier attempt is reused, so a retry asks for one signature, not two.
  const allowed = await usdcAllowance(request, opts.from, opts.escrow).catch(() => 0n);
  if (allowed < amount) {
    opts.onStep?.("approve");
    await send(request, { from: opts.from, to: ARC_USDC, data: encodeApprove(opts.escrow, amount) });
  }
  opts.onStep?.("deposit");
  return send(request, { from: opts.from, to: opts.escrow, data: encodeDeposit(opts.escrowId, amount) });
}

/** 32-byte hash accepted by POST /requests/:id/fund when the server is in mock escrow mode. */
export const mockTxHash = () => `0x${"ab".repeat(32)}`;
