// AI-assisted: Codex. Public Arc TESTNET deployment through Circle Agent Wallet.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { JsonRpcProvider, Contract, Wallet } from 'ethers'
const exec=promisify(execFile)
const wallet='0x7a15613ac4e5c8562d38c10fa6aeb3e7b439b4d5'
const chain='ARC-TESTNET', rpc=new JsonRpcProvider('https://rpc.testnet.arc.io')
if((await rpc.getNetwork()).chainId!==5042002n)throw new Error('Arc Testnet required')
const roles={owner:wallet,validator:process.env.NP_VALIDATOR_PRIVATE_KEY?new Wallet(process.env.NP_VALIDATOR_PRIVATE_KEY).address:null,
  resolver:process.env.NP_ARBITRATOR_PRIVATE_KEY?new Wallet(process.env.NP_ARBITRATOR_PRIVATE_KEY).address:null,
  treasury:process.env.NP_TREASURY_PRIVATE_KEY?new Wallet(process.env.NP_TREASURY_PRIVATE_KEY).address:null}
if(Object.values(roles).some(v=>!v))throw new Error('Configure the local testnet service keys; never pass private keys as command flags')
const childEnv={...process.env}
for(const name of Object.keys(childEnv))if(name.includes('PRIVATE_KEY')||name.startsWith('RPC_PROXY_'))delete childEnv[name]
const path='deployments/arc-testnet.pending.json'
mkdirSync('deployments',{recursive:true})
const state=existsSync(path)?JSON.parse(readFileSync(path)): {chainId:5042002,roles,operations:{},contracts:{}}
if(JSON.stringify(state.roles)!==JSON.stringify(roles))throw new Error('Deployment role configuration changed')
const save=()=>writeFileSync(path,JSON.stringify(state,null,2)+'\n')
async function circle(args){
  try {const {stdout}=await exec('circle',[...args,'--output','json'],{env:childEnv,maxBuffer:4*1024*1024,timeout:180000});return JSON.parse(stdout).data}
  catch(error){const output=error.stdout||'';try{throw new Error(JSON.parse(output).error?.message??'Circle operation refused')}catch(e){if(e instanceof SyntaxError)throw new Error('Circle operation failed; no raw credential output logged');throw e}}
}
const artifact=name=>JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`))
async function deploy(name,signature,args){
  if(state.contracts[name]){if(await rpc.getCode(state.contracts[name].address)==='0x')throw new Error('Recorded contract has no code');return state.contracts[name].address}
  const a=artifact(name),bytecode=a.bytecode.object
  const publicArgs=['contract','deploy','--bytecode',bytecode,'--address',wallet,'--chain',chain,'--constructor-signature',signature,...args.map(v=>Array.isArray(v)?JSON.stringify(v):String(v))]
  const digest=createHash('sha256').update(JSON.stringify({bytecode,signature,args})).digest('hex')
  const op=state.operations[name]??{idempotencyKey:randomUUID(),digest}
  if(op.digest!==digest)throw new Error('Deployment artifact changed: start a new explicit deployment record')
  state.operations[name]=op;save()
  if(process.argv.includes('--estimate')){const quote=await circle([...publicArgs,'--estimate']);console.info(JSON.stringify({contract:name,quote}));return null}
  if(!process.argv.includes('--deploy'))throw new Error('Pass --estimate or --deploy explicitly')
  const result=await circle([...publicArgs,'--idempotency-key',op.idempotencyKey])
  state.operations[name].result=result;save()
  const address=result.contractAddress??result.contractDeploymentAddress??result.deployedContractAddress
  if(!address){console.info(JSON.stringify({contract:name,result}));throw new Error('Circle returned no deployed address; inspect the saved public transaction result before retrying')}
  if(await rpc.getCode(address)==='0x')throw new Error('Deployment is not confirmed on chain')
  state.contracts[name]={address,transaction:result.txHash??result.transactionHash??null,circleTransactionId:result.id,bytecodeSha256:digest}
  save();console.info(`${name}: ${address}`);return address
}
try{
  const registry=await deploy('AttestorRegistry','constructor(address,address[],uint16,uint64,address)',[wallet,[roles.validator],1,600,roles.validator])
  if(process.argv.includes('--estimate'))process.exitCode=0
  else {
    const identity=await deploy('IdentityRegistry','constructor(address,address)',[wallet,registry])
    const reserve=await deploy('ReserveVault','constructor(address,address,uint256,uint256)',[wallet,'0x3600000000000000000000000000000000000000','25000000','250000000'])
    const escrow=await deploy('VoucherEscrow','constructor(address,address,address,address,address,address,address,(uint16,uint16,uint16,uint32,uint32,uint32,uint32,uint32))',[wallet,'0x3600000000000000000000000000000000000000',registry,identity,reserve,roles.treasury,roles.resolver,[100,5000,1000,600,600,300,300,600]])
    for(const [name,address] of [['IdentityRegistry',identity],['ReserveVault',reserve]]) {
      const contract=new Contract(address,artifact(name).abi,rpc)
      const bound=await contract.escrow()
      if(bound==='0x0000000000000000000000000000000000000000'){
        const op=state.operations[`bind-${name}`]??{idempotencyKey:randomUUID()};state.operations[`bind-${name}`]=op;save()
        const result=await circle(['wallet','execute','bindEscrow(address)',escrow,'--contract',address,'--address',wallet,'--chain',chain,'--idempotency-key',op.idempotencyKey])
        op.result=result;save()
      }
      if((await contract.escrow()).toLowerCase()!==escrow.toLowerCase())throw new Error('Escrow binding did not confirm')
    }
    const result={...state,network:'Arc Testnet',studio:'https://studio.arc.io/app/d1bf97e6-f4b7-495d-bdc7-e2f213c52033',verifiedAt:new Date().toISOString(),issuerVerification:'not configured; no real voucher validity claim'}
    writeFileSync('deployments/arc-testnet.json',JSON.stringify(result,null,2)+'\n')
    console.info('All four deployed contracts and one-time escrow bindings verified on Arc Testnet.')
  }
}finally{rpc.destroy()}
