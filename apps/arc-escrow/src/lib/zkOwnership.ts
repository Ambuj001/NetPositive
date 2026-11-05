/**
 * Zero-knowledge proof of record ownership: a Fiat-Shamir Schnorr proof of knowledge of a
 * secret scalar `s` behind a public commitment `P = s*G` on secp256k1.
 *
 * WHAT THIS PROVES: the prover knows the ownership secret stored with a vault record.
 * WHAT THIS DOES NOT PROVE: that the voucher is valid, unredeemed, funded, or even exists.
 * A commitment can be made for any random secret, so verifiers must never treat a verified proof
 * as evidence about the voucher itself.
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/abstract/utils'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes, type Hex } from 'viem'

const { n: ORDER } = secp256k1.CURVE
const G = secp256k1.ProjectivePoint.BASE
const TAG = new TextEncoder().encode('NetPositive/ownership-proof/v1')

export interface OwnershipProof {
  /** Nonce commitment R = k*G, compressed (33 bytes). */
  R: Hex
  /** Response z = k + e*s mod n (32 bytes). */
  z: Hex
}

export interface OwnershipKeypair {
  /** Secret scalar, 32 bytes. Stays inside the vault. */
  secret: Hex
  /** Public commitment P = s*G, compressed (33 bytes). */
  commitment: Hex
}

const randomScalar = (): bigint => {
  for (;;) {
    const s = bytesToNumberBE(crypto.getRandomValues(new Uint8Array(32))) % ORDER
    if (s !== 0n) return s
  }
}

const scalarHex = (s: bigint): Hex => bytesToHex(numberToBytesBE(s, 32))

export function newOwnershipKeypair(): OwnershipKeypair {
  const s = randomScalar()
  return { secret: scalarHex(s), commitment: bytesToHex(G.multiply(s).toRawBytes(true)) }
}

function challenge(R: Uint8Array, P: Uint8Array, context: string): bigint {
  const ctx = new TextEncoder().encode(context)
  const msg = new Uint8Array(TAG.length + R.length + P.length + ctx.length)
  msg.set(TAG, 0)
  msg.set(R, TAG.length)
  msg.set(P, TAG.length + R.length)
  msg.set(ctx, TAG.length + R.length + P.length)
  return bytesToNumberBE(sha256(msg)) % ORDER
}

/** `context` binds the proof to a verifier-chosen challenge so it cannot be replayed elsewhere. */
export function proveOwnership(secret: Hex, context: string): OwnershipProof {
  const s = bytesToNumberBE(hexToBytes(secret))
  if (s <= 0n || s >= ORDER) throw new Error('Invalid ownership secret')
  const P = G.multiply(s).toRawBytes(true)
  const k = randomScalar()
  const R = G.multiply(k).toRawBytes(true)
  const e = challenge(R, P, context)
  const z = (k + e * s) % ORDER
  return { R: bytesToHex(R), z: scalarHex(z) }
}

/** Returns false for any malformed input instead of throwing. */
export function verifyOwnership(commitment: Hex, proof: OwnershipProof, context: string): boolean {
  try {
    const pBytes = hexToBytes(commitment)
    const rBytes = hexToBytes(proof.R)
    if (pBytes.length !== 33 || rBytes.length !== 33) return false
    const P = secp256k1.ProjectivePoint.fromHex(pBytes)
    const R = secp256k1.ProjectivePoint.fromHex(rBytes)
    P.assertValidity()
    R.assertValidity()
    if (P.equals(secp256k1.ProjectivePoint.ZERO) || R.equals(secp256k1.ProjectivePoint.ZERO)) return false
    const zBytes = hexToBytes(proof.z)
    if (zBytes.length !== 32) return false
    const z = bytesToNumberBE(zBytes)
    if (z <= 0n || z >= ORDER) return false
    const e = challenge(rBytes, pBytes, context)
    return G.multiply(z).equals(R.add(P.multiply(e)))
  } catch {
    return false
  }
}
