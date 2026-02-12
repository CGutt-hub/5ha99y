# How to Fix the Website That's Not Updating

## Problem
**The website does not update when you visit it** because GitHub Actions deployments are failing on the main branch.

## Why It's Happening

1. **Main branch is broken** - `scripts/fetch_data.py` creates duplicate blog posts
2. **Duplicate posts cause build failures** - Zola reports path collisions
3. **No deployment = no updates** - Website shows old content from Feb 11

### Error from GitHub Actions
```
ERROR Failed to build the site
ERROR Found path collisions:
- `/blog/new-project-emotiview/` from files [
    "2026-02-12-new-project-emotiview.md", 
    "2026-02-11-new-project-emotiview.md"
  ]
```

## The Fix

This PR (`copilot/fix-website-update-issue-again`) contains the necessary fix:

1. **scripts/fetch_data.py** - Added cleanup logic to delete old blog posts before creating new ones
2. **.gitignore** - Added Python cache files

## How to Apply the Fix

### Option 1: Merge This PR (Recommended)
```bash
# Merge this PR into main branch via GitHub UI or:
git checkout main
git merge copilot/fix-website-update-issue-again
git push origin main
```

### Option 2: Cherry-pick the Commits
```bash
git checkout main
git cherry-pick 680ad2e  # Fix duplicate blog post issue
git cherry-pick e933601  # Improve glob pattern
git push origin main
```

### Option 3: Manual Application
Apply the changes from these files:
- `.gitignore` - Add `__pycache__/` and `*.pyc`
- `scripts/fetch_data.py` - Add cleanup logic (see diff below)

## What Happens After Fix is Applied

1. ✅ GitHub Actions workflow runs on main
2. ✅ `fetch_data.py` deletes old duplicate blog posts
3. ✅ Creates fresh blog posts with today's date
4. ✅ Zola build succeeds (no path collisions)
5. ✅ Site deploys to GitHub Pages
6. ✅ **Website updates with fresh content!**

## Verification

After merging, check:
1. Go to https://github.com/CGutt-hub/cagatay-gutt.github.io/actions
2. Verify "Build and Deploy" workflow succeeds ✓
3. Visit https://cgutt-hub.github.io/cagatay-gutt.github.io
4. See updated content!

## Technical Details

The fix adds cleanup logic to `scripts/fetch_data.py`:

```python
# Before creating a blog post, delete any existing posts with the same slug
slug = slugify(f"new-project-{repo['name']}")
pattern = f"????-??-??-{slug}.md"  # Matches: YYYY-MM-DD-slug.md
for existing_file in blog_dir.glob(pattern):
    existing_file.unlink()  # Delete old post
    print(f"[-] Deleted old blog post: {existing_file.name}")
```

This ensures only ONE blog post exists per project/publication, preventing path collisions.
