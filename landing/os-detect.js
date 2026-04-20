/**
 * Highlight the download card that matches the visitor's OS, and update the
 * download links to point directly at the right binary type.
 * Defaults remain the "latest release" page so a non-matching OS still works.
 */
(function () {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  let detected = null;
  if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) detected = 'mac';
  else if (/Win/i.test(platform) || /Windows/i.test(ua)) detected = 'win';
  else if (/Linux/i.test(platform) || /X11/i.test(ua)) detected = 'linux';

  const cards = document.querySelectorAll('.download-card');
  cards.forEach((card) => {
    if (card.dataset.os === detected) {
      card.style.borderColor = '#fbbf24';
      card.style.boxShadow = '0 0 0 1px #fbbf24 inset, 0 14px 32px rgba(251, 146, 60, 0.3)';
      // Prepend a "recommended for you" pill
      const pill = document.createElement('span');
      pill.textContent = 'For your computer';
      pill.style.cssText = [
        'position:absolute',
        'top:-10px',
        'left:16px',
        'background:linear-gradient(90deg,#fbbf24,#f97316)',
        'color:#0b1220',
        'font-size:0.66rem',
        'font-weight:600',
        'padding:0.15rem 0.55rem',
        'border-radius:999px',
        'letter-spacing:0.04em',
        'text-transform:uppercase',
      ].join(';');
      card.style.position = 'relative';
      card.prepend(pill);
    }
  });
})();
