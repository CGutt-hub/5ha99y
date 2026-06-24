#!/usr/bin/env python3
"""
Fetch and sync data from external platforms (GitHub, ORCID).
Updates website content automatically and generates blog posts
for new repositories, repository updates, and new publications.
"""

import json
import os
import re
import requests
from datetime import datetime
from pathlib import Path
from typing import TypedDict, Any, cast

# Configuration
GITHUB_USERNAME = "CGutt-hub"
ORCID_ID = "0000-0002-1774-532X"
WEBSITE_REPO = "5ha99y"

# GitHub API headers with optional token
GITHUB_HEADERS: dict[str, str] = {
    'User-Agent': 'Mozilla/5.0'
}
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
if GITHUB_TOKEN:
    GITHUB_HEADERS['Authorization'] = f'token {GITHUB_TOKEN}'


# --- Type Definitions ---

class GitHubRepo(TypedDict):
    name: str
    description: str
    readme: str
    url: str
    language: str | None
    stars: int
    updated: str
    pushed_at: str
    commits_url: str


class OrcidWork(TypedDict):
    title: str
    year: str | None
    type: str | None


class RepoTrackingInfo(TypedDict):
    last_pushed: str
    last_posted: str


class TrackedState(TypedDict):
    repos: dict[str, RepoTrackingInfo]
    publications: list[str]
    website: RepoTrackingInfo


# --- Utilities ---

def slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    return text.strip('-')


def sanitize_markdown(text: str) -> str:
    """Fix empty links like [text]() that cause Zola 'missing URL' errors."""
    text = re.sub(r'\[!\[([^\]]*)\]\(([^)]+)\)\]\(\s*\)', r'![\1](\2)', text)
    text = re.sub(r'\[([^\]]*)\]\(\s*\)', r'\1', text)
    return text


# --- Data Fetchers ---

def fetch_github_repos() -> list[GitHubRepo]:
    """Fetch public repositories from GitHub with README content."""
    url = f"https://api.github.com/users/{GITHUB_USERNAME}/repos"
    try:
        response = requests.get(url, params={"sort": "updated", "per_page": 20}, headers=GITHUB_HEADERS)
        response.raise_for_status()
        repos: list[dict[str, Any]] = response.json()

        repos = [r for r in repos if not r['fork']]
        repos.sort(key=lambda x: (x['stargazers_count'], x['updated_at']), reverse=True)

        result: list[GitHubRepo] = []
        for repo in repos[:10]:
            readme_url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo['name']}/readme"
            readme_content = "No README available."
            try:
                readme_resp = requests.get(readme_url, headers={**GITHUB_HEADERS, 'Accept': 'application/vnd.github.v3.raw'})
                if readme_resp.status_code == 200:
                    readme_content = sanitize_markdown(readme_resp.text.strip())
            except Exception:
                pass

            result.append({
                'name': repo['name'],
                'description': repo['description'] or 'No description',
                'readme': readme_content,
                'url': repo['html_url'],
                'language': repo['language'],
                'stars': repo['stargazers_count'],
                'updated': repo['updated_at'],
                'pushed_at': repo['pushed_at'],
                'commits_url': repo['commits_url'].replace('{/sha}', '')
            })
        return result
    except Exception as e:
        print(f"Error fetching GitHub repos: {e}")
        return []


def fetch_recent_commits(repo_name: str, since: str | None = None) -> list[dict[str, Any]]:
    """Fetch recent commits for a repository."""
    url = f"https://api.github.com/repos/{GITHUB_USERNAME}/{repo_name}/commits"
    params: dict[str, Any] = {"per_page": 5}
    if since:
        params['since'] = since
    try:
        response = requests.get(url, params=params, headers=GITHUB_HEADERS)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching commits for {repo_name}: {e}")
        return []


