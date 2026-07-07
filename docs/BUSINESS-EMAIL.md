# OneX business email

Professional email addresses for **zblockchainsystem.com**.

## Addresses

| Address | Purpose |
|---------|---------|
| `hello@zblockchainsystem.com` | General inquiries |
| `business@zblockchainsystem.com` | Partnerships & enterprise |
| `support@zblockchainsystem.com` | Technical support |
| `security@zblockchainsystem.com` | Security reports |

Canonical config: `configs/business-email.json`

These appear on the marketing site at `/contact.html` (or `website/contact.html` in the repo).

## Option A — Cloudflare Email Routing (free, recommended)

If DNS for `zblockchainsystem.com` is on Cloudflare:

1. **Email → Email Routing → Enable**
2. Add destination address (your personal or team inbox)
3. Create routing rules for each alias (`hello`, `business`, `support`, `security`)
4. Cloudflare adds MX records automatically

## Option B — Google Workspace

1. Sign up at [Google Workspace](https://workspace.google.com) for `zblockchainsystem.com`
2. Verify domain with TXT record
3. Add MX records Google provides
4. Create users or aliases for each address above

Suggested DNS (Google):

```
MX  @  ASPMX.L.GOOGLE.COM          priority 1
MX  @  ALT1.ASPMX.L.GOOGLE.COM     priority 5
MX  @  ALT2.ASPMX.L.GOOGLE.COM     priority 5
TXT @  v=spf1 include:_spf.google.com ~all
TXT _dmarc  v=DMARC1; p=quarantine; rua=mailto:hello@zblockchainsystem.com
```

## Option C — Forward-only (cPanel / registrar)

Many registrars offer free forwarding:

- `hello@` → your inbox  
- `business@` → your inbox  
- etc.

Works for receiving; sending *as* `@zblockchainsystem.com` needs SMTP (Workspace or SendGrid).

## Website contact form

The contact page uses a **mailto:** form (no server-side mail). Once MX is live, messages go directly to the selected address when the user sends from their mail app.

For server-side forms later, add a small API (SendGrid, Resend, or Postmark) — keep `Reply-To` as the visitor’s email.

## Deploy marketing site with email

Production nginx serves the site from `website/` at `/`:

```bash
docker compose -f docker-compose.prod.yml --profile proxy up -d --build
```

Local preview:

```powershell
cd website
python -m http.server 8080
# open http://127.0.0.1:8080
```

GitHub / Gitea Pages uses `docs/index.html` (marketing) + `docs/wallet/` (app).
