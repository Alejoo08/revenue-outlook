# Revenue Outlook

Executive dashboard for Moody's ratings **revenue** and **issuance**, reading
live data from Microsoft Fabric via its GraphQL API. Built with React + Vite,
authenticated against Microsoft Entra ID (Azure AD).

## Features

- **LOB Summary** — KPI rail (Revenue $M / Issuance $B) plus stacked
  actual-vs-budget-vs-forecast charts and variance tables by Line of Business.
- **Revenue Phasing** / **Issuance Phasing** — monthly / quarterly phasing with
  Forecast vs Budget vs Prior Year, plus a variance-driver breakdown by Sub-LOB.
- **Performance** — regional Forecast / Budget / Prior Year comparison.
- **Outlook Table** — YTD-actuals · YTG-model table (Prior Year, Jan–Dec, Q1–Q4,
  FY) with side-by-side growth-rate guidance (YTD / YTG / FY vs prior year).

### Forecasting rule

For the current year, every metric labelled *Fcst* blends **actuals for each
month already loaded** with the **Forecast for the remaining months**. The
cutoff month is detected from the data itself (the last month with a non-zero
actual), so the dashboard advances automatically as new actuals land — no code
change required.

## Tech stack

| Concern          | Library                                    |
| ---------------- | ------------------------------------------ |
| UI framework     | React 18 + Vite 5                          |
| Charts           | Recharts                                   |
| Component kit    | Mantine                                    |
| Data / GraphQL   | Apollo Client                              |
| Authentication   | MSAL (`@azure/msal-browser` / `-react`)    |

## Getting started

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- An Entra ID App Registration with access to the Fabric GraphQL endpoint

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#   then fill in the three VITE_* values (see below)

# 3. Run locally
npm run dev
```

Open http://localhost:5173 and sign in with your Moody's account.

### Environment variables

Copy `.env.example` to `.env` and set:

| Variable                | Description                              |
| ----------------------- | ---------------------------------------- |
| `VITE_AAD_CLIENT_ID`    | App Registration (client) ID             |
| `VITE_AAD_TENANT_ID`    | Azure / Entra ID tenant ID               |
| `VITE_GRAPHQL_ENDPOINT` | Fabric GraphQL API endpoint URL          |

`.env` is git-ignored and must never be committed.

### Entra ID App Registration

Make sure the App Registration has:

- **Redirect URI:** `http://localhost:5173` (SPA platform) for local dev, plus
  your deployed origin for production.
- **API permissions:** Power BI Service → Delegated → `GraphQLApi.Execute.All`
  (admin consent granted).

## Project structure

```
revenue-outlook/
├── index.html
├── vite.config.js
├── .env.example              # Template for local .env (safe to commit)
├── public/
│   ├── moodylogo.png         # Header logo (dark bg)
│   └── moodylogo2.png        # Login / light-header logo
└── src/
    ├── main.jsx              # Entry point; boots MSAL, then renders App
    ├── App.jsx               # Root component + auth routing
    ├── lib/
    │   ├── msal.js           # Entra ID (MSAL) configuration
    │   └── apollo.js         # Apollo GraphQL client with bearer-token auth
    ├── graphql/
    │   └── queries.js        # GET_REVENUE_DATA, GET_ISSUANCE_DATA
    └── pages/
        ├── Login.jsx         # Sign-in screen
        └── RevenueOutlook.jsx# Dashboard (tabs, charts, tables, forecast logic)
```

## Available scripts

| Command           | Description                          |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the Vite dev server (HMR)      |
| `npm run build`   | Production build to `dist/`          |
| `npm run preview` | Serve the production build locally   |

## Authentication flow

1. `main.jsx` initializes MSAL and processes any redirect response before
   rendering.
2. Unauthenticated users see `Login.jsx`; `loginRedirect` sends them through
   Entra ID.
3. `apollo.js` acquires a Fabric access token silently for every GraphQL
   request and attaches it as a bearer token; on failure it falls back to an
   interactive redirect.

> **Dev note:** `App.jsx` exposes a `BYPASS_AUTH` flag to render the dashboard
> without signing in. It must stay `false` in any committed / deployed build.
