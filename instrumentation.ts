// instrumentation.ts
// Next.js 14.2+ calls register() once when the Node.js server process boots.
// This is the only reliable place to auto-start background work before any
// route handler is served.
export async function register() {
  // Guard: only run in Node.js runtime (not Edge). better-sqlite3 requires Node.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { autoStart } = await import('./lib/auto-start')
    autoStart()
  }
}
