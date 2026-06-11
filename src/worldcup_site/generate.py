from __future__ import annotations

import argparse
import html
import json
import os
import shutil
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

BASE_URL = "https://v3.football.api-sports.io"
LEAGUE_ID = 1
SEASON = 2026
LIVE_STATUSES = {"1H", "HT", "2H", "ET", "P", "BT", "LIVE"}
FINISHED_STATUSES = {"FT", "AET", "PEN"}
NOT_STARTED_STATUSES = {"TBD", "NS"}

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
SITE_DIR = ROOT / "site"
ASSETS_DIR = SITE_DIR / "assets"
CACHE_DIR = ROOT / ".cache"


@dataclass(frozen=True)
class ApiPayload:
    fixtures: list[dict[str, Any]]
    standings: list[Any]
    rounds: list[str]
    generated_at: datetime
    source: str


def load_people_map() -> dict[str, str]:
    return json.loads((DATA_DIR / "people_teams.json").read_text(encoding="utf-8"))


def api_get(endpoint: str, params: dict[str, Any], api_key: str) -> Any:
    response = requests.get(
        f"{BASE_URL}/{endpoint.lstrip('/')}",
        params=params,
        headers={"x-apisports-key": api_key},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    if data.get("errors"):
        raise RuntimeError(f"API-Football returned errors for {endpoint}: {data['errors']}")
    return data.get("response", [])


def fetch_api(api_key: str) -> ApiPayload:
    """Fetch all data using only three API calls, well inside the 100/day free tier."""
    fixtures = api_get("fixtures", {"league": LEAGUE_ID, "season": SEASON}, api_key)
    standings = api_get("standings", {"league": LEAGUE_ID, "season": SEASON}, api_key)
    rounds = api_get("fixtures/rounds", {"league": LEAGUE_ID, "season": SEASON}, api_key)
    return ApiPayload(fixtures, standings, rounds, datetime.now(timezone.utc), "api-football")


def cache_payload(payload: ApiPayload) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    (CACHE_DIR / "last_payload.json").write_text(
        json.dumps(
            {
                "fixtures": payload.fixtures,
                "standings": payload.standings,
                "rounds": payload.rounds,
                "generated_at": payload.generated_at.isoformat(),
                "source": payload.source,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def load_cached_payload() -> ApiPayload | None:
    cache_file = CACHE_DIR / "last_payload.json"
    if not cache_file.exists():
        return None
    data = json.loads(cache_file.read_text(encoding="utf-8"))
    return ApiPayload(
        fixtures=data.get("fixtures", []),
        standings=data.get("standings", []),
        rounds=data.get("rounds", []),
        generated_at=datetime.fromisoformat(data.get("generated_at")),
        source="cached-api-football",
    )


def team_owner(team_name: str, people_map: dict[str, str]) -> str:
    return people_map.get(team_name) or people_map.get(team_name.replace("Côte", "Cote")) or "—"


def display_team(team: dict[str, Any] | None, people_map: dict[str, str]) -> str:
    if not team:
        return "<span class='placeholder'>TBC</span>"
    name = team.get("name") or "TBC"
    owner = team_owner(name, people_map)
    logo = team.get("logo")
    logo_html = f"<img src='{html.escape(logo)}' alt='' loading='lazy'>" if logo else ""
    owner_html = f"<span class='owner'>{html.escape(owner)}</span>" if owner != "—" else ""
    return f"<span class='team'>{logo_html}<span>{html.escape(name)}</span>{owner_html}</span>"


def get_standings_tables(standings: list[Any]) -> dict[str, list[dict[str, Any]]]:
    tables: dict[str, list[dict[str, Any]]] = {}
    if not standings:
        return tables
    league = standings[0].get("league", {}) if isinstance(standings[0], dict) else {}
    for table in league.get("standings", []) or []:
        if not table:
            continue
        group_name = table[0].get("group") or "Group stage"
        tables[group_name] = table
    return dict(sorted(tables.items(), key=lambda item: item[0]))


def build_team_to_group(tables: dict[str, list[dict[str, Any]]]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for group, rows in tables.items():
        for row in rows:
            team = row.get("team", {}).get("name")
            if team:
                mapping[team] = group
    return mapping


def fixture_sort_key(fixture: dict[str, Any]) -> tuple[str, int]:
    details = fixture.get("fixture", {})
    return (details.get("date") or "9999", details.get("id") or 0)


def format_date(date_string: str | None) -> str:
    if not date_string:
        return "TBC"
    try:
        dt = datetime.fromisoformat(date_string.replace("Z", "+00:00"))
        return dt.strftime("%a %-d %b %Y, %H:%M")
    except ValueError:
        return date_string


def score_or_time(match: dict[str, Any]) -> str:
    status = match.get("fixture", {}).get("status", {})
    short = status.get("short")
    goals = match.get("goals", {})
    if short in FINISHED_STATUSES or short in LIVE_STATUSES:
        home = goals.get("home")
        away = goals.get("away")
        return f"{home if home is not None else '–'}–{away if away is not None else '–'}"
    if short in NOT_STARTED_STATUSES:
        return format_date(match.get("fixture", {}).get("date"))
    return status.get("long") or format_date(match.get("fixture", {}).get("date"))


def match_card(match: dict[str, Any], people_map: dict[str, str]) -> str:
    fixture = match.get("fixture", {})
    teams = match.get("teams", {})
    venue = fixture.get("venue", {})
    status = fixture.get("status", {})
    status_class = "live" if status.get("short") in LIVE_STATUSES else "done" if status.get("short") in FINISHED_STATUSES else "upcoming"
    venue_bits = [venue.get("name"), venue.get("city")]
    venue_text = ", ".join([v for v in venue_bits if v])
    return f"""
      <article class='match {status_class}'>
        <div class='match-meta'>
          <span>{html.escape(match.get('league', {}).get('round') or '')}</span>
          <span>{html.escape(status.get('long') or '')}</span>
        </div>
        <div class='teams-row'>
          {display_team(teams.get('home'), people_map)}
          <strong class='score'>{html.escape(score_or_time(match))}</strong>
          {display_team(teams.get('away'), people_map)}
        </div>
        <div class='venue'>{html.escape(venue_text)}</div>
      </article>
    """


def render_standings(tables: dict[str, list[dict[str, Any]]], people_map: dict[str, str]) -> str:
    if not tables:
        return "<p class='empty'>Standings are not available yet.</p>"
    sections = []
    for group, rows in tables.items():
        body = []
        for row in rows:
            all_stats = row.get("all", {})
            goals = all_stats.get("goals", {})
            team = row.get("team", {})
            body.append(
                f"""
                <tr>
                  <td class='rank'>{row.get('rank', '')}</td>
                  <td>{display_team(team, people_map)}</td>
                  <td>{team_owner(team.get('name', ''), people_map)}</td>
                  <td>{all_stats.get('played', 0)}</td>
                  <td>{all_stats.get('win', 0)}</td>
                  <td>{all_stats.get('draw', 0)}</td>
                  <td>{all_stats.get('lose', 0)}</td>
                  <td>{goals.get('for', 0)}–{goals.get('against', 0)}</td>
                  <td>{row.get('goalsDiff', 0)}</td>
                  <td><strong>{row.get('points', 0)}</strong></td>
                </tr>
                """
            )
        sections.append(
            f"""
            <section class='group-card' id='{html.escape(group.lower().replace(' ', '-'))}'>
              <h3>{html.escape(group)}</h3>
              <div class='table-wrap'>
                <table>
                  <thead><tr><th>#</th><th>Team</th><th>Person</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF–GA</th><th>GD</th><th>Pts</th></tr></thead>
                  <tbody>{''.join(body)}</tbody>
                </table>
              </div>
            </section>
            """
        )
    return "".join(sections)


def render_fixtures_by_group(
    fixtures: list[dict[str, Any]], team_groups: dict[str, str], people_map: dict[str, str]
) -> str:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    group_stage = [f for f in fixtures if "Group" in (f.get("league", {}).get("round") or "")]
    for match in group_stage:
        home = match.get("teams", {}).get("home", {}).get("name")
        away = match.get("teams", {}).get("away", {}).get("name")
        group = team_groups.get(home) or team_groups.get(away) or "Group stage"
        grouped[group].append(match)
    if not grouped:
        return "<p class='empty'>Group fixtures are not available yet.</p>"
    html_sections = []
    for group in sorted(grouped):
        cards = "".join(match_card(m, people_map) for m in sorted(grouped[group], key=fixture_sort_key))
        html_sections.append(f"<section class='fixture-group'><h3>{html.escape(group)}</h3>{cards}</section>")
    return "".join(html_sections)


def round_order(round_name: str, api_rounds: list[str]) -> tuple[int, str]:
    known = [
        "Round of 32",
        "Round of 16",
        "Quarter",
        "Semi",
        "3rd Place",
        "Third",
        "Final",
    ]
    for i, item in enumerate(api_rounds):
        if item == round_name:
            return (i, round_name)
    for i, token in enumerate(known, start=100):
        if token.lower() in round_name.lower():
            return (i, round_name)
    return (999, round_name)


def render_knockouts(fixtures: list[dict[str, Any]], rounds: list[str], people_map: dict[str, str]) -> str:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for match in fixtures:
        round_name = match.get("league", {}).get("round") or "Other"
        if "Group" not in round_name:
            grouped[round_name].append(match)
    if not grouped:
        return "<p class='empty'>Knockout fixtures will appear here once the API lists them.</p>"
    sections = []
    for round_name in sorted(grouped, key=lambda r: round_order(r, rounds)):
        cards = "".join(match_card(m, people_map) for m in sorted(grouped[round_name], key=fixture_sort_key))
        sections.append(f"<section class='knockout-round'><h3>{html.escape(round_name)}</h3>{cards}</section>")
    return "".join(sections)


def render_people(people_map: dict[str, str]) -> str:
    by_person: dict[str, list[str]] = defaultdict(list)
    canonical_seen: set[tuple[str, str]] = set()
    for team, person in people_map.items():
        # Avoid duplicate alias-heavy display where obvious aliases are present.
        key = (person, team.lower().replace("côte", "cote").replace("&", "and"))
        if key in canonical_seen:
            continue
        canonical_seen.add(key)
        if team in {"Cote d'Ivoire", "Congo DR", "Korea Republic", "USA", "Türkiye", "Bosnia and Herzegovina", "Cabo Verde", "Curaçao"}:
            continue
        by_person[person].append(team)
    cards = []
    for person in sorted(by_person):
        teams = "".join(f"<li>{html.escape(team)}</li>" for team in sorted(by_person[person]))
        cards.append(f"<article class='person-card'><h3>{html.escape(person)}</h3><ul>{teams}</ul></article>")
    return "".join(cards)


def render_page(payload: ApiPayload) -> str:
    people_map = load_people_map()
    standings = get_standings_tables(payload.standings)
    team_groups = build_team_to_group(standings)
    fixtures = sorted(payload.fixtures, key=fixture_sort_key)
    finished = sum(1 for f in fixtures if f.get("fixture", {}).get("status", {}).get("short") in FINISHED_STATUSES)
    live = sum(1 for f in fixtures if f.get("fixture", {}).get("status", {}).get("short") in LIVE_STATUSES)
    upcoming = max(len(fixtures) - finished - live, 0)
    generated = payload.generated_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return f"""<!doctype html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
  <title>World Cup 2026 Sweepstake</title>
  <link rel='stylesheet' href='assets/style.css'>
</head>
<body>
  <header class='hero'>
    <div>
      <p class='eyebrow'>Daily GitHub Pages wall chart</p>
      <h1>World Cup 2026 Sweepstake</h1>
      <p class='lead'>Fixtures, results, groups and knockout stages, with each team labelled by its person from the sweepstake sheet.</p>
    </div>
    <div class='stats'>
      <div><strong>{len(fixtures)}</strong><span>fixtures</span></div>
      <div><strong>{finished}</strong><span>finished</span></div>
      <div><strong>{live}</strong><span>live</span></div>
      <div><strong>{upcoming}</strong><span>upcoming</span></div>
    </div>
  </header>

  <nav class='tabs' aria-label='Page sections'>
    <a href='#groups'>Groups</a>
    <a href='#group-fixtures'>Group fixtures</a>
    <a href='#knockouts'>Knockouts</a>
    <a href='#people'>People</a>
  </nav>

  <main>
    <section id='groups'>
      <div class='section-heading'><h2>Group tables</h2><p>Top two plus the eight best third-placed teams progress to the Round of 32.</p></div>
      <div class='grid groups-grid'>{render_standings(standings, people_map)}</div>
    </section>

    <section id='group-fixtures'>
      <div class='section-heading'><h2>Group results & fixtures</h2><p>Grouped using the current standings feed where possible.</p></div>
      <div class='fixture-grid'>{render_fixtures_by_group(fixtures, team_groups, people_map)}</div>
    </section>

    <section id='knockouts'>
      <div class='section-heading'><h2>Knockout stages</h2><p>Round of 32 onwards.</p></div>
      <div class='knockout-grid'>{render_knockouts(fixtures, payload.rounds, people_map)}</div>
    </section>

    <section id='people'>
      <div class='section-heading'><h2>Sweepstake people</h2><p>Team ownership transcribed from the photo.</p></div>
      <div class='people-grid'>{render_people(people_map)}</div>
    </section>
  </main>

  <footer>
    <p>Last generated {html.escape(generated)} from {html.escape(payload.source)}. Data source: API-Football / API-SPORTS. Built as static HTML.</p>
  </footer>
  <script src='assets/site.js'></script>
</body>
</html>"""


def generate(api_key: str | None, allow_cache: bool = True) -> None:
    SITE_DIR.mkdir(exist_ok=True)
    ASSETS_DIR.mkdir(exist_ok=True)
    if api_key:
        payload = fetch_api(api_key)
        cache_payload(payload)
    elif allow_cache and (cached := load_cached_payload()):
        payload = cached
    else:
        payload = ApiPayload([], [], [], datetime.now(timezone.utc), "no API key / no cache")

    (SITE_DIR / "index.html").write_text(render_page(payload), encoding="utf-8")
    shutil.copyfile(DATA_DIR / "people_teams.json", SITE_DIR / "people_teams.json")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the World Cup 2026 GitHub Pages site.")
    parser.add_argument("--api-key", default=os.environ.get("API_FOOTBALL_KEY"))
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args()
    generate(args.api_key, allow_cache=not args.no_cache)


if __name__ == "__main__":
    main()
