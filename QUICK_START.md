# Quick Start: Connect to GitHub & Netlify

## ✅ You've Already Done:
- Added `ANTHROPIC_API_KEY` to Netlify environment variables ✓
- Git repository initialized ✓
- Files committed ✓

## Next Steps:

### 1. Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `re-agent-demo` (or your preferred name)
3. Make it **Private** (recommended)
4. **Don't** check any boxes (no README, .gitignore, or license)
5. Click **Create repository**

### 2. Connect & Push to GitHub

After creating the repo, GitHub will show you commands. Run these (replace `YOUR_USERNAME`):

```bash
git remote add origin https://github.com/YOUR_USERNAME/re-agent-demo.git
git branch -M main
git push -u origin main
```

**If you get authentication errors:**
- GitHub no longer accepts passwords
- You'll need a **Personal Access Token**:
  1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
  2. Generate new token (classic)
  3. Select `repo` scope
  4. Copy the token and use it as your password when pushing

### 3. Connect to Netlify

1. Go to your Netlify dashboard
2. Find your site → Click **Site settings**
3. Scroll to **Build & deploy** → Click **Link to Git provider**
4. Choose **GitHub** and authorize
5. Select your repository (`re-agent-demo`)
6. Build settings:
   - **Branch:** `main`
   - **Build command:** (leave empty)
   - **Publish directory:** `.` (just a dot)
7. Click **Deploy site**

### 4. Important: Delete Old Drag-and-Drop Site

Since you're switching to Git-based deployment:
1. In Netlify dashboard, you might have the old drag-and-drop site
2. You can either:
   - **Option A:** Delete the old site and create a new one from Git
   - **Option B:** Convert the existing site to use Git (recommended)
     - Go to site settings → Build & deploy → Link to Git provider
     - This will convert your existing site

### 5. Verify It Works

1. Wait for deployment to complete (green checkmark)
2. Visit your site URL
3. The app should work **without** entering an API key!
4. Check browser console for any errors

## That's It! 🎉

Now every time you run:
```bash
git add .
git commit -m "Your message"
git push
```

Netlify will automatically deploy your changes!

## Need Help?

See `GITHUB_SETUP.md` for detailed instructions and troubleshooting.
