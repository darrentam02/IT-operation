# CONTEXT — IT Operations Control Tower

A single-context project. The glossary below is the project's language: terms are
defined here as they crystallize, and code should speak them exactly.

## Glossary

**Staff User** — an internal IT Operations principal who signs in to the control
tower with email/password. The authenticated subject of all control surfaces.

**Vendor** — an external principal. Vendors execute purchase orders and report
milestones; they are distinctly NOT Staff Users, authenticate through the vendor
portal / API key, and never access compliance or RAG surfaces.

**Control Surface** — a named operational view inside the Shell (Command Center,
Staff operations, Release, Procurement, Vendor, Treasury, Compliance, Assistant,
Admin). Reaching a control surface requires a signed-in Staff User.

**Session** — a signed-in authentication context of a Staff User. In full auth it
is minted by the identity provider and re-validated when the app loads; in demo
auth it is a local stand-in that only marks the app as signed in.

**2FA Factor** — a TOTP authenticator attached to a Staff User. When a factor
exists, a password sign-in returns an incomplete (weak) session that must be
completed with a time-based verification code.

**AuthMode** — the deployment's identity posture: `demo` (the login/2FA gate is
bypassed for prototyping) or `full` (identity-provider sign-in with 2FA
respected).