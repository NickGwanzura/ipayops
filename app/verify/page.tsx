'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useEffect, useState } from 'react';

type Verification = { valid: boolean; error?: string; type?: string; generatedAt?: string; document?: { number: string; status: string; client_name: string; issued_at: string } };

function VerifyContent() {
  const params = useSearchParams();
  const [result, setResult] = useState<Verification | null>(null);
  useEffect(() => { void fetch(`/api/documents/verify?${params.toString()}`, { cache: 'no-store' }).then(response => response.json()).then(setResult).catch(() => setResult({ valid: false, error: 'Unable to verify this document.' })); }, [params]);
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#0b1f3a', color: '#f7fafc', fontFamily: "'Inter', ui-sans-serif, system-ui" }}><section style={{ width: 'min(100%, 520px)', padding: 32, borderRadius: 20, background: '#122b4e', border: '1px solid #31527b' }}><p style={{ color: '#61e7b5', letterSpacing: '.12em', textTransform: 'uppercase', fontSize: 12 }}>iPayTech document verification</p>{!result ? <h1>Checking document…</h1> : result.valid && result.document ? <><h1 style={{ marginBottom: 8 }}>Authentic document</h1><p>The document signature and timestamp are valid.</p><dl><dt>Document</dt><dd>{result.document.number}</dd><dt>Client</dt><dd>{result.document.client_name}</dd><dt>Status</dt><dd>{result.document.status}</dd><dt>Issued</dt><dd>{new Date(result.document.issued_at).toLocaleString()}</dd><dt>QR generated</dt><dd>{result.generatedAt ? new Date(result.generatedAt).toLocaleString() : '—'}</dd></dl></> : <><h1>Verification failed</h1><p>{result.error || 'This document could not be verified.'}</p></>}</section></main>;
}

export default function VerifyPage() {
  return <Suspense fallback={<main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b1f3a', color: '#f7fafc', fontFamily: "'Inter', ui-sans-serif, system-ui" }}>Checking document…</main>}><VerifyContent /></Suspense>;
}
