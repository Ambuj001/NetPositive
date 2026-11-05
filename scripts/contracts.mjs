import solc from 'solc'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
export function compileContracts() {
  const files = ['contracts/VaultRegistry.sol','contracts/VoucherEscrow.sol','contracts/test/MockUSDC.sol','circuits/build/Verifier.sol']
  const input = { language: 'Solidity', sources: Object.fromEntries(files.map(f => [f,{content:readFileSync(f,'utf8')}])), settings: { optimizer: {enabled:true,runs:200}, evmVersion:'cancun', outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}} } }
  const output = JSON.parse(solc.compile(JSON.stringify(input),{import:f=>{try{return {contents:readFileSync(`node_modules/${f}`,'utf8')}}catch{return {error:`Missing ${f}`}}}}))
  const errors = (output.errors??[]).filter(e=>e.severity==='error')
  if(errors.length) throw new Error(errors.map(e=>e.formattedMessage).join('\n'))
  const contracts = Object.assign({},...Object.values(output.contracts))
  mkdirSync('contracts/build',{recursive:true})
  for(const [name, artifact] of Object.entries(contracts)) writeFileSync(`contracts/build/${name}.json`,JSON.stringify(artifact,null,2))
  return contracts
}
