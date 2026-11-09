import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { retailApi, userFacingError } from "@/lib/retail-api";

export const Route = createFileRoute("/setup/first-admin")({
  component: FirstAdminSetupPage,
});

function FirstAdminSetupPage() {
  const navigate = useNavigate();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void retailApi<{ available: boolean }>("/api/first-admin")
      .then(({ available: isAvailable }) => {
        if (active) setAvailable(isAvailable);
      })
      .catch((error) => {
        if (active) {
          setAvailable(false);
          setMessage(userFacingError(error, "Could not check setup status. Try again."));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    if (password.length < 10 || password !== confirmation) {
      setMessage(
        password.length < 10
          ? "Choose a password with at least 10 characters."
          : "The passwords do not match.",
      );
      return;
    }
    setWorking(true);
    setMessage("");
    try {
      await retailApi<{ ok: boolean }>("/api/first-admin", {
        method: "POST",
        json: {
          setup_token: setupToken,
          display_name: displayName.trim(),
          identifier: identifier.trim(),
          password,
        },
      });
      await retailApi<{ ok: boolean }>("/api/staff-login", {
        method: "POST",
        json: { identifier: identifier.trim(), password },
      });
      window.dispatchEvent(new CustomEvent("retailflow:session-change"));
      await navigate({ to: "/" });
    } catch (error) {
      setMessage(
        userFacingError(error, "Admin setup did not finish. Check the details and try again."),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 shadow-lg"
      >
        <div>
          <h1 className="text-xl font-bold">Set up the first Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This one-time setup creates an app-managed staff login. The setup code is consumed once.
          </p>
        </div>
        {available === null && <p role="status">Checking setup availability…</p>}
        {available === false && (
          <p role="alert" className="rounded-lg bg-muted p-3 text-sm">
            First-Admin setup is unavailable. The setup code may already have been used, or an Admin
            login is already configured.
          </p>
        )}
        {available && (
          <>
            <div className="space-y-1">
              <Label htmlFor="admin-name">Admin name</Label>
              <Input
                id="admin-name"
                required
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="admin-login">Email or mobile number</Label>
              <Input
                id="admin-login"
                required
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="owner@example.com or +91 98765 43210"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="setup-token">One-time setup code</Label>
              <Input
                id="setup-token"
                required
                type="password"
                autoComplete="off"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="admin-password">Create password</Label>
              <Input
                id="admin-password"
                required
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="admin-password-confirm">Confirm password</Label>
              <Input
                id="admin-password-confirm"
                required
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <Button className="w-full" disabled={working}>
              {working ? "Creating Admin…" : "Create Admin account"}
            </Button>
          </>
        )}
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <Link
          to="/"
          className="block text-center text-sm text-primary underline-offset-4 hover:underline"
        >
          Return to sign in
        </Link>
      </form>
    </main>
  );
}
