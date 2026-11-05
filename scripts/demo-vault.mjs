import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { JsonRpcProvider,Contract,Wallet,parseEther,verifyMessage,keccak256,toUtf8Bytes,toBeHex } from 'ethers'
import { groth16 } from 'snarkjs'
import { newKey,encryptRecord,decryptRecord,proofInput,createRecipientKeys,publicRecipientKey,recipientKeyMessage,sealForRecipient,openShared,exportBackup,importBackup } from '@netpositive/vault'
import assert from 'node:assert/strict'
const deployment=JSON.parse(readFileSync('deployments/local.json'))
if(deployment.chainId!==31337)throw new Error('Local-only demo')
const rpc=new JsonRpcProvider('http://127.0.0.1:8545',undefined,{cacheTimeout:-1});rpc.pollingInterval=10
const seller=Wallet.createRandom().connect(rpc),buyer=Wallet.createRandom().connect(rpc),validator=await rpc.getSigner(1),faucet=await rpc.getSigner(0)
for(const wallet of [seller,buyer])await(await faucet.sendTransaction({to:wallet.address,value:parseEther('1')})).wait()
const token=new Contract(deployment.token,JSON.parse(readFileSync('contracts/build/MockUSDC.json')).abi,buyer)
const escrow=new Contract(deployment.escrow,JSON.parse(readFileSync('contracts/build/VoucherEscrow.json')).abi,buyer)
const registry=new Contract(deployment.registry,JSON.parse(readFileSync('contracts/build/VaultRegistry.json')).abi,seller)
const sessions=[]
async function login(signer){
  let token='';const address=(await signer.getAddress()).toLowerCase()
  const api=async(path,method='GET',body)=>{const r=await fetch('http://127.0.0.1:8787'+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error(`Demo API refused ${path}: ${r.status}`);return r.json()}
  const c=await api('/v1/auth/challenge','POST',{address});const signature=await signer.signMessage(c.message)
  token=(await api('/v1/auth/verify','POST',{address,signature})).token
  sessions.push(api);return {address,api}
}
const master=newKey()
try {
  const sellerSession=await login(seller),buyerSession=await login(buyer)
  const record={kind:'gift-card',brand:'SYNTHETIC DEMO',code:'NOT-A-REAL-VOUCHER',valueMinor:10000,currency:'INR'}
  const envelope=await encryptRecord(master,record)
  await sellerSession.api(`/v1/vault/${envelope.id}`,'PUT',envelope)
  const stored=(await sellerSession.api('/v1/vault')).records.find(r=>r.envelope.id===envelope.id)
  assert.deepEqual(await decryptRecord(master,stored.envelope),record)
  assert.ok(!JSON.stringify(stored).includes(record.code))
  const input=await proofInput(master,envelope,await seller.getAddress(),await registry.scope())
  const generated=await groth16.fullProve(input,'circuits/build/vault_js/vault.wasm','circuits/build/vault.zkey',undefined,undefined,{singleThread:true})
  const args=JSON.parse('['+await groth16.exportSolidityCallData(generated.proof,generated.publicSignals)+']')
  const anchorReceipt=await(await registry.anchor(...args)).wait()
  const principal=100_000_000n,fee=1_000_000n
  await(await token.mint(await buyer.getAddress(),principal+fee)).wait()
  await(await token.approve(deployment.escrow,principal+fee)).wait()
  const nonce=keccak256(toUtf8Bytes(envelope.id)),id=await escrow.tradeId(await buyer.getAddress(),nonce)
  const now=Number((await rpc.getBlock('latest')).timestamp)
  await(await escrow.fund(nonce,await seller.getAddress(),principal,now+7200,3600,toBeHex(BigInt(generated.publicSignals[0]),32))).wait()
  const keys=await createRecipientKeys(),jwk=await publicRecipientKey(keys.publicKey)
  await buyerSession.api('/v1/recipient-key','PUT',{jwk,signature:await buyer.signMessage(recipientKeyMessage(buyerSession.address,jwk))})
  const registered=await sellerSession.api(`/v1/recipient-key/${buyerSession.address}`)
  assert.equal(verifyMessage(recipientKeyMessage(buyerSession.address,registered.jwk),registered.signature).toLowerCase(),buyerSession.address)
  const context={tradeId:id.toLowerCase(),recipient:buyerSession.address},shared=await sealForRecipient(record,registered.jwk,context)
  await sellerSession.api(`/v1/shares/${id}`,'PUT',shared)
  const received=(await buyerSession.api(`/v1/shares/${id}`)).envelope
  assert.deepEqual(await openShared(received,keys.privateKey,context),record)
  const encryptedDigest='0x'+createHash('sha256').update(JSON.stringify(shared)).digest('hex'),validUntil=now+600
  // Synthetic validator attestation. No real issuer redemption service is claimed.
  const signature=await validator.signTypedData({name:'NetPositiveVoucherEscrow',version:'1',chainId:31337,verifyingContract:deployment.escrow},{Delivery:[{name:'id',type:'bytes32'},{name:'encryptedDigest',type:'bytes32'},{name:'recipient',type:'address'},{name:'validUntil',type:'uint64'}]},{id,encryptedDigest,recipient:await buyer.getAddress(),validUntil})
  await(await escrow.connect(seller).deliver(id,encryptedDigest,validUntil,signature)).wait()
  await(await escrow.confirm(id)).wait()
  const sellerCredit=await escrow.credits(await seller.getAddress());assert.ok(sellerCredit>=principal)
  await(await escrow.connect(seller).withdraw()).wait()
  const backup=await exportBackup(master,[envelope],'SYNTHETIC DEMO RECOVERY ONLY 2026')
  const recovered=await importBackup(backup,'SYNTHETIC DEMO RECOVERY ONLY 2026')
  assert.deepEqual(await decryptRecord(recovered.key,recovered.envelopes[0]),record);recovered.key.fill(0)
  const result={checkedAt:new Date().toISOString(),environment:'LOCAL ONLY',ciphertextStorage:true,realGroth16Anchor:anchorReceipt.hash,anchorGas:anchorReceipt.gasUsed.toString(),recipientDecryption:true,escrow:id,principalUSDC:'100',payerFeeUSDC:'1',reserveShareUSDC:'0.30',revenueShareUSDC:'0.70',sellerWithdrawal:true,independentBackupRecovery:true,worldProof:'NOT EXERCISED: needs registered credentials and human/simulator flow'}
  mkdirSync('var',{recursive:true});writeFileSync('var/demo-result.json',JSON.stringify(result,null,2)+'\n');console.info(result)
}finally{master.fill(0);await Promise.allSettled(sessions.map(api=>api('/v1/auth/logout','POST')));rpc.destroy()}
