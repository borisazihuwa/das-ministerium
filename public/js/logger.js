// ============================================================
// Das Ministerium — Game Event Logger
// ============================================================

const MAX_LOG_ENTRIES = 200;

let logContainer = null;

export function initLogger(container) {
  logContainer = container;
}

export function renderLog(entries) {
  if (!logContainer) return;

  logContainer.innerHTML = '';
  const recentEntries = entries.slice(-50); // Show last 50

  for (const entry of recentEntries) {
    const div = document.createElement('div');
    div.className = 'log-entry';

    if (entry.startsWith('---')) {
      div.classList.add('log-round');
    } else if (entry.includes('verliert') || entry.includes('FALSCH') || entry.includes('scheidet aus')) {
      div.classList.add('log-negative');
    } else if (entry.includes('erhält') || entry.includes('nimmt') || entry.includes('RICHTIG') || entry.includes('gewinnt')) {
      div.classList.add('log-positive');
    } else if (entry.includes('blockiert') || entry.includes('zeigt') || entry.includes('Anzeige')) {
      div.classList.add('log-reaction');
    }

    div.textContent = entry;
    logContainer.appendChild(div);
  }

  logContainer.scrollTop = logContainer.scrollHeight;
}
