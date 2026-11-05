import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet } from 'ethers'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashSignal } from '@worldcoin/idkit-core/hashing'
import { createApp } from '../src/app.ts'
import { newKey, encryptRecord } from '@netpositive/vault'
import type { FastifyInstance } from 'fastify'
async function login(app:FastifyInstance,wallet=Wallet.createRandom()) {
  const address=wallet.address.toLowerCase()
  const c=await app.inject({method:'POST',url:'/v1/auth/challenge',payload:{address}})
  const signature=await wallet.signMessage(c.json().message)
  const v=await app.inject({method:'POST',url:'/v1/auth/verify',payload:{address,signature}})
  assert.equal(v.statusCode,200)
  return {headers:{authorization:`Bearer ${v.json().token}`},address,wallet,signature}
}
test('signed sessions, replay protection, private immutable storage and expiry',async()=>{
  let now=Date.now()
  const dir=mkdtempSync(join(tmpdir(),'netpositive-api-')), database=join(dir,'test.sqlite')
  const app=await createApp({database,origin:'http://127.0.0.1:5173'},{now:()=>now})
  try {
    assert.equal((await app.inject({url:'/v1/vault'})).statusCode,401)
    const a=await login(app),b=await login(app)
    assert.equal((await app.inject({method:'POST',url:'/v1/auth/verify',payload:{address:a.address,signature:a.signature}})).statusCode,401)
    const e=await encryptRecord(newKey(),{kind:'gift-card',brand:'TEST',code:'SECRET-SYNTHETIC-NOT-REAL',valueMinor:100,currency:'INR'})
    assert.equal((await app.inject({method:'PUT',url:`/v1/vault/${e.id}`,headers:a.headers,payload:e})).statusCode,200)
    assert.equal((await app.inject({method:'PUT',url:`/v1/vault/${e.id}`,headers:a.headers,payload:e})).statusCode,200)
    assert.equal((await app.inject({method:'PUT',url:`/v1/vault/${e.id}`,headers:b.headers,payload:e})).statusCode,409)
    assert.equal((await app.inject({method:'PUT',url:`/v1/vault/${e.id}`,headers:a.headers,payload:{...e,cvv:'123'}})).statusCode,400)
    assert.equal((await app.inject({method:'PUT',url:`/v1/vault/${e.id}`,headers:a.headers,payload:{...e,iv:'00'.repeat(12)}})).statusCode,409)
    assert.equal((await app.inject({url:'/v1/vault',headers:b.headers})).json().records.length,0)
    const result=await app.inject({url:'/v1/vault',headers:a.headers})
    assert.equal(result.json().records.length,1)
    assert.equal(result.headers['cache-control'],'no-store')
    assert.equal((await app.inject({url:'/health',headers:{origin:'https://evil.example'}})).statusCode,403)
    assert.equal((await app.inject({method:'POST',url:'/v1/world/request',headers:a.headers})).statusCode,503)
    now+=900001
    assert.equal((await app.inject({url:'/v1/vault',headers:a.headers})).statusCode,401)
  } finally {await app.close()}
  assert.equal(readFileSync(database).includes(Buffer.from('SECRET-SYNTHETIC-NOT-REAL')),false)
  const reopened=await createApp({database,origin:'http://127.0.0.1:5173'})
  assert.equal((await reopened.inject({url:'/health'})).statusCode,200)
  await reopened.close();rmSync(dir,{recursive:true})
})
test('World v4 pinned context, production/staging rejection, upstream success required, banned/reused humans refused',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'netpositive-world-')), database=join(dir,'test.sqlite')
  let success=true, responseEnvironment='staging', calls=0
  const app=await createApp({database,origin:'http://127.0.0.1:5173',world:{appId:'app_test',rpId:'rp_test',signingKey:Wallet.createRandom().privateKey,environment:'staging'}},{fetch:(async(url,init)=>{
    calls++;assert.equal(url,'https://developer.world.org/api/v4/verify/rp_test'); assert.equal(init?.redirect,'error')
    return Response.json({success,environment:responseEnvironment})
  }) as typeof fetch})
  try {
    const a=await login(app), b=await login(app)
    async function payload(who:typeof a) {
      const r=await app.inject({method:'POST',url:'/v1/world/request',headers:who.headers})
      assert.equal(r.statusCode,200)
      return {protocol_version:'4.0',nonce:r.json().rp_context.nonce,action:r.json().action,environment:'staging',responses:[{identifier:'proof_of_human',issuer_schema_id:1,signal_hash:hashSignal(who.address),proof:['0x1','0x2','0x3','0x4','0x5'],nullifier:'0x01',expires_at_min:Math.floor(Date.now()/1000)+3600}]}
    }
    const p=await payload(a)
    let client=0
    const verify=(who:typeof a,body:object)=>app.inject({method:'POST',url:'/v1/world/verify',headers:who.headers,payload:body,remoteAddress:`10.0.0.${++client}`})
    assert.equal((await verify(a,{...p,environment:'production'})).statusCode,400)
    assert.equal((await verify(a,{...p,responses:[{...p.responses[0],signal_hash:hashSignal(b.address)}]})).statusCode,403)
    assert.equal(calls,0)
    success=false;assert.equal((await verify(a,p)).statusCode,403)
    success=true;responseEnvironment='production';assert.equal((await verify(a,p)).statusCode,403)
    responseEnvironment='staging';assert.equal((await verify(a,p)).statusCode,200)
    assert.equal((await verify(a,p)).statusCode,403)
    assert.equal((await app.inject({url:'/v1/trader',headers:a.headers})).json().verified,true)
    assert.equal((await verify(b,await payload(b))).statusCode,403)
    const db=new DatabaseSync(database);db.prepare('UPDATE humans SET banned=1 WHERE address=?').run(a.address);db.close()
    assert.equal((await verify(a,await payload(a))).statusCode,403)
    assert.equal((await app.inject({url:'/v1/trader',headers:a.headers})).json().verified,false)
    // A trading ban must not confiscate a user's encrypted personal vault.
    assert.equal((await app.inject({url:'/v1/vault',headers:a.headers})).statusCode,200)
  } finally {await app.close();rmSync(dir,{recursive:true})}
})
