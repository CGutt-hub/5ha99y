# GitHub Pages Configuration - Quick Start

## What You Need to Configure in GitHub Settings

This is a **quick reference** for all the settings you need to configure in your GitHub repository settings for GitHub Pages to work.

---

## 🎯 5-Minute Setup Guide

### Step 1: Configure Pages Source (REQUIRED)
**Location:** Settings → Pages

```
Action: Set Source to "GitHub Actions"
Time: 10 seconds
```

1. Go to repository Settings
2. Click "Pages" in left sidebar
3. Under "Source", select **"GitHub Actions"** from dropdown
4. ✅ Done!

---

### Step 2: Run First Deployment (REQUIRED)
**Location:** Actions tab

```
Action: Trigger the workflow manually
Time: 2-3 minutes
```

1. Click "Actions" tab
2. Click "Build and Deploy" in left sidebar
3. Click "Run workflow" button (top right)
4. Select "main" branch
5. Click green "Run workflow" button
6. ⏱️ Wait 1-2 minutes for completion
7. ✅ Look for green checkmark

---

### Step 3: Enable HTTPS (RECOMMENDED)
**Location:** Settings → Pages

```
Action: Check "Enforce HTTPS" box
Time: 5 seconds
```

1. Return to Settings → Pages
2. Find "Enforce HTTPS" checkbox
3. ✅ Check the box
4. Done!

---

### Step 4: Add Repository Details (RECOMMENDED)
**Location:** Settings → General

```
Action: Add description and website URL
Time: 30 seconds
```

**Description:**
1. At top of Settings → General page
2. In "Description" field, add:
   ```
   Personal academic website built with Zola
   ```

**Website:**
1. In "Website" field, add:
   ```
   https://cgutt-hub.github.io/cagatay-gutt.github.io
   ```

2. Click anywhere outside the field to save

---

## ✅ Verification

After completing the above steps, verify:

- [ ] Visit https://cgutt-hub.github.io/cagatay-gutt.github.io
- [ ] Your website loads
- [ ] Settings → Pages shows "Your site is live at..."
- [ ] Green checkmark in Actions tab for latest workflow run

---

## 📋 Complete Settings Checklist

Use this checklist to ensure nothing is missed:

### Settings → Pages
- [x] **Source**: Set to "GitHub Actions" (not "Deploy from a branch")
- [x] **Custom domain**: Leave empty (or add your domain if you have one)
- [x] **Enforce HTTPS**: Checked ✅ (after first deployment)

### Settings → General  
- [x] **Description**: Added
- [x] **Website**: Added (`https://cgutt-hub.github.io/cagatay-gutt.github.io`)
- [x] **Visibility**: Verify it says "Public"

### Actions Tab
- [x] **First deployment**: Completed successfully (green ✅)

### Settings → Environments (Auto-created)
- [x] **github-pages environment**: Exists (check after first deployment)

---

## 🚫 Common Mistakes

### ❌ DON'T DO THIS:
1. **Don't select "Deploy from a branch"** as source
   - ✅ Use "GitHub Actions" instead

2. **Don't make repository private** 
   - ✅ Keep it public (free tier requirement)

3. **Don't skip running the workflow**
   - ✅ Must run at least once before site goes live

4. **Don't forget to enable HTTPS**
   - ✅ Check "Enforce HTTPS" after first deployment

---

## 🎨 Visual Settings Map

```
GitHub Repository
│
├─ Settings Tab
│  │
│  ├─ General (default page)
│  │  ├─ ✏️  Description: Add description
│  │  ├─ 🌐 Website: Add Pages URL
│  │  └─ 🔒 Visibility: Verify "Public"
│  │
│  ├─ Pages
│  │  ├─ ⚙️  Source: Select "GitHub Actions"
│  │  ├─ 🌐 Custom domain: Leave empty (optional)
│  │  └─ 🔐 Enforce HTTPS: Check box
│  │
│  ├─ Environments
│  │  └─ 📦 github-pages: Auto-created, view only
│  │
│  └─ Actions → General
│     ├─ ✅ Allow all actions: Should be selected
│     └─ ✅ Read/write permissions: Should be selected
│
└─ Actions Tab
   └─ 🎬 Build and Deploy: Run workflow manually
```

---

## ⏱️ Timeline

**What happens when:**

```
Minute 0: You configure Settings → Pages → Source = "GitHub Actions"
          Status: Pages configured, but no deployment yet

Minute 1: You trigger workflow in Actions tab
          Status: Workflow running...

Minute 3: Workflow completes successfully ✅
          Status: Site is now live!

Minute 4: You enable "Enforce HTTPS"
          Status: Site now forces secure connections

Minute 5: You add description and website URL
          Status: Repository properly documented
```

---

## 🆘 Need Help?

**If your site isn't working:**

1. **Check workflow status**
   - Go to Actions tab
   - Look for green ✅ or red ❌
   - If red, click to see error logs

2. **Verify Pages source**
   - Settings → Pages
   - Ensure "GitHub Actions" is selected

3. **Check repository visibility**
   - Settings → General → scroll to bottom
   - Verify "This repository is currently public"

4. **Wait and refresh**
   - Deployments take 1-2 minutes
   - Clear browser cache: Ctrl+Shift+R

---

## 📚 Detailed Documentation

For more information:
- **Complete guide**: [GITHUB_PAGES_SETUP.md](GITHUB_PAGES_SETUP.md)
- **Visual walkthrough**: [SETTINGS_WALKTHROUGH.md](SETTINGS_WALKTHROUGH.md)
- **Development info**: [README.md](README.md)

---

## Summary: Settings at a Glance

| Setting | Location | Value | Required? |
|---------|----------|-------|-----------|
| **Source** | Settings → Pages | GitHub Actions | ✅ YES |
| **Visibility** | Settings → General | Public | ✅ YES |
| **First Deployment** | Actions tab | Must run once | ✅ YES |
| **Enforce HTTPS** | Settings → Pages | Checked | ⭐ Recommended |
| **Description** | Settings → General | Add description | ⭐ Recommended |
| **Website** | Settings → General | Add Pages URL | ⭐ Recommended |
| **Custom Domain** | Settings → Pages | Leave empty | ❌ Optional |
| **Environment Rules** | Settings → Environments | Default is fine | ❌ Optional |

---

**That's it! Your GitHub Pages site should now be live! 🎉**
