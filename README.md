# Revenue Outlook

React app that reads revenue/issuance data from Microsoft Fabric via GraphQL API.

## Setup

1. Install dependencies:
```
npm install
```

2. Run locally:
```
npm run dev
```

3. Open http://localhost:5173 — sign in with your Moody's account.

## Project structure

```
src/
  lib/
    msal.js        # Azure AD authentication config
    apollo.js      # GraphQL client with auth
    forecast.js    # Aggregation and MA calculation logic
  graphql/
    queries.js     # GraphQL queries
  pages/
    Login.jsx      # Login page
    Dashboard.jsx  # Main forecast dashboard
  App.jsx          # Root component with auth routing
  main.jsx         # Entry point
.env               # Environment variables (do not commit)
```

## Environment variables (.env)

```
VITE_AAD_CLIENT_ID=      # App Registration client ID
VITE_AAD_TENANT_ID=      # Azure tenant ID
VITE_GRAPHQL_ENDPOINT=   # Fabric GraphQL API endpoint
```

## Before first run

Make sure your App Registration in Entra ID has:
- Redirect URI: http://localhost:5173 (SPA platform)
- API permissions: Power BI Service > Delegated > GraphQLApi.Execute.All
