export function exportStoryboardToPdf(project) {
  if (typeof window === 'undefined') {
    throw new Error('PDF export is only available in the app UI.');
  }

  const html = buildStoryboardPdfHtml(project);
  const popup = window.open('', '_blank', 'width=1280,height=900');
  if (popup) {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();

    const closePopup = () => {
      try {
        popup.close();
      } catch {
        // no-op
      }
    };

    const printWhenReady = () => {
      popup.focus();
      popup.addEventListener('afterprint', closePopup, { once: true });
      popup.print();
      setTimeout(closePopup, 1200);
    };

    if (popup.document.readyState === 'complete') {
      setTimeout(printWhenReady, 120);
    } else {
      popup.addEventListener('load', () => setTimeout(printWhenReady, 120), { once: true });
    }
    return;
  }

  printWithHiddenIframe(html);
}

export function buildStoryboardPdfHtml(project) {
  const title = String(project?.name || 'Storyboard Export').trim() || 'Storyboard Export';
  const shots = flattenShots(project);
  const pages = chunk(shots, 3);

  const pageMarkup =
    pages.length > 0
      ? pages
          .map(
            (group, pageIndex) => `
              <section class="sb-pdf-page sb-pdf-page-${group.length}" data-page="${
                pageIndex + 1
              }" data-count="${group.length}">
                <header class="sb-pdf-page-head">
                  <h2>${escapeHtml(title)}</h2>
                  <span>Page ${pageIndex + 1} of ${pages.length}</span>
                </header>
                <div class="sb-pdf-grid">
                  ${group.map((shot) => renderShotCard(shot)).join('')}
                </div>
              </section>
            `
          )
          .join('')
      : `
        <section class="sb-pdf-page">
          <header class="sb-pdf-page-head">
            <h2>${escapeHtml(title)}</h2>
            <span>No shots</span>
          </header>
          <div class="sb-pdf-empty">No shots to export yet.</div>
        </section>
      `;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)} - Storyboard PDF</title>
    <style>
      @page {
        size: A4;
        margin: 12mm;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        color: #111827;
        background: #f8fafc;
      }

      .sb-pdf-page {
        width: 100%;
        height: calc(297mm - 24mm);
        background: #ffffff;
        border: 1px solid #d9e1ea;
        border-radius: 8px;
        padding: 10mm;
        margin: 0 0 8mm 0;
        page-break-after: always;
        display: flex;
        flex-direction: column;
      }

      .sb-pdf-page:last-child {
        page-break-after: auto;
      }

      .sb-pdf-page-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid #d9e1ea;
      }

      .sb-pdf-page-head h2 {
        margin: 0;
        font-size: 14px;
        letter-spacing: 0.02em;
      }

      .sb-pdf-page-head span {
        color: #6b7280;
        font-size: 11px;
      }

      .sb-pdf-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
        flex: 1;
        min-height: 0;
        align-content: stretch;
      }

      .sb-pdf-page-1 .sb-pdf-grid {
        grid-template-rows: minmax(0, 1fr);
      }

      .sb-pdf-page-2 .sb-pdf-grid {
        grid-template-rows: repeat(2, minmax(0, 1fr));
      }

      .sb-pdf-page-3 .sb-pdf-grid {
        grid-template-rows: repeat(3, minmax(0, 1fr));
      }

      .sb-pdf-card {
        border: 1px solid #cdd5df;
        border-radius: 8px;
        overflow: hidden;
        min-height: 0;
        display: grid;
        grid-template-rows: auto 1fr;
        height: 100%;
      }

      .sb-pdf-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        border-bottom: 1px solid #d9e1ea;
        background: #f8fafc;
        font-size: 10px;
      }

      .sb-pdf-card-head strong {
        font-size: 10px;
      }

      .sb-pdf-card-head span {
        color: #4b5563;
      }

      .sb-pdf-card-body {
        display: grid;
        grid-template-columns: minmax(180px, 46%) minmax(0, 1fr);
        min-height: 0;
      }

      .sb-pdf-frame {
        border-right: 1px solid #d9e1ea;
        min-height: 0;
        display: grid;
        place-items: center;
        background: #f1f5f9;
      }

      .sb-pdf-frame img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .sb-pdf-frame-empty {
        color: #64748b;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .sb-pdf-copy {
        padding: 6px 8px;
        display: grid;
        align-content: start;
        gap: 5px;
      }

      .sb-pdf-copy h3 {
        margin: 0;
        font-size: 12px;
        line-height: 1.25;
      }

      .sb-pdf-line {
        margin: 0;
        font-size: 10px;
        line-height: 1.35;
      }

      .sb-pdf-label {
        font-weight: 700;
        color: #0f172a;
      }

      .sb-pdf-muted {
        color: #6b7280;
      }

      .sb-pdf-empty {
        min-height: 140px;
        border: 1px dashed #cdd5df;
        border-radius: 8px;
        display: grid;
        place-items: center;
        color: #6b7280;
        font-size: 12px;
      }

      @media print {
        body {
          background: #ffffff;
        }
      }
    </style>
  </head>
  <body>
    ${pageMarkup}
  </body>
