# Fix Netlify Deploy Failures

You're hitting **two separate issues**. Fix both.

---

## 1. "Unrecognized Git contributor" (commits 648271b, 726e440)

**Cause:** On the free plan, Netlify only allows **one** recognized contributor for **private** repos. Those deploys were triggered by commits Netlify doesn’t attribute to your linked account.

**Pick one fix:**

### Option A: Make the repo public (simplest)

- GitHub → **MisterMinter/redemo** → **Settings** → **Danger zone** → **Change repository visibility** → **Public**.
- No code change needed; your API key stays in Netlify env vars and is not in the repo.
- After that, trigger a new deploy (or push a small commit). The contributor limit no longer applies to public repos.

### Option B: Stay private – link your Git account

- Netlify Dashboard → **Team** (or **Account**) → **Manage Git contributors** (or **Repository access**).
- Ensure the GitHub account that owns **MisterMinter/redemo** is the one linked to Netlify and is the only one pushing to `main`.
- If you use Cursor/agent to push, either push from your own machine with your Git config so your email/name match the linked account, or make the repo public (Option A).

### Option C: Upgrade

- Netlify Pro allows multiple contributors on private repos.

---

## 2. "Build image no longer supported" (2:45 PM, 3:16 PM deploys)

**Cause:** The site is still using a deprecated build image (e.g. Xenial).

**Fix:**

1. Netlify Dashboard → your site → **Site configuration** (or **Site settings**).
2. **Build & deploy** → find **Build image selection** (may be under **Continuous Deployment** or **Build settings**).
3. Change from the deprecated image to:
   - **Ubuntu Focal 20.04**, or  
   - **Ubuntu Noble 24.04** (recommended).
4. **Save**.
5. **Deploys** → **Trigger deploy** → **Deploy site** (or push a new commit).

If you don’t see “Build image selection,” try:

- **Site configuration** → **Build** → **Configure** (or **Edit settings**).
- Or create a new site from the same repo (same Git connection); new sites get a supported image by default.

---

## After both are fixed

1. Trigger a deploy (**Deploys** → **Trigger deploy** → **Deploy site**).
2. Confirm the build runs and completes (no “unrecognized contributor” or “build image” errors).
3. Open your site URL and test the app; the proxy will use `ANTHROPIC_API_KEY` from env vars.

**Quick path:** Make repo **public** (Option A) + set build image to **Ubuntu Noble 24.04**, then trigger deploy.
