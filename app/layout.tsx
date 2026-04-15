export const metadata = { title: 'Meridian Capital', description: 'AI Hedge Fund Dashboard' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#0a0e14', color: '#d1d5db', fontFamily: '"Courier New", Courier, monospace', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  )
}
