import { useMsal } from '@azure/msal-react'
import { fabricScopes } from '../lib/msal'
import { Button, Text, Center, Stack, Paper } from '@mantine/core'

const BRAND = {
  blue10: "#0A1264",
  brightBlue: "#005EFF",
  white: "#FFFFFF",
}

const FONT = "'GT America', 'Inter', 'Helvetica Neue', Arial, sans-serif"

export default function Login() {
  const { instance } = useMsal()

  const handleLogin = () => {
    instance.loginRedirect(fabricScopes)
  }

  return (
    <Center h="100vh">
      <Paper withBorder p="2rem" w={360} ta="center">
        <Stack gap="md">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>
            <img src="/moodylogo2.png" alt="Moody's" style={{ height: 50, width: "auto" }} />
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#000000", fontFamily: FONT }}>Revenue Outlook</h1>
          <Text c="dimmed" size="sm">Sign in with your Microsoft account (Entra ID)</Text>
          <Button onClick={handleLogin} fullWidth style={{ backgroundColor: BRAND.blue10 }}>
            Sign in with Microsoft
          </Button>
        </Stack>
      </Paper>
    </Center>
  )
}
