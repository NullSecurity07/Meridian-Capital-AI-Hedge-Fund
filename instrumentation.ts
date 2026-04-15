// instrumentation.ts — Next.js 14.2+ stable hook, runs once on Node.js boot
// Guards against Edge runtime (which can't use better-sqlite3)

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { autoStart } = await import('./lib/auto-start')
    autoStart()
  }
}
