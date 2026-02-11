# Zola GitHub Pages Site - Scientific Hub

This is a static website built with [Zola](https://www.getzola.org/) that automatically syncs content from your scientific profiles.

## Automatic Content Updates

The site **automatically pulls data** from:
- **GitHub** — Your repositories and code projects
- **OSF** — Research projects and data
- **ORCID** — Publications and works

You don't need to manually update the website! When you push to GitHub, the deployment workflow automatically:
1. Fetches latest data from GitHub, OSF, and ORCID APIs
2. Generates a projects page with your repositories and research
3. Builds and deploys the site

## Manual Updates (Optional)

To preview updates locally before they deploy:

```powershell
.\update.ps1
```

This will fetch data and rebuild the site locally.

## Local Development

1. Make content changes in `content/` folder (home page, research page)
2. Run `zola serve` to preview at http://127.0.0.1:1111
3. Push to GitHub — the rest happens automatically!

## Deployment

The site automatically deploys to GitHub Pages when you push to the `main` branch.

### Setup Instructions

1. Create a new repository named `cagatay.gutt.github.io` on GitHub
2. Initialize git and push:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/cagatay/gutt.github.io.git
   git push -u origin main
   ```
3. Go to repository Settings → Pages
4. Under "Build and deployment", select "GitHub Actions" as the source
5. Your site will be live at https://cagatay.gutt.github.io

## Project Structure

- `config.toml` - Site configuration
- `content/` - Markdown content files
- `templates/` - HTML templates
- `static/` - Static assets (CSS, images, etc.)
- `sass/` - Sass files for styling (optional)
- `public/` - Generated site (don't commit this)

## Customization

- Edit `config.toml` to change site settings
- Modify templates in `templates/` to change the layout
- Add content in `content/` as Markdown files
- Update styles in `static/style.css`
