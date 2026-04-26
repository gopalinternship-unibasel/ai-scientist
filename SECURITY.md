# Security Policy

## Reporting a vulnerability

If you've found a security issue in AI Scientist — please **do not file a
public GitHub issue**. Instead, report it privately:

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  on this repository (Security tab → Report a vulnerability), or
- Email the maintainers (see GitHub profile of the repository owner).

Please include:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept)
- Any suggested mitigation
- Whether you'd like credit in the eventual advisory

We aim to acknowledge reports within **3 business days** and to ship a fix
or mitigation within **30 days** for high/critical issues.

## Scope

In scope:

- The web app at [ai-scientist.lovable.app](https://ai-scientist.lovable.app)
- The edge functions under `supabase/functions/`
- The database schema and RLS policies under `supabase/migrations/`
- Authentication and session handling

Out of scope:

- Vulnerabilities in third-party services (Lovable Cloud, Supabase, the
  Lovable AI Gateway, Semantic Scholar, OpenAlex, PubMed) — please report
  to the respective vendor.
- Denial-of-service via expensive hypotheses (rate limits exist; if you
  find a way around them, that **is** in scope).
- Vulnerabilities requiring a compromised user device or browser extension.

## Hardening notes for self-hosters

If you're running your own deployment:

- Keep `.env` out of version control (already in `.gitignore`).
- Rotate the Lovable AI Gateway key on suspected compromise.
- Confirm RLS is enabled on every table after any migration.
- Enable HIBP-checked passwords in your Supabase Auth settings.
- Set a sensible `share_token` rotation policy if you serve sensitive
  research.

Thanks for helping keep AI Scientist and its users safe.
