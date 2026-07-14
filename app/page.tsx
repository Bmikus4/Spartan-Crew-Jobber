import AppShell from "./components/AppShell";

// The whole client-facing surface is the shell: nav rail (Dashboard) + Settings.
// The automation itself runs server-side in /api and is triggered by n8n.
export default function Page() {
  return <AppShell />;
}
