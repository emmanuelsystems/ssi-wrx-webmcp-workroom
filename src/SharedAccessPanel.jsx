import { useState } from "react";

export default function SharedAccessPanel({ configured, session, loading, error, onSignIn, onSignOut }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try { await onSignIn(email, password); } finally { setSubmitting(false); }
  }

  if (!configured) return <div className="shared-mode-banner legacy"><strong>Local workroom</strong><span>Browser-local fallback · shared mode is not configured.</span></div>;
  if (loading) return <div className="shared-mode-banner"><strong>Shared Workroom</strong><span>Loading authenticated state…</span></div>;
  if (session) return <div className="shared-mode-banner shared"><strong>Shared Workroom</strong><span>{session.user.email}</span><button type="button" onClick={onSignOut}>Sign out</button></div>;
  return <form className="shared-sign-in" onSubmit={submit}>
    <strong>Shared Workroom</strong><span>Sign in to open the shared state.</span>
    <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" required />
    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required />
    <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
    {error && <small role="alert">{error}</small>}
  </form>;
}
