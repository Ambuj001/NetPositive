// Module-resolution hook: redirect firebase-admin to the in-memory stand-in. TESTS ONLY.
const MAP = {
  'firebase-admin/firestore': new URL('./fake-firestore.mjs', import.meta.url).href,
  'firebase-admin/app': new URL('./fake-app.mjs', import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
