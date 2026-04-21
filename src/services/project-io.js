/**
 * Project I/O — browser download / upload helpers.
 *
 * Wraps `exportProjectBundle` / `importProjectBundle` from storage.js with
 * the browser plumbing needed to turn a JS object into a downloaded file
 * and a picked file back into a bundle.
 *
 * In the electron build, the underlying storage helpers throw with a clear
 * "use ~/Storyboarder directly" message — these helpers will surface that.
 */

import {
  exportProjectBundle,
  importProjectBundle,
  loadProject,
} from './storage.js';

/**
 * Export a project to a JSON file and trigger a browser download.
 * Returns the filename that was downloaded.
 */
export async function downloadProjectBundle(projectId) {
  const bundle = await exportProjectBundle(projectId);
  if (!bundle) {
    throw new Error('Project not found.');
  }
  const project = bundle.project || (await loadProject(projectId));
  const rawName = String(project?.name || 'storyboard').trim() || 'storyboard';
  const safeName = rawName.replace(/[^a-z0-9_\- ]+/gi, '').replace(/\s+/g, '-').toLowerCase() || 'storyboard';
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${safeName}-${stamp}.storyboard.json`;

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // Small delay so the download negotiation completes before we revoke.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return filename;
}

/**
 * Prompt the user to pick a .storyboard.json file and import it.
 * Returns the imported project id, or null if the user cancelled.
 */
export function pickAndImportProjectBundle() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';

    // Fires when the user cancels (supported in Chrome/Safari 123+; harmless elsewhere).
    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
      resolve(null);
    });

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        const projectId = await importProjectBundle(bundle);
        resolve(projectId);
      } catch (err) {
        reject(err);
      }
    });

    document.body.appendChild(input);
    input.click();
  });
}