def fetch_orcid_works() -> list[OrcidWork]:
    """Fetch works/publications from ORCID."""
    url = f"https://pub.orcid.org/v3.0/{ORCID_ID}/works"
    try:
        response = requests.get(url, headers={'Accept': 'application/json'})
        response.raise_for_status()
        data: dict[str, Any] = response.json()

        works: list[OrcidWork] = []
        for group in data.get('group', [])[:10]:
            summary = group.get('work-summary', [{}])[0]
            title_obj = summary.get('title', {})
            works.append({
                'title': title_obj.get('title', {}).get('value', 'Untitled'),
                'year': summary.get('publication-date', {}).get('year', {}).get('value'),
                'type': summary.get('type')
            })
        return works
    except Exception as e:
        print(f"Error fetching ORCID works: {e}")
        return []


# --- Page Generators ---

def generate_projects_page(github_repos: list[GitHubRepo], lang: str = 'en') -> str:
    """Generate projects page from GitHub data with collapsible sections."""
    is_de = lang == 'de'
    if is_de:
        content = """+++
title = "Code-Projekte & Repositories"
+++

*Aktive Entwicklungsprojekte via [GitHub](https://github.com/CGutt-hub). Mein offenes Backoffice für kollaborative Wissenschaft.*

---

"""
    else:
        content = """+++
title = "Code Projects & Repositories"
+++

*Active development projects tracked via [GitHub](https://github.com/CGutt-hub). My open backoffice for collaborative science.*

---

"""

    if not github_repos:
        content += "*Keine Repositories gefunden.*\n" if is_de else "*No repositories found.*\n"
    else:
        for repo in github_repos:
            stars = f" ⭐ {repo['stars']}" if repo['stars'] > 0 else ""
            repo_lang = repo['language'] or ("Unbekannt" if is_de else "Unknown")
            if is_de:
                content += f"""### {repo['name']}

**Sprache:** {repo_lang}{stars}  
**Zuletzt aktualisiert:** {repo['updated'][:10]}

<details>
<summary>README anzeigen</summary>

{repo['readme']}

</details>

[Auf GitHub ansehen →]({repo['url']})

---

"""
            else:
                content += f"""### {repo['name']}

**Language:** {repo_lang}{stars}  
**Last updated:** {repo['updated'][:10]}

<details>
<summary>View README</summary>

{repo['readme']}

</details>

[View on GitHub →]({repo['url']})

---

"""

    if is_de:
        content += """
## Entwicklungsphilosophie

Aller Code wird mit dem Engagement für **offene und transparente Wissenschaft** entwickelt. Werkzeuge, Pipelines und Analysecode werden verfügbar gemacht, um Reproduzierbarkeit und kollaborativen Wissensfortschritt zu unterstützen.
"""
    else:
        content += """
## Development Philosophy

All code is developed with a commitment to **open and transparent science**. Tools, pipelines, and analysis code are made available to support reproducibility and collaborative advancement of knowledge.
"""
    return content


def generate_publications_page(orcid_works: list[OrcidWork], lang: str = 'en') -> str:
    """Generate publications page from ORCID data."""
    is_de = lang == 'de'
    if is_de:
        content = """+++
title = "Forschungspublikationen"
+++

*Vollständiger Forschungsoutput via [ORCID](https://orcid.org/0000-0002-1774-532X). Mein offenes Frontoffice für formale Forschung.*

---

"""
    else:
        content = """+++
title = "Research Publications"
+++

*Complete research output tracked via [ORCID](https://orcid.org/0000-0002-1774-532X). My open front office for formal research.*

---

"""

    if orcid_works:
        for work in orcid_works:
            year = work.get('year') or 'n.d.'
            raw_type = work.get('type') or 'Publication'
            work_type = raw_type.replace('-', ' ').title()
            if is_de:
                content += f"""### {work['title']}

**Jahr:** {year}  
**Typ:** {work_type}

[Publikation ansehen →](https://orcid.org/0000-0002-1774-532X)

---

"""
            else:
                content += f"""### {work['title']}

**Year:** {year}  
**Type:** {work_type}

[View Publication →](https://orcid.org/0000-0002-1774-532X)

---

"""
    else:
        content += "*Publikationen erscheinen hier automatisch von ORCID.*\n\n" if is_de else "*Publications will appear here automatically from ORCID.*\n\n"

    content += "---\n\n"
    if is_de:
        content += """## Forschungsphilosophie

Alle Forschung wird mit dem Engagement für **offene und transparente Wissenschaft** durchgeführt. Daten, Code und Materialien werden wann immer möglich verfügbar gemacht, um Reproduzierbarkeit und kollaborativen Wissensfortschritt zu unterstützen.
"""
    else:
        content += """## Research Philosophy

All research is conducted with a commitment to **open and transparent science**. Data, code, and materials are made available whenever possible to support reproducibility and collaborative advancement of knowledge.
"""
    return content


