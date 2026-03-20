# Fix Netlify Deployment - Link to GitHub

Your deployment failed because the site isn't connected to your GitHub repository yet. Edge Functions require Git-based deployments.

## Quick Fix Steps:

### 1. Link Your Existing Site to GitHub

1. In your Netlify dashboard, go to your site
2. Click **Site settings** (gear icon or from the site menu)
3. Scroll down to **Build & deploy** section
4. Under **Continuous Deployment**, click **Link to Git provider**
5. Choose **GitHub** and authorize Netlify
6. Select your repository: **MisterMinter/redemo**
7. Configure build settings:
   - **Branch to deploy:** `main`
   - **Build command:** (leave empty - we're just deploying static files)
   - **Publish directory:** `.` (just a dot - already set correctly)
8. Click **Save**

### 2. Verify Build Settings

After linking, verify these settings in **Build & deploy** → **Build settings**:

- **Base directory:** `/` (or leave empty)
- **Build command:** (empty)
- **Publish directory:** `.` ✅ (this is correct)
- **Functions directory:** `netlify/functions` ✅ (this is correct)

### 3. Trigger a New Deployment

After linking to Git, Netlify should automatically:
- Detect the new connection
- Trigger a new deployment from the `main` branch
- Deploy your Edge Function

If it doesn't auto-deploy:
- Go to **Deploys** tab
- Click **Trigger deploy** → **Deploy site**

### 4. Verify Environment Variable

Make sure your `ANTHROPIC_API_KEY` is still set:
- **Site settings** → **Environment variables**
- Should see `ANTHROPIC_API_KEY` listed
- If not, add it again

## Why This Happened

- Your site was originally created via drag-and-drop
- Edge Functions require Git-based deployments
- The empty deploy log means the build never started because there's no Git connection

## After Linking

Once connected:
- ✅ Every `git push` will trigger automatic deployments
- ✅ Edge Functions will deploy properly
- ✅ Your API key will be securely used server-side
- ✅ No more manual deployments needed

## Troubleshooting

**If deployment still fails after linking:**

1. Check the deploy logs for specific errors
2. Verify `netlify.toml` is in the root directory
3. Make sure `netlify/edge-functions/anthropic-proxy.ts` exists
4. Check that `ANTHROPIC_API_KEY` environment variable is set

**If Edge Functions don't work:**

- Edge Functions require a paid Netlify plan or Netlify Pro
- If you're on the free plan, the regular function (`netlify/functions/anthropic-proxy.js`) will be used instead
- The regular function should still work, just update the endpoint in `index.html` if needed
