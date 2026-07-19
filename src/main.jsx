import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { msalInstance } from './lib/msal'

const root = createRoot(document.getElementById('root'))

function renderFatalError(message) {
  root.render(
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
        color: '#4F5153',
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ fontSize: 18, color: '#0A1264', marginBottom: 8 }}>
          Revenue Outlook could not start
        </h1>
        <p style={{ fontSize: 14, maxWidth: 420, margin: '0 auto' }}>{message}</p>
      </div>
    </div>,
  )
}

async function bootstrap() {
  await msalInstance.initialize()

  const response = await msalInstance.handleRedirectPromise()
  if (response?.account) {
    msalInstance.setActiveAccount(response.account)
  } else if (!msalInstance.getActiveAccount() && msalInstance.getAllAccounts().length > 0) {
    msalInstance.setActiveAccount(msalInstance.getAllAccounts()[0])
  }

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap().catch((error) => {
  console.error('[bootstrap] MSAL initialization failed', error)
  renderFatalError(
    'Authentication could not be initialized. Please refresh the page, and check your network and sign-in configuration.',
  )
})
