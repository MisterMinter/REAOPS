# Secure Anthropic API Key Setup for Netlify

This guide explains how to securely configure your Anthropic API key for Netlify deployment.

## Quick Setup

1. **Add Environment Variable in Netlify:**
   - Go to your Netlify site dashboard
   - Navigate to **Site settings** → **Environment variables**
   - Click **Add variable**
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** Your Anthropic API key (starts with `sk-ant-`)
   - Click **Save**

2. **Deploy:**
   - Push to your connected Git repository, or
   - Run `netlify deploy --prod`

3. **Done!** The API key is now securely stored and used server-side.

## How It Works

- The app uses a **Netlify Edge Function** (`/api/anthropic`) that acts as a proxy
- The Edge Function reads `ANTHROPIC_API_KEY` from environment variables
- All API calls go through this proxy, so the key never reaches the client
- The UI no longer requires users to enter an API key

## Files Created

- `netlify/edge-functions/anthropic-proxy.ts` - Edge Function that proxies requests
- `netlify/functions/anthropic-proxy.js` - Fallback regular function (if Edge Functions unavailable)
- `netlify.toml` - Netlify configuration
- `index.html` - Updated to use the proxy endpoint

## Local Development

For local testing, you can:

1. **Use Netlify Dev** (recommended):
   ```bash
   export ANTHROPIC_API_KEY=your-key-here
   netlify dev
   ```

2. **Use direct API** (fallback):
   - Enter your API key in the UI input field
   - The app detects localhost and uses direct API calls

## Security Notes

- ✅ API key is stored as a Netlify environment variable (encrypted at rest)
- ✅ API key never appears in client-side code
- ✅ API key never appears in browser network requests
- ✅ Only the Edge Function has access to the key
