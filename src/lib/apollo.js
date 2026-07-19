import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { msalInstance, fabricScopes } from './msal'

const httpLink = createHttpLink({
  uri: import.meta.env.VITE_GRAPHQL_ENDPOINT,
})

const authLink = setContext(async (_, { headers }) => {
  const account = msalInstance.getActiveAccount()
  if (!account) return { headers }

  try {
    const { accessToken } = await msalInstance.acquireTokenSilent({
      ...fabricScopes,
      account,
    })
    return {
      headers: {
        ...headers,
        authorization: `Bearer ${accessToken}`,
      },
    }
  } catch {
    await msalInstance.acquireTokenRedirect(fabricScopes)
    return { headers }
  }
})

export const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
})
