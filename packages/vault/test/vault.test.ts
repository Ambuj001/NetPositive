import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newKey, encryptRecord, decryptRecord, digestEnvelope, proofInput, exportBackup, importBackup, createRecipientKeys, publicRecipientKey, sealForRecipient, openShared, RecordSchema, FIELD } from '../src/index.ts'
const gift = { kind: 'gift-card' as const, brand: 'Synthetic voucher', code: 'TEST-ONLY-NOT-REDEEMABLE', valueMinor: 10000, currency: 'INR' }
test('randomized padded records roundtrip; wrong key, ciphertext, id and IV fail', async () => {
  const key = newKey(), a = await encryptRecord(key, gift), b = await encryptRecord(key, gift)
  assert.deepEqual(await decryptRecord(key, a), gift)
  assert.equal(a.ciphertext.length, 8224)
  assert.notEqual(a.ciphertext, b.ciphertext)
  assert.notEqual(await digestEnvelope(a), await digestEnvelope(b))
  await assert.rejects(decryptRecord(newKey(), a))
  for (const bad of [{...a,id:crypto.randomUUID()}, {...a,iv:'00'.repeat(12)}, {...a,ciphertext:(a.ciphertext[0]==='0'?'1':'0')+a.ciphertext.slice(1)}]) await assert.rejects(decryptRecord(key,bad))
  assert.ok(!JSON.stringify(a).includes(gift.code))
})
test('payment metadata allowlist rejects PAN, CVV, PIN, OTP, arbitrary tokens and unknown fields', async () => {
  const card = {kind:'payment-card',issuer:'TEST issuer',variant:'TEST card',network:'Visa',last4:'1234'}
  assert.ok(RecordSchema.safeParse(card).success)
  for(const name of ['pan','cvv','pin','otp','cardNumber','providerToken']) assert.equal(RecordSchema.safeParse({...card,[name]:'TEST'}).success,false)
  assert.equal(RecordSchema.safeParse({...card,last4:'4111111111111111'}).success,false)
  const k=newKey(); const e=await encryptRecord(k,RecordSchema.parse(card))
  assert.equal(e.ciphertext.length,8224)
  assert.deepEqual(await decryptRecord(k,e),card)
})
test('proof witnesses derive locally, bind encrypted digest, wallet and scope', async () => {
  const key = newKey(), e = await encryptRecord(key,gift), owner='0x'+'12'.repeat(20)
  const input=await proofInput(key,e,owner,7n)
  assert.deepEqual(input,await proofInput(key,e,owner,7n))
  assert.ok(BigInt(input.secret)>0n && BigInt(input.secret)<FIELD)
  assert.notEqual(input.digest,(await proofInput(key,await encryptRecord(key,gift),owner,7n)).digest)
  await assert.rejects(proofInput(key,e,owner,FIELD))
})
test('encrypted recovery works independently; wrong passphrase and modified backup fail', async () => {
  const key=newKey(), e=await encryptRecord(key,gift), pass='Synthetic recovery passphrase only 2026'
  const backup=await exportBackup(key,[e],pass)
  assert.ok(!JSON.stringify(backup).includes(gift.code))
  const restored=await importBackup(backup,pass)
  assert.deepEqual(restored.key,key)
  assert.deepEqual(await decryptRecord(restored.key,restored.envelopes[0]),gift)
  await assert.rejects(importBackup(backup,'Wrong synthetic passphrase 2026'))
  await assert.rejects(importBackup({...backup,iv:'00'.repeat(12)},pass))
  await assert.rejects(exportBackup(key,[e],'short'))
})
test('only intended recipient and trade can decrypt a share; payment cards cannot be shared', async () => {
  const recipient=await createRecipientKeys(), stranger=await createRecipientKeys()
  const context={tradeId:'0x'+'12'.repeat(32),recipient:'0x'+'ab'.repeat(20)}
  const shared=await sealForRecipient(gift,await publicRecipientKey(recipient.publicKey),context)
  assert.deepEqual(await openShared(shared,recipient.privateKey,context),gift)
  await assert.rejects(openShared(shared,stranger.privateKey,context))
  await assert.rejects(openShared(shared,recipient.privateKey,{...context,tradeId:'0x'+'13'.repeat(32)}))
  await assert.rejects(openShared({...shared,context:{...context,recipient:'0x'+'aa'.repeat(20)}},recipient.privateKey,context))
  await assert.rejects(sealForRecipient({kind:'payment-card',issuer:'TEST',variant:'TEST',network:'Visa',last4:'1234'},await publicRecipientKey(recipient.publicKey),context))
})
