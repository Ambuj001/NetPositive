// The subset of snarkjs 0.7.6 used by the local CLI, exercised by contract tests.
declare module 'snarkjs' {
  export const groth16: {
    fullProve(input: Record<string,string>, wasm: string, zkey: string, logger?: undefined, witnessOptions?: undefined, proverOptions?: {singleThread:boolean}): Promise<{proof:unknown,publicSignals:string[]}>
    exportSolidityCallData(proof:unknown, publicSignals:string[]):Promise<string>
  }
}