def generate_analysis_page(lang: str = 'en') -> str:
    """Generate analysis page frontmatter. Content is loaded client-side via GitHub API."""
    if lang == 'de':
        title = "Offene Daten"
    else:
        title = "Open Data"

    return f"""+++
title = "{title}"
template = "analysis.html"
+++
"""


# --- Data Persistence ---

def save_data_file(data: object, filename: str) -> None:
    """Save data as JSON to both data/ and static/data/ directories."""
    base = Path(__file__).parent.parent

    for subdir in ['data', 'static/data']:
        target_dir = base / subdir
        target_dir.mkdir(parents=True, exist_ok=True)
        with open(target_dir / filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Saved {filename} (data/ and static/data/)")


def load_posted_items() -> TrackedState:
    """Load tracking state for blog posts."""
    filepath = Path(__file__).parent.parent / 'data' / 'posted_items.json'
    if not filepath.exists():
        return {'repos': {}, 'publications': [], 'website': {'last_pushed': '', 'last_posted': ''}}

    with open(filepath, 'r', encoding='utf-8') as f:
        data: dict[str, Any] = json.load(f)

    # Migrate old format if needed
    repos_raw = data.get('repos', {})
    repos: dict[str, RepoTrackingInfo] = {}

    if isinstance(repos_raw, list):
        repos_list = cast(list[str], repos_raw)
        for name in repos_list:
            repos[name] = {'last_pushed': '', 'last_posted': ''}
    elif isinstance(repos_raw, dict):
        repos_dict = cast(dict[str, Any], repos_raw)
        for name, val in repos_dict.items():
            if isinstance(val, dict) and 'last_pushed' in val and 'last_posted' in val:
                val_dict = cast(dict[str, str], val)
                repos[name] = {
                    'last_pushed': val_dict.get('last_pushed', ''),
                    'last_posted': val_dict.get('last_posted', '')
                }
            else:
                repos[name] = {'last_pushed': '', 'last_posted': ''}

    return {
        'repos': repos,
        'publications': data.get('publications', []),
        'website': data.get('website', {'last_pushed': '', 'last_posted': ''})
    }


def save_posted_items(posted: TrackedState) -> None:
    """Save tracking state for blog posts."""
    data_dir = Path(__file__).parent.parent / 'data'
    data_dir.mkdir(exist_ok=True)
    with open(data_dir / 'posted_items.json', 'w', encoding='utf-8') as f:
        json.dump(posted, f, indent=2)


# --- Blog Post Generators ---

def generate_blog_post_for_repo(repo: GitHubRepo) -> tuple[str, str]:
    """Generate a blog post for a new GitHub repository."""
    today = datetime.now().strftime('%Y-%m-%d')
    slug = slugify(f"new-project-{repo['name']}")
    lang = repo['language'] or 'Multiple languages'

    content = f"""+++
title = "New Project: {repo['name']}"
date = {today}
description = "A new project has been added to my open backoffice"
[taxonomies]
tags = ["project", "github", "new"]
+++

A new project is now available in my [GitHub backoffice](https://github.com/{GITHUB_USERNAME}):

## {repo['name']}

{repo['description']}

**Language:** {lang}

This project contains analysis pipelines, data, and documentation following my commitment to open and transparent science.

[View on GitHub →]({repo['url']}) | [See all projects →](/projects/)
"""
    return f"{today}-{slug}.md", content


def generate_blog_post_for_repo_update(repo: GitHubRepo, commits: list[dict[str, Any]]) -> tuple[str, str]:
    """Generate a blog post for repository updates."""
    today = datetime.now().strftime('%Y-%m-%d')
    slug = slugify(f"update-{repo['name']}")

    commit_list = ""
    for commit in commits[:5]:
        msg = commit.get('commit', {}).get('message', '').split('\n')[0][:80]
        sha = commit.get('sha', '')[:7]
        commit_list += f"- `{sha}` {msg}\n"

    content = f"""+++
title = "Project Update: {repo['name']}"
date = {today}
description = "Recent updates to {repo['name']}"
[taxonomies]
tags = ["project", "github", "update"]
+++

Recent activity in [{repo['name']}]({repo['url']}):

## Recent Commits

{commit_list}

This project is actively maintained as part of my commitment to open and transparent science.

[View on GitHub →]({repo['url']}) | [See all projects →](/projects/)
"""
    return f"{today}-{slug}.md", content


def generate_blog_post_for_publication(work: OrcidWork) -> tuple[str, str]:
    """Generate a blog post for a new ORCID publication."""
    today = datetime.now().strftime('%Y-%m-%d')
    slug = slugify(f"new-publication-{work['title'][:40]}")
    year = work.get('year') or 'n.d.'
    raw_type = work.get('type') or 'Publication'
    work_type = raw_type.replace('-', ' ').title()

    content = f"""+++
title = "New Publication: {work['title']}"
date = {today}
description = "A new publication has been added to my research output"
[taxonomies]
tags = ["publication", "research", "orcid"]
+++

A new publication is now available in my [ORCID front office](https://orcid.org/{ORCID_ID}):

## {work['title']}

**Year:** {year}  
**Type:** {work_type}

This work represents my ongoing commitment to open and transparent science.

[View on ORCID →](https://orcid.org/{ORCID_ID}) | [See all publications →](/publications/)
"""
    return f"{today}-{slug}.md", content


def generate_blog_post_for_website_update(commits: list[dict[str, Any]]) -> tuple[str, str]:
    """Generate a blog post for website updates."""
    today = datetime.now().strftime('%Y-%m-%d')
    slug = slugify("website-update")

    commit_list = ""
    for commit in commits[:5]:
        msg = commit.get('commit', {}).get('message', '').split('\n')[0][:80]
        sha = commit.get('sha', '')[:7]
        commit_list += f"- `{sha}` {msg}\n"

    content = f"""+++
title = "Website Update"
date = {today}
description = "Recent updates to this website"
[taxonomies]
tags = ["website", "update", "meta"]
+++

This website has been updated with the following changes:

## Recent Changes

{commit_list}

The site continues to sync automatically with GitHub (projects) and ORCID (publications).

[View source on GitHub →](https://github.com/{GITHUB_USERNAME}/{WEBSITE_REPO})
"""
    return f"{today}-{slug}.md", content


# --- Auto Blog Post Engine ---

def _delete_old_posts(blog_dir: Path, slug: str) -> None:
    """Delete previous blog posts matching a slug pattern."""
    for existing in blog_dir.glob(f"????-??-??-{slug}.md"):
        existing.unlink()
        print(f"[-] Deleted old blog post: {existing.name}")


def _write_blog_post(blog_dir: Path, filename: str, content: str) -> None:
    """Write a blog post file."""
    with open(blog_dir / filename, 'w', encoding='utf-8') as f:
        f.write(content)


def generate_auto_blog_posts(
    github_repos: list[GitHubRepo],
    orcid_works: list[OrcidWork]
) -> int:
    """Generate blog posts for new projects, publications, and updates."""
    state = load_posted_items()
    blog_dir = Path(__file__).parent.parent / 'content' / 'blog'
    blog_dir.mkdir(exist_ok=True)

    new_posts = 0
    today = datetime.now().strftime('%Y-%m-%d')

    # Check for new GitHub repos and repo updates
    for repo in github_repos:
        repo_name = repo['name']
        pushed_at = repo.get('pushed_at', '')

        if repo_name not in state['repos']:
            slug = slugify(f"new-project-{repo_name}")
            _delete_old_posts(blog_dir, slug)
            filename, content = generate_blog_post_for_repo(repo)
            _write_blog_post(blog_dir, filename, content)
            state['repos'][repo_name] = {'last_pushed': pushed_at, 'last_posted': today}
            new_posts += 1
            print(f"[+] Created blog post for new project: {repo_name}")

        elif pushed_at and repo_name != WEBSITE_REPO:
            repo_state = state['repos'].get(repo_name, {'last_pushed': '', 'last_posted': ''})
            last_pushed = repo_state.get('last_pushed', '')
            last_posted = repo_state.get('last_posted', '')

            if pushed_at != last_pushed:
                days_since_post = 999
                if last_posted:
                    try:
                        days_since_post = (datetime.now() - datetime.strptime(last_posted, '%Y-%m-%d')).days
                    except ValueError:
                        pass

                if days_since_post >= 7:
                    commits = fetch_recent_commits(repo['name'])
                    if commits:
                        slug = slugify(f"update-{repo_name}")
                        _delete_old_posts(blog_dir, slug)
                        filename, content = generate_blog_post_for_repo_update(repo, commits)
                        _write_blog_post(blog_dir, filename, content)
                        state['repos'][repo_name] = {'last_pushed': pushed_at, 'last_posted': today}
                        new_posts += 1
                        print(f"[+] Created blog post for update: {repo_name}")
                else:
                    state['repos'][repo_name] = {'last_pushed': pushed_at, 'last_posted': last_posted}

    # Check for website updates
    website_repo = next((r for r in github_repos if r['name'] == WEBSITE_REPO), None)
    if website_repo:
        pushed_at = website_repo.get('pushed_at', '')
        website_state = state.get('website', {'last_pushed': '', 'last_posted': ''})
        last_pushed = website_state.get('last_pushed', '')
        last_posted = website_state.get('last_posted', '')

        if pushed_at and pushed_at != last_pushed:
            days_since_post = 999
            if last_posted:
                try:
                    days_since_post = (datetime.now() - datetime.strptime(last_posted, '%Y-%m-%d')).days
                except ValueError:
                    pass

            if days_since_post >= 7:
                commits = fetch_recent_commits(website_repo['name'])
                if commits:
                    _delete_old_posts(blog_dir, slugify("website-update"))
                    filename, content = generate_blog_post_for_website_update(commits)
                    _write_blog_post(blog_dir, filename, content)
                    state['website'] = {'last_pushed': pushed_at, 'last_posted': today}
                    new_posts += 1
                    print("[+] Created blog post for website update")
            else:
                state['website'] = {'last_pushed': pushed_at, 'last_posted': last_posted}

    # Check for new ORCID publications
    for work in orcid_works:
        if work['title'] not in state['publications']:
            slug = slugify(f"new-publication-{work['title'][:40]}")
            _delete_old_posts(blog_dir, slug)
            filename, content = generate_blog_post_for_publication(work)
            _write_blog_post(blog_dir, filename, content)
            state['publications'].append(work['title'])
            new_posts += 1
            print(f"[+] Created blog post for publication: {work['title']}")

    save_posted_items(state)
    return new_posts


# --- Main ---

def main() -> None:
    print("Fetching data from external platforms...")

    github_repos = fetch_github_repos()
    orcid_works = fetch_orcid_works()

    # Save API data as JSON for templates and client-side JS
    save_data_file({'repos': github_repos}, 'github.json')
    save_data_file({'works': orcid_works}, 'orcid.json')

    # Generate content pages (EN + DE)
    content_dir = Path(__file__).parent.parent / 'content'
    pages: dict[str, str] = {
        'projects.md': generate_projects_page(github_repos, 'en'),
        'projects.de.md': generate_projects_page(github_repos, 'de'),
        'publications.md': generate_publications_page(orcid_works, 'en'),
        'publications.de.md': generate_publications_page(orcid_works, 'de'),
        'analysis.md': generate_analysis_page('en'),
        'analysis.de.md': generate_analysis_page('de'),
    }
    for filename, page_content in pages.items():
        with open(content_dir / filename, 'w', encoding='utf-8') as f:
            f.write(page_content)

    # Generate auto blog posts
    new_posts = generate_auto_blog_posts(github_repos, orcid_works)

    print(f"[+] Updated {len(github_repos)} GitHub repos")
    print(f"[+] Updated {len(orcid_works)} ORCID works")
    print(f"[+] Generated 6 content pages")
    print(f"[+] Created {new_posts} new blog posts")


if __name__ == "__main__":
    main()
