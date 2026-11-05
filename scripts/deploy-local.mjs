import { JsonRpcProvider, ContractFactory } from 'ethers'
import { mkdirSync, writeFileSync } from 'node:fs'
import { compileContracts } from './contracts.mjs'
const provider=new JsonRpcProvider('http://127.0.0.1:8545');provider.pollingInterval=50
if((await provider.getNetwork()).chainId!==31337n) throw new Error('Local development chain required')
const signer=await provider.getSigner(0), artifacts=compileContracts()
const deploy=async(name,args=[])=>{const c=await new ContractFactory(artifacts[name].abi,artifacts[name].evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c}
const token=await deploy('MockUSDC'), verifier=await deploy('Groth16Verifier'), registry=await deploy('VaultRegistry',[await verifier.getAddress()])
const roles=await Promise.all([1,2,3].map(async i=>(await provider.getSigner(i)).getAddress()))
const escrow=await deploy('VoucherEscrow',[await token.getAddress(),...roles])
const result={network:'LOCAL DEVELOPMENT ONLY',chainId:31337,token:await token.getAddress(),verifier:await verifier.getAddress(),registry:await registry.getAddress(),scope:(await registry.scope()).toString(),escrow:await escrow.getAddress(),validator:roles[0],arbitrator:roles[1],revenue:roles[2],proofSetup:'LOCAL DEVELOPMENT ONLY'}
mkdirSync('deployments',{recursive:true});writeFileSync('deployments/local.json',JSON.stringify(result,null,2)+'\n')
console.info(JSON.stringify(result,null,2));provider.destroy()
