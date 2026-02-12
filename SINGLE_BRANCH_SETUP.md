# How to Complete Single Branch Setup

You mentioned wanting only the main branch. Here's how to achieve that:

## Current Situation

```
Repository Branches:
├─ main                         (old version)
└─ copilot/enable-github-pages  (has all new changes) ← You are here
```

## Goal

```
Repository Branches:
└─ main  (ONLY BRANCH - with all changes)
```

## Steps to Achieve Single Branch Setup

### Step 1: Merge the Pull Request

This PR contains all the changes. Merge it to main via GitHub:

1. Go to: https://github.com/CGutt-hub/cagatay-gutt.github.io/pulls
2. Find the Pull Request for branch `copilot/enable-github-pages`
3. Click on it
4. Review the changes (all green, ready to merge)
5. Click **"Merge pull request"**
6. Click **"Confirm merge"**
7. ✅ All changes are now on main branch!

### Step 2: Delete the Feature Branch

After merging, GitHub will offer to delete the branch:

1. On the merged PR page, click **"Delete branch"** button
2. ✅ Feature branch is deleted!

**Or delete manually:**
1. Go to repository main page
2. Click on "branches" (shows branch count, e.g., "2 branches")
3. Find `copilot/enable-github-pages`
4. Click the trash icon 🗑️
5. Confirm deletion

### Step 3: Verify Single Branch Setup

1. Go to: https://github.com/CGutt-hub/cagatay-gutt.github.io
2. Click "branches" or the branch dropdown
3. You should see **only "main"** branch
4. ✅ Single branch setup complete!

## What Happens After Merge

### Automatic Actions

Once merged to main:
- ✅ Workflow file is on main: `.github/workflows/deploy.yml`
- ✅ All documentation is on main
- ✅ All source code is on main
- ✅ Workflow is configured to run on main branch pushes

### Manual Steps Required (One-Time Setup)

After merging, configure GitHub Pages:

**1. Configure Pages Source**
- Go to: Settings → Pages
- Source: Select **"GitHub Actions"**

**2. Trigger First Deployment**
- Go to: Actions tab
- Click: "Build and Deploy"
- Click: "Run workflow"
- Select: "main" branch
- Click: "Run workflow"
- Wait: 1-2 minutes

**3. Enable HTTPS**
- Return to: Settings → Pages
- Check: ☑️ "Enforce HTTPS"

**4. Add Repository Details** (Optional but recommended)
- Go to: Settings → General
- Description: Add site description
- Website: Add `https://cgutt-hub.github.io/cagatay-gutt.github.io`

## Single Branch Workflow (After Setup)

```
┌─────────────────────────────────────────────────────────────┐
│  1. You edit content/code on main branch                    │
│     ↓                                                        │
│  2. You commit and push to main                             │
│     ↓                                                        │
│  3. GitHub Actions automatically triggers                   │
│     ↓                                                        │
│  4. Workflow runs (fetch data, build with Zola)             │
│     ↓                                                        │
│  5. Automatically deploys to GitHub Pages                   │
│     ↓                                                        │
│  6. Your website updates (1-2 minutes)                      │
│     ↓                                                        │
│  7. ✅ Done! No other branches needed!                      │
└─────────────────────────────────────────────────────────────┘
```

## Verification Checklist

After completing all steps:

- [ ] Only "main" branch exists in repository
- [ ] Settings → Pages → Source = "GitHub Actions"
- [ ] First workflow run completed successfully (green ✓)
- [ ] Website is live at https://cgutt-hub.github.io/cagatay-gutt.github.io
- [ ] Settings → Pages shows "Your site is live at..."
- [ ] HTTPS is enforced

## Future Development

With single branch setup:

### Making Changes
```bash
# Clone repository
git clone https://github.com/CGutt-hub/cagatay-gutt.github.io.git
cd cagatay-gutt.github.io

# Edit files
vim content/cv.md

# Commit and push to main
git add .
git commit -m "Update CV"
git push origin main

# Wait 1-2 minutes
# Visit website - changes are live!
```

### No Need For:
- ❌ Feature branches (unless you want them)
- ❌ Manual deployment
- ❌ Branch switching
- ❌ Complex workflows

### Everything Happens on Main:
- ✅ Edit content
- ✅ Commit changes
- ✅ Push to main
- ✅ Automatic build and deploy
- ✅ Website updates

## Troubleshooting

### "I don't see a Pull Request"

If there's no PR:
1. Go to repository main page
2. You might see a banner: "copilot/enable-github-pages had recent pushes"
3. Click "Compare & pull request"
4. Or go to: Pull requests → New pull request
5. Base: main, Compare: copilot/enable-github-pages
6. Create PR, then merge it

### "I can't merge the PR"

Possible reasons:
- Not repository admin: Ask repository owner to merge
- Conflicts: Should not happen with this PR
- CI failing: Check Actions tab for errors

### "Branch is already deleted"

If the feature branch is already gone:
- Good! That means someone already cleaned it up
- Just verify main branch has all the changes
- Check that workflow file exists: `.github/workflows/deploy.yml`

### "Workflow doesn't run after merge"

1. Check workflow file is on main branch
2. Go to Actions tab and run manually:
   - Click "Build and Deploy"
   - Click "Run workflow"
   - Select "main"
   - Click green button

## Summary

**To achieve single branch setup:**

1. Merge this PR → main gets all changes
2. Delete feature branch → only main remains
3. Configure GitHub Pages → Settings → Pages → GitHub Actions
4. Run first deployment → Actions → Run workflow
5. ✅ Done! Single branch operation achieved

**After setup:**
- Only main branch exists
- Push to main → automatic deployment
- No manual steps needed
- Simple, streamlined workflow

---

**Documentation available:**
- [QUICK_START.md](QUICK_START.md) - 5-minute setup guide
- [SETTINGS_WALKTHROUGH.md](SETTINGS_WALKTHROUGH.md) - Visual guide
- [GITHUB_PAGES_SETUP.md](GITHUB_PAGES_SETUP.md) - Complete reference
