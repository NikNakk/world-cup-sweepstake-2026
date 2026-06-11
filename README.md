# World Cup 2026 Sweepstake GitHub Pages site

This project builds a static GitHub Pages site showing World Cup 2026 fixtures, results, group tables and knockout rounds, with each team labelled with the person from the sweepstake photo.

It is designed for the API-Football / API-SPORTS free tier. A full daily build currently uses only **3 API requests**:

1. `fixtures?league=1&season=2026`
2. `standings?league=1&season=2026`
3. `fixtures/rounds?league=1&season=2026`

API-Football's World Cup 2026 guide states that the World Cup identifiers are `league=1` and `season=2026`, and that `/fixtures` returns the schedule, `/standings` returns the group tables, and `/fixtures/rounds` returns the round names.

## Repository structure

```text
.github/workflows/update-worldcup.yml  Daily GitHub Action and Pages deployment
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
export API_FOOTBALL_KEY="your-api-football-key"
python -m src.worldcup_site.generate
python -m http.server 8000 --directory site
```

Then open `http://localhost:8000`.

If no API key is present, the generator will use `.cache/last_payload.json` if one exists; otherwise it will still build the page with empty data. This makes local styling changes possible without burning API calls.

## GitHub setup

1. Create a new GitHub repository.
2. Copy these files into it and push to `main`.
3. In **Settings → Secrets and variables → Actions**, add a repository secret named:

```text
API_FOOTBALL_KEY
```

4. In **Settings → Pages**, set the source to **GitHub Actions**.
5. Run **Actions → Update World Cup site → Run workflow**, or wait for the daily schedule.

## Changing the sweepstake mapping

Edit `data/people_teams.json`. Several aliases are included because API-Football may use names such as `Congo DR` rather than `DR Congo`, or `Côte d'Ivoire` rather than `Ivory Coast`.

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

## API quota notes

The workflow is deliberately daily, not hourly, to stay within the free tier. During the tournament, a daily refresh is enough for a wall-chart-style page. If you want same-day live updates during matches, add a second workflow during match windows only; do not poll every few minutes on the free tier.

## Deployment model

The workflow deploys the generated `site/` directory directly using GitHub Pages Actions. It does not commit generated HTML back to the repository.
