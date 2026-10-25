# Better Auth verification integration

Status (2026-10-25): `better-auth@1.7.12` is integrated as a verification engine in the standalone server. [#237](https://github.com/arcadia-eternity/arcadia-eternity/issues/237) tracks this work following the G3 implementation merged in [#235](https://github.com/arcadia-eternity/arcadia-eternity/pull/235). The previous `auth.config.example.ts` sketch has been removed; the runtime modules below are the implementation.

## Responsibilities

| Component                                                                                      | Responsibility                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Better Auth email adapter](../../packages/server/src/standalone/providers/betterAuthEmail.ts) | Runs the real `emailOTP` plugin through server-only `createVerificationOTP` and `verifyEmailOTP`. Better Auth owns OTP generation, attempt limits and one-time consumption; its custom storage hash hook computes an HMAC with a process-random key. Each challenge has an ephemeral verification-only identity in memory.                        |
| [Email provider](../../packages/server/src/standalone/providers/email.ts)                      | Maps the challenge to the real recipient and login/link intent; owns delivery, normalization, request limits, cleanup and serialization of attempts on the same challenge.                                                                                                                                                                        |
| [GitHub provider](../../packages/server/src/standalone/providers/github.ts)                    | Uses `github().createAuthorizationURL()` from `better-auth/social-providers` for S256 PKCE, and `authorizationCodeRequest` / `getOAuth2Tokens` from `better-auth/oauth2` for code exchange. Arcadia retains bounded HTTP requests, redirect refusal, upstream rate-limit backoff, numeric `/user.id` validation and short-lived token revocation. |
| [PgAccountDirectory](../../packages/server/src/standalone/accounts/directory.ts)               | Sole durable authority for server-scoped accounts and explicit identity bindings, including multiple emails, conflicts, last-recovery-method protection and deactivation.                                                                                                                                                                         |
| [SessionRegistry](../../packages/server/src/standalone/session.ts)                             | Sole authority for game bearer tokens and seats, scoped to the current server boot.                                                                                                                                                                                                                                                               |

The email adapter uses verification APIs, not `signInEmailOTP`. It does not expose a Better Auth HTTP handler, create player accounts, issue Better Auth sessions/cookies or introduce a second persistent account database. GitHub's advertised email cannot recover an Arcadia account unless that email has been explicitly bound through Arcadia's email flow.

## GitHub App and storage boundaries

The stock Better Auth social callback and signup flow is deliberately not mounted: its user/email semantics differ from Arcadia's explicit identity binding, and its default GitHub transport does not provide the per-instance bounded HTTP seam used here. Reusing the public authorization and OAuth helpers preserves the existing GitHub App flow without adopting its email lookup or account directory.

The App still needs its client ID and client secret, with the existing exact callback `https://battle.yuuinih.com/account`. This integration adds no GitHub App permissions or OAuth scopes, makes no `/user/emails` request, and does not persist GitHub tokens. No new deployment secret, database schema or migration is required. `PgAccountDirectory` continues to target the private `arcadia_auth` schema in PostgreSQL, with the existing Supabase project retained as the official database target; challenge state and verification-only identities disappear on restart along with game sessions and rooms.

The earlier sketch proposed a separate Better Auth PostgreSQL schema and cookie session. It is superseded by this verification-layer integration. Adopting the complete Better Auth account/session stack later would be a separate product and migration decision.

## Verification and rollout

Provider tests exercise the real Better Auth plugin and public OAuth APIs, with captured email delivery and substitute GitHub HTTP responses. Account-flow tests cover explicit binding, same-email isolation, conflicts, deactivation and boot-scoped game sessions. Test coverage does not establish real SMTP delivery or a real GitHub App callback.

Real SMTP and GitHub login remain unverified. The maintainer waived them as blockers for merging #235 on 2026-10-24; that waiver is not a passing result. No production deployment or database migration is performed by this integration. Electron remains email-only until its system-browser callback is adapted. Official launch still requires G4: authoritative results/rankings in [#233](https://github.com/arcadia-eternity/arcadia-eternity/issues/233), durable replays in [#234](https://github.com/arcadia-eternity/arcadia-eternity/issues/234), and rollout work in [#219](https://github.com/arcadia-eternity/arcadia-eternity/issues/219).

## Pinned API references

Better Auth source at `f4260a95cddc0a7640f57c37cf624de019df324f`:

- [Email OTP routes](https://github.com/better-auth/better-auth/blob/f4260a95cddc0a7640f57c37cf624de019df324f/packages/better-auth/src/plugins/email-otp/routes.ts): verification and session-producing sign-in are distinct APIs.
- [GitHub provider](https://github.com/better-auth/better-auth/blob/f4260a95cddc0a7640f57c37cf624de019df324f/packages/core/src/social-providers/github.ts): authorization URL, PKCE and default user/email retrieval.
- [OAuth authorization-code helpers](https://github.com/better-auth/better-auth/blob/f4260a95cddc0a7640f57c37cf624de019df324f/packages/core/src/oauth2/validate-authorization-code.ts): request construction and token normalization.

See the [account design](../../docs/v4/account-provider-design.md) and [runtime configuration](../../docs/v4/server-runtime.md) for the full account and deployment contracts.
