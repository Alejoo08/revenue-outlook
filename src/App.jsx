import { MsalProvider, AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react'
import { ApolloProvider } from '@apollo/client'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { msalInstance } from './lib/msal'
import { apolloClient } from './lib/apollo'
import RevenueOutlook from './pages/RevenueOutlook'
import Login from './pages/Login'

// ─── Dev toggle ──────────────────────────────────────────────────────
// Set to false once admin consent is granted, to re-enable the login flow
const BYPASS_AUTH = false
// ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <MantineProvider>
        <ApolloProvider client={apolloClient}>
          {BYPASS_AUTH ? (
            <RevenueOutlook />
          ) : (
            <>
              <AuthenticatedTemplate>
                <RevenueOutlook />
              </AuthenticatedTemplate>
              <UnauthenticatedTemplate>
                <Login />
              </UnauthenticatedTemplate>
            </>
          )}
        </ApolloProvider>
      </MantineProvider>
    </MsalProvider>
  )
}