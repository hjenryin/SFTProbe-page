// Keep the two existing, same-origin HTML interactives at their natural height.
for (const frame of document.querySelectorAll('iframe[data-auto-height]')) {
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    let pending = false;
    const fit = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        const wrap = doc.querySelector('.wrap');
        if (wrap) {
          const styles = getComputedStyle(wrap);
          const height = Math.ceil(wrap.getBoundingClientRect().height
            + parseFloat(styles.marginTop) + parseFloat(styles.marginBottom) + 4);
          if (Math.abs(frame.clientHeight - height) > 2) frame.style.height = `${height}px`;
        }
        pending = false;
      });
    };
    if (doc.querySelector('.wrap')) new ResizeObserver(fit).observe(doc.querySelector('.wrap'));
    fit();
  });
}

const copyButton = document.querySelector('#copy-bibtex');
copyButton.addEventListener('click', async () => {
  const citation = document.querySelector('#bibtex').textContent;
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(citation);
    status.textContent = 'Citation copied.';
    copyButton.textContent = 'Copied';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#bibtex'));
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = 'Citation selected. Press Ctrl+C or ⌘C to copy.';
  }
});
