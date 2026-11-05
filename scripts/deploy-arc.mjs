import { JsonRpcProvider, Wallet, ContractFactory, getAddress } from 'ethers'
import { mkdirSync, writeFileSync } from 'node:fs'
import { compileContracts } from './contracts.mjs'
// Escrow-only Arc TESTNET deployment. Never deploy the local-ceremony ZK verifier publicly.
const provider=new JsonRpcProvider('https://rpc.testnet.arc.io');provider.pollingInterval=1000
if((await provider.getNetwork()).chainId!==5042002n) throw new Error('Arc Testnet required')
const names=['ARC_TESTNET_DEPLOYER_KEY','VOUCHER_VALIDATOR','DISPUTE_ARBITRATOR','REVENUE_RECIPIENT']
for(const name of names) if(!process.env[name]) throw new Error(`Set ${name} in your local secret environment; never share it in chat`)
const token='0x3600000000000000000000000000000000000000',roles=names.slice(1).map(n=>getAddress(process.env[n]))
const signer=new Wallet(process.env.ARC_TESTNET_DEPLOYER_KEY,provider),artifact=compileContracts().VoucherEscrow
const contract=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy(token,...roles)
const receipt=await contract.deploymentTransaction().wait(2)
if(receipt.status!==1 || await provider.getCode(await contract.getAddress())==='0x') throw new Error('Deployment verification failed')
const result={network:'Arc Testnet',chainId:5042002,escrow:await contract.getAddress(),transaction:receipt.hash,token,validator:roles[0],arbitrator:roles[1],revenue:roles[2],zkRegistry:'NOT DEPLOYED: development setup only',studioProject:'https://studio.arc.io/app/d1bf97e6-f4b7-495d-bdc7-e2f213c52033'}
mkdirSync('deployments',{recursive:true});writeFileSync('deployments/arc-testnet.json',JSON.stringify(result,null,2)+'\n');console.info(result);provider.destroy()
