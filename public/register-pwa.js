// Never cache decrypted media or authenticated pages for offline use.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/service-worker.js').catch(console.error);
}
