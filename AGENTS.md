<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# TrustVault

- All document operations go through authenticated server functions in `src/lib/vault.functions.ts`; each re-checks authorization server-side and writes an audit entry (including denials). Why: route guards don't protect RPC endpoints.
- Document files live in a private storage bucket with no client policies; access only via short-lived signed URLs issued after a permission check. Why: storage can't be read bypassing authorization.
- `audit_logs` is append-only and hash-chained by DB triggers; never add UPDATE/DELETE paths. Why: tamper evidence.
- Roles live in `user_roles` (admin/owner/viewer); first signup becomes admin. Why: prevent privilege escalation.
- Upload validation (type, extension, magic bytes, size) lives in `src/lib/file-validation.ts` with tests.
