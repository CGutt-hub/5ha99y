# Changelog

## [Unreleased] - 2026-02-12

### Fixed
- **Deployment failures**: Fixed duplicate blog post issue causing Zola build errors
- **Path collisions**: Auto-generated blog posts now properly cleaned up before recreation

### Added
- Cleanup logic in `scripts/fetch_data.py` to remove old blog posts
- Comprehensive `.gitignore` patterns for auto-generated content
- Clear documentation in README.md explaining repository structure

### Removed
- Legacy documentation files (DEPLOYMENT_STEPS.md, GITHUB_PAGES_SETUP.md, etc.)
- Unused PowerShell scripts (build.ps1, update.ps1)
- Auto-generated files from git tracking
- Duplicate/confusing documentation

### Changed
- README.md completely rewritten for clarity
- Repository structure simplified to source files only
- .gitignore updated with clear comments and patterns

## Summary

This release fixes the website deployment issues and cleans up the repository structure to prevent future confusion. All auto-generated content is now properly excluded from version control, and the documentation clearly explains what's what.

### Migration Notes

After merging:
1. GitHub Actions will run successfully
2. Website will update with fresh content
3. Auto-generated files will be created during deployment
4. No manual intervention needed

### Files Now Auto-Generated (Not in Git)
- `public/` - Built website
- `data/` - API response cache
- `content/projects.md` - From GitHub repos
- `content/publications.md` - From ORCID
- `content/blog/YYYY-MM-DD-new-project-*.md` - Project announcements
- `content/blog/YYYY-MM-DD-new-publication-*.md` - Publication announcements
