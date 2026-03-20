# RE Agent Demo

A real estate agent demo application with AI-powered features.

## Setup for Netlify Deployment

This application uses a secure proxy to handle Anthropic API calls. The API key is stored as a Netlify environment variable and never exposed to the client.

### Steps to Deploy:

1. **Set the Environment Variable in Netlify:**
   - Go to your Netlify site dashboard
   - Navigate to **Site settings** → **Environment variables**
   - Click **Add variable**
   - Name: `ANTHROPIC_API_KEY`
   - Value: Your Anthropic API key (starts with `sk-ant-`)
   - Click **Save**

2. **Deploy the Site:**
   - Push your code to your connected Git repository, or
   - Deploy via Netlify CLI: `netlify deploy --prod`

3. **Verify the Deployment:**
   - The API key input field in the UI is optional on Netlify
   - The app will automatically use the server-side API key
   - No manual API key entry is required for users

### Local Development

For local development, you can either:

**Option 1: Use Netlify Dev (Recommended)**
```bash
# Install Netlify CLI if you haven't already
npm install -g netlify-cli

# Set the environment variable locally
export ANTHROPIC_API_KEY=your-key-here

# Run Netlify Dev
netlify dev
```

**Option 2: Use Direct API (Fallback)**
- Enter your API key in the UI input field
- The app will detect you're on localhost and use the direct API

### Project Structure

```
.
├── index.html                 # Main application file
├── netlify/
│   └── edge-functions/
│       └── anthropic-proxy.ts # Edge function that proxies API calls
├── netlify.toml              # Netlify configuration
└── README.md                 # This file
```

### How It Works

- **On Netlify:** The app calls `/api/anthropic` which is handled by the Edge Function
- **Edge Function:** Adds the API key from environment variables and forwards requests to Anthropic
- **On Localhost:** The app can use either the proxy (via Netlify Dev) or direct API calls with a manually entered key

The API key is never exposed to the client-side code when deployed on Netlify.
