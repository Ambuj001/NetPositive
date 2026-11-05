// Regenerates src/abi/netPositiveAbi.ts from the Foundry artifact. Run `forge build` first.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const artifact = JSON.parse(readFileSync('contracts/out/NetPositive.sol/NetPositive.json', 'utf8')) as { abi: unknown }
mkdirSync('src/abi', { recursive: true })
writeFileSync(
  'src/abi/netPositiveAbi.ts',
  `// Generated from contracts/out/NetPositive.sol by scripts/export-abi.ts. Do not edit.\nexport const netPositiveAbi = ${JSON.stringify(artifact.abi, null, 2)} as const\n`,
)
console.log('ABI written to src/abi/netPositiveAbi.ts')
