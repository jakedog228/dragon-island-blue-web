// Read-only HTTP proof, also used inside the deployed image before accepting activation.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [base, manifestPath] = process.argv.slice(2);
if (!base || !manifestPath) throw new Error('usage: verify-mods.mjs <origin> <publish-manifest.json>');
const expected = JSON.parse(await readFile(manifestPath, 'utf8'));
async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
// Caddy's active health check may briefly retain the old container's unavailable state after
// Docker reports the replacement healthy. Wait for the public route as well as container health.
for (let attempt = 0; ; attempt++) {
  try {
    const ready = await (await get('/api/game/readiness')).json();
    if (!ready.ready) throw new Error('Game service is not ready');
    break;
  } catch (error) {
    if (attempt === 14) throw error;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
let next = null;
const listings = [];
do {
  const query = new URLSearchParams({ source: 'official' });
  if (next !== null) query.set('offset', String(next));
  const page = await (await get(`/api/community/mods?${query}`)).json();
  listings.push(...page.mods);
  next = page.next;
} while (next);
if (listings.length !== expected.length) throw new Error(`Expected ${expected.length} listings, received ${listings.length}`);
for (const entry of expected) {
  const listing = listings.find(item => item.id === entry.id);
  if (!listing || listing.modId !== entry.modId || listing.title !== entry.title ||
      listing.summary !== entry.summary || listing.author.displayName !== entry.author ||
      JSON.stringify(listing.screenshots) !== JSON.stringify(entry.screenshots) ||
      JSON.stringify(listing.releases.map(({ version, digest, byteLength }) => ({ version, digest, byteLength }))) !== JSON.stringify(entry.releases)) {
    throw new Error(`Catalog metadata differs for ${entry.title}`);
  }
  for (const [kind, digests] of [['download', entry.releases.map(release => release.digest)], ['image', entry.screenshots]]) {
    for (const digest of digests) {
      const bytes = Buffer.from(await (await get(`/api/community/mods/${entry.id}/${kind}/${digest}`)).arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error(`Bad ${kind} digest for ${entry.title}`);
    }
  }
  console.log(`Verified ${entry.title}: ${entry.releases.length} release(s), ${entry.screenshots.length} screenshot(s)`);
}
