import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { network } from 'hardhat'
import { BrowserProvider, ContractFactory, Wallet, keccak256, toUtf8Bytes } from 'ethers'
import { groth16 } from 'snarkjs'
import { compileContracts } from '../../scripts/contracts.mjs'
import { newKey, encryptRecord, proofInput } from '@netpositive/vault'

test('real proof verifies on EVM; identity, scope, digest and replay attacks fail', async t => {
  const chain=await network.connect(),provider=new BrowserProvider(chain.provider,undefined,{cacheTimeout:-1})
  provider.pollingInterval=10
  try {
    const owner=await provider.getSigner(0),other=await provider.getSigner(1),artifacts=compileContracts()
    const deploy=async(name,args=[])=>{const c=await new ContractFactory(artifacts[name].abi,artifacts[name].evm.bytecode.object,owner).deploy(...args);await c.waitForDeployment();return c}
    const verifier=await deploy('Groth16Verifier'), registry=await deploy('VaultRegistry',[await verifier.getAddress()])
    const key=newKey(),envelope=await encryptRecord(key,{kind:'gift-card',brand:'TEST',code:'SYNTHETIC-ONLY',valueMinor:100,currency:'INR'})
    const input=await proofInput(key,envelope,await owner.getAddress(),await registry.scope())
    const generated=await groth16.fullProve(input,'circuits/build/vault_js/vault.wasm','circuits/build/vault.zkey',undefined,undefined,{singleThread:true})
    const vk=JSON.parse(readFileSync('circuits/build/verification_key.json'))
    assert.equal(await groth16.verify(vk,generated.publicSignals,generated.proof),true)
    const args=JSON.parse('['+await groth16.exportSolidityCallData(generated.proof,generated.publicSignals)+']')
    const tx=await registry.anchor(...args);const receipt=await tx.wait()
    assert.equal((await registry.anchors(args[3][0])).owner,await owner.getAddress())
    assert.equal(await registry.usedNullifiers(args[3][1]),true)
    t.diagnostic(`Actual Groth16 anchor gas: ${receipt.gasUsed}`)
    await assert.rejects(registry.anchor(...args))
    await assert.rejects(registry.connect(other).anchor(...args))
    const another=await deploy('VaultRegistry',[await verifier.getAddress()])
    await assert.rejects(another.anchor(...args))
    for(let i=0;i<5;i++) {
      const tampered=[...generated.publicSignals];tampered[i]=(BigInt(tampered[i])+1n).toString()
      assert.equal(await groth16.verify(vk,tampered,generated.proof),false)
    }
    await assert.rejects(groth16.fullProve({...input,secret:'0'},'circuits/build/vault_js/vault.wasm','circuits/build/vault.zkey',undefined,undefined,{singleThread:true}))
  } finally {await globalThis.curve_bn128?.terminate();await chain.close();provider.destroy()}
})