</html>`;
}

function printWithHiddenIframe(html) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      // no-op
    }
  };

  iframe.onload = () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      throw new Error('Unable to prepare print preview.');
    }

    frameWindow.focus();
    frameWindow.addEventListener('afterprint', cleanup, { once: true });
    frameWindow.print();
    setTimeout(cleanup, 2000);
  };

  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    cleanup();
    throw new Error('Unable to prepare print preview.');
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
}

function flattenShots(project) {
  const characters = Array.isArray(project?.entities?.characters) ? project.entities.characters : [];
  const characterMap = new Map(
    characters.map((character) => [String(character?.id || ''), String(character?.name || '').trim()])
  );

  const shots = [];
  const acts = Array.isArray(project?.storyboard?.acts) ? project.storyboard.acts : [];
  for (const act of acts) {
    const actNumber = Number(act?.number || 0);
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const sequenceNumber = Number(sequence?.number || 0);
      const sequenceTitle = String(sequence?.title || '').trim();
      const sceneItems = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
      for (const scene of sceneItems) {
        const cast = normalizeStringArray(scene?.characterIds)
          .map((id) => characterMap.get(id) || id)
          .filter(Boolean)
          .join(', ');

        shots.push({
          id: String(scene?.id || '').trim() || `${actNumber}.${sequenceNumber}.${shots.length + 1}`,
          actNumber,
          sequenceNumber,
          sequenceTitle,
          title: String(scene?.title || '').trim() || 'Untitled Shot',
          storyFunction: String(scene?.storyFunction || '').trim(),
          action: String(scene?.action || '').trim(),
          location: String(scene?.location || '').trim(),
          time: String(scene?.time || '').trim(),
          mood: String(scene?.mood || '').trim(),
          cast,
          imageUrl: typeof scene?.imageUrl === 'string' && scene.imageUrl.trim() ? scene.imageUrl : '',
        });
      }
    }
  }

  return shots;
}

function renderShotCard(shot) {
  const sceneRef = `SQ${shot.actNumber} / SC${shot.sequenceNumber}`;
  const locationLine = [shot.location, shot.time].filter(Boolean).join(' | ');
  const moodLine = shot.mood || 'Not set';

  return `
    <article class="sb-pdf-card">
      <header class="sb-pdf-card-head">
        <strong>${escapeHtml(sceneRef)}</strong>
        <span>${escapeHtml(shot.id)}</span>
      </header>
      <div class="sb-pdf-card-body">
        <div class="sb-pdf-frame">
          ${
            shot.imageUrl
              ? `<img src="${escapeHtml(shot.imageUrl)}" alt="${escapeHtml(shot.title)}" />`
              : '<span class="sb-pdf-frame-empty">No Frame</span>'
          }
        </div>
        <div class="sb-pdf-copy">
          <h3>${escapeHtml(shot.title)}</h3>
          <p class="sb-pdf-line"><span class="sb-pdf-label">Scene:</span> ${escapeHtml(
            shot.sequenceTitle || 'Untitled Scene'
          )}</p>
          <p class="sb-pdf-line"><span class="sb-pdf-label">Story Beat:</span> ${escapeHtml(
            shot.storyFunction || 'Not set'
          )}</p>
          <p class="sb-pdf-line"><span class="sb-pdf-label">Action:</span> ${escapeHtml(
            shot.action || 'Not set'
          )}</p>
          <p class="sb-pdf-line"><span class="sb-pdf-label">Location/Time:</span> ${escapeHtml(
            locationLine || 'Not set'
          )}</p>
          <p class="sb-pdf-line"><span class="sb-pdf-label">Mood:</span> ${escapeHtml(moodLine)}</p>
          <p class="sb-pdf-line sb-pdf-muted"><span class="sb-pdf-label">Cast:</span> ${escapeHtml(
            shot.cast || 'None'
          )}</p>
        </div>
      </div>
    </article>
  `;
}

function chunk(values, size) {
  const input = Array.isArray(values) ? values : [];
  const safeSize = Math.max(1, Number(size) || 1);
  const groups = [];
  for (let index = 0; index < input.length; index += safeSize) {
    groups.push(input.slice(index, index + safeSize));
  }
  return groups;
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const __pdfExportTestUtils = {
  flattenShots,
  chunk,
  escapeHtml,
};
