/**
 * Arc Testnet: where the escrow lives. Pure helpers (no React, no env) so node tests can import them.
 */
export const ARC = {
  id: 5042002,
  hex: "0x4cef52",
  name: "Arc Testnet",
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
};

type Request = (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;

export function chainIdNumber(id: unknown) {
  if (typeof id === "number") return id;
  if (typeof id !== "string" || !id) return 0;
  const n = id.startsWith("0x") || id.startsWith("0X") ? Number.parseInt(id, 16) : Number(id);
  return Number.isFinite(n) ? n : 0;
}

/** True when a wallet_switchEthereumChain error means "this wallet doesn't know the chain yet". */
function unknownChain(error: unknown) {
  const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
  return e?.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized|not (been )?added|unknown chain|unsupported chain|4902/i.test(e?.message ?? "");
}

/** Switch the wallet to Arc, adding the network first if the wallet doesn't have it. Works across MetaMask, Rabby, OKX, Coinbase, Trust, WalletConnect. */
export async function switchToArc(request: Request) {
  const current = await request({ method: "eth_chainId" }).catch(() => null);
  if (chainIdNumber(current) === ARC.id) return;
  try {
    await request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.hex }] });
    return;
  } catch (error) {
    if ((error as { code?: number }).code === 4001) throw error;
    if (!unknownChain(error) && (error as { code?: number }).code !== -32603) throw error;
  }
  await request({
    method: "wallet_addEthereumChain",
    params: [{ chainId: ARC.hex, chainName: ARC.name, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [ARC.rpc], blockExplorerUrls: [ARC.explorer] }],
  });
  // Some wallets add without switching.
  const after = await request({ method: "eth_chainId" }).catch(() => null);
  if (chainIdNumber(after) !== ARC.id) await request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.hex }] });
}