test('escrow fee accounting, attested delivery, disputes, timeout exits and isolated withdrawals',async t=>{
  const chain=await network.connect(),provider=new BrowserProvider(chain.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10
  try {
    const [buyer,seller,stranger,arb,revenue]=await Promise.all([0,1,2,3,4].map(i=>provider.getSigner(i)))
    const validator=Wallet.createRandom(),artifacts=compileContracts()
    const deploy=async(name,args=[])=>{const c=await new ContractFactory(artifacts[name].abi,artifacts[name].evm.bytecode.object,buyer).deploy(...args);await c.waitForDeployment();return c}
    const token=await deploy('MockUSDC'),escrow=await deploy('VoucherEscrow',[await token.getAddress(),validator.address,await arb.getAddress(),await revenue.getAddress()])
    const receipt=async promise=>(await promise).wait()
    const advance=async seconds=>{await chain.provider.request({method:'evm_increaseTime',params:[seconds]});await chain.provider.request({method:'evm_mine',params:[]})}
    const block=()=>provider.send('eth_getBlockByNumber',['latest',false])
    const now=async()=>Number((await block()).timestamp)
    await receipt(token.mint(await buyer.getAddress(),10_000_000_000n))
    await receipt(token.approve(await escrow.getAddress(),10_000_000_000n))
    let nonce=0
    const principal=100_000_000n,fee=1_000_000n
    async function fund() {
      const n=keccak256(toUtf8Bytes(`test-only-${nonce++}`)),id=await escrow.tradeId(await buyer.getAddress(),n)
      await receipt(escrow.fund(n,await seller.getAddress(),principal,(await now())+7200,3600,keccak256(toUtf8Bytes('SYNTHETIC-COMMITMENT'))))
      return id
    }
    const domain={name:'NetPositiveVoucherEscrow',version:'1',chainId:31337,verifyingContract:await escrow.getAddress()}
    const types={Delivery:[{name:'id',type:'bytes32'},{name:'encryptedDigest',type:'bytes32'},{name:'recipient',type:'address'},{name:'validUntil',type:'uint64'}]}
    async function deliver(id,signer=validator,overrides={}) {
      const encryptedDigest=keccak256(toUtf8Bytes('SYNTHETIC-ENCRYPTED-DELIVERY')),validUntil=(await now())+600
      const signature=await signer.signTypedData(domain,types,{id,encryptedDigest,recipient:await buyer.getAddress(),validUntil,...overrides})
      return receipt(escrow.connect(seller).deliver(id,encryptedDigest,validUntil,signature))
    }
    const first=await fund()
    assert.equal(await token.balanceOf(await escrow.getAddress()),principal+fee)
    await assert.rejects(escrow.confirm(first))
    await assert.rejects(deliver(first,Wallet.createRandom()))
    await assert.rejects(deliver(first,validator,{recipient:await seller.getAddress()}))
    await deliver(first)
    await assert.rejects(escrow.connect(stranger).confirm(first))
    await assert.rejects(escrow.releaseAfterReview(first))
    await receipt(escrow.confirm(first))
    assert.equal(await escrow.credits(await seller.getAddress()),principal)
    assert.equal(await escrow.reserveBalance(),300_000n)
    assert.equal(await escrow.credits(await revenue.getAddress()),700_000n)
    await assert.rejects(escrow.confirm(first))
    const before=await token.balanceOf(await seller.getAddress())
    await receipt(escrow.connect(seller).withdraw())
    assert.equal(await token.balanceOf(await seller.getAddress()),before+principal)
    await assert.rejects(escrow.connect(seller).withdraw())
    const expired=await fund();await advance(7201)
    await receipt(escrow.connect(stranger).refundUndelivered(expired))
    assert.equal(await escrow.credits(await buyer.getAddress()),principal+fee)
    await assert.rejects(deliver(expired))
    const auto=await fund();await deliver(auto);await advance(3601)
    await receipt(escrow.connect(stranger).releaseAfterReview(auto))
    const disputed=await fund();await deliver(disputed);await receipt(escrow.dispute(disputed))
    await assert.rejects(escrow.releaseAfterReview(disputed))
    await assert.rejects(escrow.connect(stranger).resolve(disputed,true,0))
    await assert.rejects(escrow.connect(arb).resolve(disputed,true,25_000_000n))
    const reserve=await escrow.reserveBalance()
    await receipt(escrow.connect(arb).resolve(disputed,true,100_000n))
    assert.equal(await escrow.reserveBalance(),reserve+300_000n-100_000n)
    const stalled=await fund();await deliver(stalled);await receipt(escrow.dispute(stalled))
    await assert.rejects(escrow.settleStalledDispute(stalled))
    await advance(7*86400+1)
    await receipt(escrow.connect(stranger).settleStalledDispute(stalled))
    await assert.rejects(escrow.connect(arb).resolve(stalled,false,0))
    const balances=await Promise.all([buyer,seller,revenue].map(async s=>escrow.credits(await s.getAddress())))
    assert.equal(await token.balanceOf(await escrow.getAddress()),balances.reduce((a,b)=>a+b,0n)+await escrow.reserveBalance())
    await receipt(token.setBlocked(await seller.getAddress(),true))
    await assert.rejects(escrow.connect(seller).withdraw())
    assert.equal(await escrow.credits(await seller.getAddress()),balances[1])
    await receipt(escrow.connect(revenue).withdraw())
    t.diagnostic('101 USDC funded → 100 fulfiller + 0.30 reserve + 0.70 revenue; all accounting remains solvent.')
  }finally{await chain.close();provider.destroy()}
})
