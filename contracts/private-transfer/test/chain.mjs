// Tiny in-process EVM helper for tests (no Foundry/anvil needed). Wraps @ethereumjs/evm with viem ABI encoding.
// Chain id is 1 inside this EVM (the CHAINID opcode), which tests use for EIP-712 domains.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEVM } from '@ethereumjs/evm';
import { Common, Mainnet } from '@ethereumjs/common';
import { createAddressFromString, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { SimpleStateManager } from '@ethereumjs/statemanager';
import { createBlock } from '@ethereumjs/block';
import { encodeDeployData, encodeFunctionData, decodeFunctionResult, decodeErrorResult, decodeEventLog } from 'viem';

const buildDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build');
export const artifact = (name) => JSON.parse(fs.readFileSync(path.join(buildDir, `${name}.json`), 'utf8'));
export const CHAIN_ID = 1n;

export class Chain {
  constructor(evm, common) { this.evm = evm; this.common = common; this.now = 1_700_000_000n; this.abis = []; this.nonce = new Map(); }
  static async create() {
    const common = new Common({ chain: Mainnet, hardfork: 'shanghai' });
    return new Chain(await createEVM({ common, stateManager: new SimpleStateManager() }), common);
  }
  warp(seconds) { this.now += BigInt(seconds); }
  block() { return createBlock({ header: { number: 1n, timestamp: this.now } }, { common: this.common }); }
  addr = (hex) => createAddressFromString(hex);

  /** Deploy a compiled contract. Returns { address, abi }. */
  async deploy(name, args = [], from) {
    const { abi, bytecode } = artifact(name);
    this.abis.push(...abi);
    const caller = this.addr(from);
    const r = await this.evm.runCall({ caller, origin: caller, data: hexToBytes(encodeDeployData({ abi, bytecode, args })), gasLimit: 15_000_000n, block: this.block() });
    if (r.execResult.exceptionError) throw new Error(`deploy ${name} failed: ${this.describe(r.execResult)}`);
    return { address: r.createdAddress.toString(), abi };
  }

  describe(exec) {
    const data = bytesToHex(exec.returnValue);
    if (data === '0x') return exec.exceptionError?.error ?? 'failed';
    try { const e = decodeErrorResult({ abi: this.abis, data }); return e.errorName; } catch { /* fall through */ }
    if (data.startsWith('0x08c379a0')) return `Error(string)`;
    return `revert ${data.slice(0, 10)}`;
  }

  /** State-changing call. Never throws on a revert: returns { ok, error, logs, gas }. */
  async send(c, fn, args, from, { value = 0n } = {}) {
    const caller = this.addr(from);
    const r = await this.evm.runCall({
      caller, origin: caller, to: this.addr(c.address), value, gasLimit: 15_000_000n, block: this.block(),
      data: hexToBytes(encodeFunctionData({ abi: c.abi, functionName: fn, args })),
    });
    const ex = r.execResult;
    if (ex.exceptionError) return { ok: false, error: this.describe(ex), logs: [], gas: ex.executionGasUsed };
    const logs = (ex.logs ?? []).map(([a, topics, data]) => {
      const log = { address: bytesToHex(a), topics: topics.map(bytesToHex), data: bytesToHex(data) };
      for (const abi of [c.abi, ...this.extraAbis ?? []]) {
        try { return { ...log, ...decodeEventLog({ abi, data: log.data, topics: log.topics }) }; } catch { /* next */ }
      }
      return log;
    });
    return { ok: true, error: null, logs, gas: ex.executionGasUsed, returnValue: bytesToHex(ex.returnValue) };
  }

  /** Read-only call. Throws if it reverts. */
  async read(c, fn, args = [], from = '0x0000000000000000000000000000000000000001') {
    const caller = this.addr(from);
    const r = await this.evm.runCall({
      caller, origin: caller, to: this.addr(c.address), isStatic: true, gasLimit: 15_000_000n, block: this.block(),
      data: hexToBytes(encodeFunctionData({ abi: c.abi, functionName: fn, args })),
    });
    if (r.execResult.exceptionError) throw new Error(`${fn} reverted: ${this.describe(r.execResult)}`);
    return decodeFunctionResult({ abi: c.abi, functionName: fn, data: bytesToHex(r.execResult.returnValue) });
  }
}
