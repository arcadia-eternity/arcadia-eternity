# Better Auth + GitHub App: isolated G3 integration probe

Status (2026-10-24): **configuration sketch, not integrated or runtime-tested**. No production database, GitHub App, secret, server route, package manifest, or lockfile was changed. The package was absent locally; an isolated attempt to fetch pinned `better-auth@1.7.12` was blocked by the sandbox's npm-proxy connection (`EPERM 127.0.0.1:7890`). `auth.config.example.ts` follows current Better Auth documentation but has therefore not been type-checked against the package. Do not deploy it as-is.

## What Better Auth can do

Its built-in `socialProviders.github` supports a **GitHub App**, not just an OAuth App. GitHub App setup needs a **client ID** (different from app ID), a client secret, an exact callback URL such as `https://SERVER/api/auth/callback/github`, public visibility for general players, and **Account permissions → Email addresses: Read-only**. A login-only app needs no repository permissions. GitHub Apps do not grant OAuth scopes; the example disables Better Auth's default `read:user` and `user:email` scope request. The provider uses GitHub's immutable numeric user ID as its account subject and fetches `/user` and `/user/emails`; profile login and email must not be the stable identity key.

Sources: [Better Auth GitHub provider](https://better-auth.com/docs/authentication/github), [Better Auth GitHub provider source](https://github.com/better-auth/better-auth/blob/main/packages/core/src/social-providers/github.ts), [GitHub App user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), [GitHub App public/private visibility](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private).

Better Auth also provides an email OTP plugin and PostgreSQL adapter. The example sets eight-digit, ten-minute, hashed-at-rest OTPs with five attempts; uses only GitHub as a social provider; disables password login and implicit **OAuth** account linking; and selects a new private PostgreSQL schema, leaving `arcadia_auth` and Supabase's own `auth` schema untouched. Migration SQL would need to be generated, reviewed, and tested locally before use. Better Auth's PostgreSQL core needs at least `user`, `account`, `session`, and `verification` tables.

Sources: [Email OTP options](https://better-auth.com/docs/plugins/email-otp), [PostgreSQL schema selection](https://better-auth.com/docs/adapters/postgresql), [core schema](https://better-auth.com/docs/concepts/database), [implicit-link control](https://better-auth.com/docs/concepts/users-accounts).

## Blocker 1: current login and account authority

Better Auth is a complete auth service. Its normal flow writes `user`, `account`, `session`, and `verification` data and sets its own cookie session. The present Arcadia implementation has a separate `arcadia_auth.accounts` / `external_identities` directory and issues an in-process bearer capability with a fresh `seatId` for each room participant. Wiring `socialProviders.github` to a second `/api/auth/*` route would leave two live auth sessions and two durable user directories. Better Auth's cookie cannot be used directly as a battle seat or as the existing Arcadia bearer capability.

A full adoption would need an explicit bridge: authenticate Better Auth's cookie, map its stable `user.id` to one Arcadia `accountId` scoped by `serverId`, check Arcadia deactivation, and then issue a new in-process session/seat. Logout, unlink, deactivation, and account deletion must revoke or reconcile both systems. Express must mount `toNodeHandler(auth)` **before** `express.json()`; cross-origin clients must send cookies, and the server must narrow `trustedOrigins` and CORS credentials. Existing web clients use bearer tokens; Electron requires its own browser callback/cookie design. Better Auth sessions persist across process restarts while Arcadia seats must not. A hook that mirrors identities into Arcadia after Better Auth commits is not atomic with Arcadia's directory write.

Sources: [Better Auth sessions](https://better-auth.com/docs/concepts/session-management), [Express integration](https://better-auth.com/docs/integrations/express), [cookies and cross-domain constraints](https://better-auth.com/docs/concepts/cookies), [database hooks and transaction timing](https://better-auth.com/docs/concepts/database).

## Blocker 2: email OTP changes the agreed recovery rule

`disableImplicitLinking: true` blocks **same-email OAuth auto-linking**. It does not block Better Auth's email OTP sign-in for an existing `user.email`. The source of `/sign-in/email-otp` verifies the OTP, finds a user by email, then creates a session for that user. Therefore this sequence is possible with the stock plugin:

1. A GitHub App sign-in creates a Better Auth user whose GitHub-verified email is `a@example.com`. No Arcadia email identity was explicitly linked.
2. Someone with control of `a@example.com` requests and proves an email OTP.
3. Better Auth signs them into the existing GitHub-created user. If the bridge maps Better Auth `user.id` to Arcadia `accountId`, the OTP reaches that Arcadia account.

This is Better Auth's documented mailbox-as-recovery rule, but it differs from the current G3 rule that an email identity must be explicitly bound before it can recover an account. It also has only one globally unique `user.email`; Arcadia currently permits multiple explicit email identities per server account. A custom guard on **both** OTP initiation and completion, plus a model for multiple email identities, would be needed to retain Arcadia semantics. Merely setting `disableImplicitLinking` is insufficient. This conclusion is source-level, not a live exploit test against a Better Auth database.

Sources: [email OTP sign-in semantics](https://better-auth.com/docs/plugins/email-otp), [email OTP route source](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/email-otp/routes.ts), [linking option scope](https://better-auth.com/docs/concepts/users-accounts), [globally unique user email](https://better-auth.com/docs/concepts/database).

## Decision for this branch

The narrow G3 path is to keep Arcadia's explicit account directory and email OTP, and implement the GitHub App web flow as a provider that returns a verified `(providerId, issuer, immutable subject)`. That gives GitHub as the only social login while preserving email recovery and the current in-process room/session boundary. Better Auth can be reconsidered as a deliberate **full account migration** if mailbox ownership is accepted as universal recovery, the extra cookie/session is acceptable, and existing account mappings are migrated with collision tests. It should not be switched on merely by adding this example config.

Runtime acceptance for a future Better Auth migration: run a disposable PostgreSQL instance; generate and inspect the schema in `arcadia_better_auth`; test GitHub App authorization without OAuth scopes and with the `Email addresses: Read-only` permission; verify private-email users; test same-email GitHub→OTP behavior, explicit link/unlink, concurrent first login, deactivation, logout, restart, and browser/Electron callback behavior. No live GitHub credentials were used here.
