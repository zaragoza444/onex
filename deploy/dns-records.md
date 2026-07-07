# OneX — DNS records for zblockchainsystem.com

Replace `YOUR_VPS_IP` with your server public IPv4 (e.g. `51.75.64.28`).

## Website (required)

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | `@` | YOUR_VPS_IP | DNS only (grey cloud) or Proxied | Auto |
| A | `www` | YOUR_VPS_IP | Same as `@` | Auto |

**Cloudflare:** If using orange-cloud (Proxied), TLS is handled by Cloudflare — still run certbot on VPS for origin or use Full (strict) with origin cert.

**Registrar-only (no Cloudflare):** Add the two A records above. Wait 5–30 minutes for propagation.

---

## Business email — Option A: Cloudflare Email Routing (free)

1. Add domain to Cloudflare and point nameservers to Cloudflare.
2. **Email → Email Routing → Get started → Enable**.
3. Verify destination inbox (e.g. your Gmail).
4. **Routing rules → Create address** for each:

| Custom address | Action |
|----------------|--------|
| `hello@zblockchainsystem.com` | Send to → your inbox |
| `business@zblockchainsystem.com` | Send to → your inbox |
| `support@zblockchainsystem.com` | Send to → your inbox |
| `security@zblockchainsystem.com` | Send to → your inbox |

Cloudflare adds MX automatically. Do **not** add conflicting MX at your registrar.

Optional (after routing works):

| Type | Name | Content |
|------|------|---------|
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@zblockchainsystem.com` |

---

## Business email — Option B: Google Workspace

| Type | Name | Priority | Content |
|------|------|----------|---------|
| MX | `@` | 1 | `ASPMX.L.GOOGLE.COM` |
| MX | `@` | 5 | `ALT1.ASPMX.L.GOOGLE.COM` |
| MX | `@` | 5 | `ALT2.ASPMX.L.GOOGLE.COM` |
| MX | `@` | 10 | `ALT3.ASPMX.L.GOOGLE.COM` |
| MX | `@` | 10 | `ALT4.ASPMX.L.GOOGLE.COM` |
| TXT | `@` | — | `v=spf1 include:_spf.google.com ~all` |
| TXT | `_dmarc` | — | `v=DMARC1; p=quarantine; rua=mailto:hello@zblockchainsystem.com` |

Create users or **Groups → Aliases** for hello, business, support, security in Admin console.

---

## Verify (PowerShell)

```powershell
Resolve-DnsName zblockchainsystem.com -Type A
Resolve-DnsName zblockchainsystem.com -Type MX
```

---

## Deploy on VPS (after DNS points to VPS)

```bash
ONEX_DEPLOY_DOMAIN=zblockchainsystem.com CERTBOT_EMAIL=hello@zblockchainsystem.com bash ~/onex/scripts/vps-go-live.sh
```

Or from Windows when SSH works:

```powershell
$env:SSH_PASS='password'; .\scripts\run-vps-go-live.ps1 -VpsIp YOUR_VPS_IP -Domain zblockchainsystem.com
```

Then open:

- https://zblockchainsystem.com/ — marketing site  
- https://zblockchainsystem.com/wallet/ — wallet  
- https://zblockchainsystem.com/contact.html — business email  
