# Shinobi Village email branding

The transactional emails Supabase sends (signup confirmation, magic link,
password reset, etc.) default to "Confirm your signup" / "Supabase" branding.
This folder contains Shinobi Village–branded HTML templates and matching
subject lines that should be applied to your live project.

## Two ways to apply them

### Option A — Push automatically via the CLI (preferred, ~30s)

After you've run `supabase login` (which stores a Personal Access Token):

```bash
# from the repo root
supabase config push --linked
```

This reads `supabase/config.toml` and pushes:
- All six branded email templates (confirmation, magic_link, recovery, invite,
  email_change, reauthentication)
- All six branded subject lines
- The branded `site_url` and redirect allowlist

### Option B — Paste them into the dashboard (no CLI needed)

Open https://supabase.com/dashboard/project/siwcdegiavwcvgjegiww/auth/templates
and for each template below:

1. Click the template name in the left list.
2. Replace the **Subject** with the value from the table below.
3. Open the matching `.html` file in `supabase/templates/`, copy the entire
   contents, and paste it into the **Message body** field.
4. Click **Save changes**.

| Template            | Subject                                       | File                          |
| ------------------- | --------------------------------------------- | ----------------------------- |
| Confirm signup      | Confirm your Shinobi Village account          | `confirmation.html`           |
| Magic link          | Your Shinobi Village sign-in link             | `magic_link.html`             |
| Reset password      | Reset your Shinobi Village password           | `recovery.html`               |
| Invite user         | You're invited to Shinobi Village             | `invite.html`                 |
| Change email        | Confirm your new email · Shinobi Village      | `email_change.html`           |
| Reauthentication    | Your Shinobi Village verification code        | `reauthentication.html`       |

Then in **Authentication → SMTP Settings** (one level up):
- **Sender name**: `Shinobi Village`
- **Sender email**: leave the default `noreply@mail.app.supabase.io`
  (only required to change once you have your own domain + SMTP)

That's the entire fix for "the email says confirm Supabase".

## Why we couldn't push it for you

The Supabase Management API endpoint that updates auth settings
(`/v1/projects/{ref}/config/auth`) requires a Personal Access Token (PAT),
not the project secret-role key. We only have your secret key and the
Cursor MCP wasn't granted project-level access during the OAuth consent flow,
so neither path can write auth config. Either of the two options above will
work — Option A is fastest if you're going to use the CLI anyway.

## Variables available inside the templates

These are the Go template variables Supabase substitutes into each email:

- `{{ .ConfirmationURL }}` – the action link
- `{{ .Token }}` – 6-digit OTP code
- `{{ .TokenHash }}` – hashed token (for custom verify endpoints)
- `{{ .SiteURL }}` – your `site_url`
- `{{ .Email }}` – the user's email
- `{{ .NewEmail }}` – on email-change emails, the proposed new email
- `{{ .RedirectTo }}` – the post-auth redirect URL passed by the client

If you tweak the templates locally, keep these tokens intact or the link
button will break.
