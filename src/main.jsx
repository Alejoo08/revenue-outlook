import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { msalInstance } from './lib/msal'

const root = createRoot(document.getElementById('root'))

msalInstance.initialize().then(() => {
  msalInstance.handleRedirectPromise().then((response) => {
    if (response?.account) {
      msalInstance.setActiveAccount(response.account)
    } else if (!msalInstance.getActiveAccount() && msalInstance.getAllAccounts().length > 0) {
      msalInstance.setActiveAccount(msalInstance.getAllAccounts()[0])
    }
    root.render(<StrictMode><App /></StrictMode>)
  })
})