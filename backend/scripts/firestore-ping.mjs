// READ-ONLY connectivity check against the real Firestore. Writes nothing. Prints no credentials.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

delete process.env.FIRESTORE_EMULATOR_HOST;
const sa = JSON.parse(fs.readFileSync(process.env.SA_PATH, 'utf8'));
console.log('project_id in key:', sa.project_id, '| client_email domain:', sa.client_email.split('@')[1]);
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(app);
try {
  const cols = await db.listCollections();
  console.log('AUTH OK. Top-level collections:', cols.map((c) => c.id).join(', ') || '(none yet)');
  for (const c of cols) {
    const snap = await c.count().get();
    console.log(`  ${c.id}: ${snap.data().count} docs`);
  }
} catch (e) {
  console.log('FAILED:', e.code ?? '', String(e.message).split('\n')[0].slice(0, 200));
  process.exitCode = 1;
}
process.exit();
