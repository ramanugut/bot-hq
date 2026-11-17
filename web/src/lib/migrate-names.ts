// Settings saved in the browser before the app was called Botly: carry them over to the new names, once.
try {
  for (const key of ['theme', 'selectedBot', 'detailsOpen', 'sidebarCollapsed', 'hideSuggested']) {
    const old = localStorage.getItem(`grokbot.${key}`);
    if (old === null) continue;
    if (localStorage.getItem(`botly.${key}`) === null) localStorage.setItem(`botly.${key}`, old);
    localStorage.removeItem(`grokbot.${key}`);
  }
} catch { /* storage unavailable */ }
export {};
