# World Cup 2026 Sweepstake GitHub Pages site

This project builds a static GitHub Pages site showing World Cup 2026 fixtures, results, group tables and knockout rounds, with each team labelled with the person from the sweepstake photo.

It uses the free open-source `worldcup26.ir` API from [rezarahiminia/worldcup2026](https://github.com/rezarahiminia/worldcup2026). A full build fetches:

1. `https://worldcup26.ir/get/games`
2. `https://worldcup26.ir/get/groups`
3. `https://worldcup26.ir/get/teams`
4. `https://worldcup26.ir/get/stadiums`

No API key is required for read access.

## Repository structure

```text
.github/workflows/update-worldcup.yml  Match-window GitHub Action and Pages deployment
data/people_teams.json                 Sweepstake team-to-person mapping
site/assets/style.css                   Site styling
site/assets/site.js                     Small progressive enhancement script
src/worldcup_site/generate.py           Python fetch + static HTML generator
requirements.txt                        Python dependencies
```

## Quick start locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m src.worldcup_site.generate
python -m http.server 8000 --directory site
```

Then open `http://localhost:8000`.

If the API cannot be reached, the generator will use `.cache/last_payload.json` if one exists; otherwise it will still build the page with empty data. This makes local styling changes possible without needing a live API response.

## GitHub setup

1. Create a new GitHub repository.
2. Copy these files into it and push to `main`.
3. In **Settings → Pages**, set the source to **GitHub Actions**.
4. Run **Actions → Update World Cup site → Run workflow**, or wait for the scheduled checks.

## Changing the sweepstake mapping

Edit `data/people_teams.json`. Several aliases are included because APIs may use names such as `Democratic Republic of the Congo` rather than `DR Congo`, or `Côte d'Ivoire` rather than `Ivory Coast`.

Current mapping transcribed from the image:

| Person | Teams |
|---|---|
| Jane | Uruguay, Japan, Qatar |
| Emma | France, Ivory Coast, Czech Republic |
| Jennie | Netherlands, Austria, Panama |
| Sean | Senegal, Iran, Jordan |
| Seham | Portugal, Algeria, Haiti |
| Nick | Germany, Australia, DR Congo |
| Ben | England, Paraguay, Iraq |
| Tom | Egypt, Norway, Scotland |
| Tariq | Croatia, Canada, Uzbekistan |
| Chris | Spain, Ghana, Sweden |
| John C | Argentina, Turkey, New Zealand |
| Richard | South Korea, United States, Tunisia |
| Alistair | Morocco, Switzerland, Bosnia & Herzegovina |
| Andrew | Brazil, Mexico, Cape Verde |
| Diggers | Colombia, Saudi Arabia, South Africa |
| Extra | Belgium, Ecuador, Curacao |

## API refresh notes

The workflow checks every 5 minutes. Scheduled runs only build and deploy when the API reports a live match, or when an unfinished match is within its scheduled 3-hour kickoff window. Manual workflow runs always build and deploy.

## Deployment model

The workflow deploys the generated `site/` directory directly using GitHub Pages Actions. It does not commit generated HTML back to the repository.
