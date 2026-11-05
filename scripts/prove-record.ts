// SPDX-License-Identifier: GPL-3.0-or-later
// Local CLI: private recovery material is never sent to the vault API or RPC.
import { readFileSync } from 'node:fs'
import { groth16 } from 'snarkjs'
import { z } from 'zod'
import { importBackup, proofInput } from '@netpositive/vault'
const [backupPath,recordId,owner,scope]=process.argv.slice(2)
if(!backupPath||!recordId||!owner||!scope)throw new Error('Usage: prove-record.ts backup.json record-id owner-address registry-scope; supply {"passphrase":"..."} through private stdin')
let stdin=''
for await(const chunk of process.stdin){stdin+=chunk;if(stdin.length>8192)throw new Error('Input too large')}
const {passphrase}=z.object({passphrase:z.string().min(16).max(1024)}).strict().parse(JSON.parse(stdin))
const restored=await importBackup(JSON.parse(readFileSync(backupPath,'utf8')),passphrase)
try {
  const envelope=restored.envelopes.find(e=>e.id===recordId)
  if(!envelope)throw new Error('Record not found')
  const input=await proofInput(restored.key,envelope,owner,BigInt(scope))
  const {proof,publicSignals}=await groth16.fullProve(input,'circuits/build/vault_js/vault.wasm','circuits/build/vault.zkey',undefined,undefined,{singleThread:true})
  const solidityArgs=JSON.parse('['+await groth16.exportSolidityCallData(proof,publicSignals)+']')
  process.stdout.write(JSON.stringify({proof,publicSignals,solidityArgs,setup:'LOCAL DEVELOPMENT ONLY'},null,2)+'\n')
}finally{restored.key.fill(0)}
