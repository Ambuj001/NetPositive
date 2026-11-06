// Usage: node --import ./test-support/register.mjs <script>
// Makes the backend use the in-memory Firestore stand-in. Refuses to run with real credentials present.
import { register } from 'node:module';

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Refusing to run: real Firebase credentials are set in the environment. Unset them; tests must never touch a real project.');
  process.exit(1);
}
register('./hooks.mjs', import.meta.url);
