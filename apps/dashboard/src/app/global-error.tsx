'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ background: '#050508', color: '#f0edf5', fontFamily: 'monospace', padding: '2rem' }}>
        <h2>Something went wrong</h2>
        <pre style={{ color: '#ff6b6b', whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
          {error.message}
        </pre>
        <pre style={{ color: '#888', whiteSpace: 'pre-wrap', marginTop: '1rem', fontSize: '0.8rem' }}>
          {error.stack}
        </pre>
        <button
          onClick={() => reset()}
          style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#00E5FF', color: '#050508', border: 'none', cursor: 'pointer' }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
