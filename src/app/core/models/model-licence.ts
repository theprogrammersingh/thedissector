/**
 * Licence terms for the model weights this app downloads into the user's browser.
 *
 * These are not ours to relicense — the app's own MIT licence covers its source, not the weights.
 * Gemma in particular carries a notice-passthrough obligation in its Terms of Use, which means
 * the terms have to be reachable from the product itself, not just from a file in the repo. The
 * forensics screen already lists every model and its Hugging Face repo id, so that panel is where
 * this surfaces.
 */
export interface ModelLicence {
  name: string;
  url: string;
}

const GEMMA: ModelLicence = { name: 'Gemma Terms of Use', url: 'https://ai.google.dev/gemma/terms' };
const APACHE_2: ModelLicence = { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' };
const MIT: ModelLicence = { name: 'MIT', url: 'https://opensource.org/license/mit' };

/** Matched on the repo id because that is the one identifier every model descriptor carries. */
export function licenceForRepo(hfRepoId: string): ModelLicence | null {
  const repo = hfRepoId.toLowerCase();
  if (repo.includes('gemma')) return GEMMA;
  if (repo.includes('qwen')) return APACHE_2;
  if (repo.includes('minilm')) return APACHE_2;
  if (repo.includes('go_emotions')) return MIT;
  return null;
}
