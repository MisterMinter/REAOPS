# RE Agent OS

Next.js app for listing marketing and broker assistant workflows (see `RE_AGENT_OS_PRD_1.md` for product scope).

## Local development

1. Copy `.env.example` to `.env` and fill values (at minimum `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, Google OAuth, and `TOKEN_ENCRYPTION_KEY` for future token storage).

2. Install and migrate:

```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

3. **Google sign-in** only works for emails that already exist in the `User` table. The seed creates the first platform admin (`feroz@automatedengineering.io`). Add other users under **Admin → Users** before they sign in.

## Production (Railway)

- Provision **PostgreSQL** and set `DATABASE_URL` on the web service.
- Set `NEXTAUTH_URL` to `https://reaops.com` (or your Railway URL before the custom domain is attached).
- In **Google Cloud Console** (same project as Drive / GCS): OAuth client **Authorized redirect URI**  
  `https://reaops.com/api/auth/callback/google` (and the Railway URL during staging).
- **Build:** `npm run build` (default Nixpacks is fine).
- **Start:** `npm run start`.
- **Release / one-off:** after the first deploy, run `npx prisma migrate deploy` and `npm run db:seed` against production (Railway shell or a release phase), then remove seed from routine deploys if you prefer.

### Tenant logos

- **Recommended:** GCS bucket + `GCS_BUCKET_LOGOS`, `GCS_PUBLIC_BASE_URL` (optional), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
- **Local:** files go to `public/uploads/tenants/{id}/` (gitignored).

## Legacy static demo

The previous Netlify single-page demo (`index.html`, `netlify/`) has been removed in favor of this app.
