# Setting Up GitHub + Netlify Integration

This guide will walk you through connecting your project to GitHub and Netlify for automatic deployments.

## Why Use Git/GitHub?

✅ **Automatic deployments** - Every push to GitHub triggers a new Netlify deployment  
✅ **Version control** - Track changes and roll back if needed  
✅ **Edge Functions work properly** - Netlify needs Git to deploy Edge Functions correctly  
✅ **Better collaboration** - Easy to share and collaborate  
✅ **Deploy previews** - Test changes before going live  

## Step-by-Step Setup

### Step 1: Initialize Git Repository (Local)

Run these commands in your project directory:

```bash
# Initialize git repository
git init

# Add all files
git add .

# Create your first commit
git commit -m "Initial commit: RE Agent Demo with secure Anthropic API integration"
```

### Step 2: Create GitHub Repository

1. Go to [GitHub.com](https://github.com) and sign in
2. Click the **+** icon in the top right → **New repository**
3. Repository name: `re-agent-demo` (or any name you prefer)
4. Description: "Real Estate Agent Demo with AI features"
5. Choose **Private** (recommended for projects with API keys)
6. **Don't** initialize with README, .gitignore, or license (we already have these)
7. Click **Create repository**

### Step 3: Connect Local Repo to GitHub

GitHub will show you commands. Run these (replace `YOUR_USERNAME` with your GitHub username):

```bash
# Add GitHub as remote
git remote add origin https://github.com/YOUR_USERNAME/re-agent-demo.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

**Note:** If you haven't set up GitHub authentication, you may need to:
- Use a Personal Access Token instead of password
- Or set up SSH keys
- GitHub will show you the exact steps if needed

### Step 4: Connect GitHub to Netlify

1. Go to your **Netlify Dashboard** → Your site
2. Click **Site settings** (or go to the site's settings page)
3. Under **Build & deploy**, click **Link to Git provider**
4. Choose **GitHub**
5. Authorize Netlify to access your GitHub account
6. Select your repository (`re-agent-demo`)
7. Configure build settings:
   - **Branch to deploy:** `main`
   - **Build command:** (leave empty - we're just deploying static files)
   - **Publish directory:** `.` (root directory)
8. Click **Deploy site**

### Step 5: Verify Environment Variable

Since you already added the `ANTHROPIC_API_KEY` environment variable:
1. Go to **Site settings** → **Environment variables**
2. Verify `ANTHROPIC_API_KEY` is there
3. It should be available to all deployments

### Step 6: Test the Deployment

1. Netlify will automatically deploy your site
2. Wait for the deployment to complete (you'll see a green checkmark)
3. Click **Open production deploy** or visit your site URL
4. Test the app - it should work without needing to enter an API key!

## Future Updates

Now whenever you make changes:

```bash
# Make your changes to files
# ... edit files ...

# Commit changes
git add .
git commit -m "Description of your changes"

# Push to GitHub
git push

# Netlify automatically deploys! 🚀
```

## Troubleshooting

### Edge Functions Not Working?

- Make sure you're using **Git-based deployment** (not drag & drop)
- Edge Functions require Git integration to work properly
- Check Netlify build logs if you see errors

### Environment Variable Not Found?

- Go to **Site settings** → **Environment variables**
- Make sure `ANTHROPIC_API_KEY` is set
- Click **Trigger deploy** to redeploy with the variable

### Build Fails?

- Check the build logs in Netlify dashboard
- Make sure `netlify.toml` is in the root directory
- Verify all files are committed to Git

## Quick Reference

**Files in your project:**
- `index.html` - Main app
- `netlify/edge-functions/anthropic-proxy.ts` - API proxy
- `netlify/functions/anthropic-proxy.js` - Fallback function
- `netlify.toml` - Netlify configuration
- `.gitignore` - Git ignore file

**Netlify Environment Variable:**
- Name: `ANTHROPIC_API_KEY`
- Value: Your Anthropic API key

That's it! You're all set up for professional deployments. 🎉
