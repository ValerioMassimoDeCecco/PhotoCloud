import React, { useEffect } from 'react';

/**
 * PhotoCloud è 100% Zero-Knowledge End-to-End (v2):
 * la modalità classica con cifratura lato server (v1) è stata rimossa definitivamente.
 * Qualsiasi apertura della SPA radice reindirizza immediatamente al Vault Zero-Knowledge /v2.
 */
export function App() {
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/v2')) {
      window.location.replace('/v2');
    }
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
      <section className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-8 text-center shadow-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-white">PhotoCloud Zero-Knowledge</h1>
        <p className="mt-3 text-sm text-slate-300">
          Reindirizzamento al Vault crittografato End-to-End lato client (Argon2id + AES-256-GCM)...
        </p>
        <a
          href="/v2"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          Apri Vault Zero-Knowledge (/v2)
        </a>
      </section>
    </main>
  );
}

export default App;
