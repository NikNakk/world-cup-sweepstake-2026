from __future__ import annotations

import argparse
import html
import json
import shutil
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

BASE_URL = "https://worldcup26.ir"
LIVE_STATUSES = {"1H", "HT", "2H", "ET", "P", "BT", "LIVE"}
FINISHED_STATUSES = {"FT", "AET", "PEN"}
NOT_STARTED_STATUSES = {"TBD", "NS"}
MATCH_UPDATE_WINDOW = timedelta(hours=3)
STADIUM_TIMEZONES = {
    "1": "America/Mexico_City",
    "2": "America/Mexico_City",
    "3": "America/Monterrey",
    "4": "America/Chicago",
    "5": "America/Chicago",
    "6": "America/Chicago",
    "7": "America/New_York",
    "8": "America/New_York",
    "9": "America/New_York",
    "10": "America/New_York",
    "11": "America/New_York",
    "12": "America/Toronto",
    "13": "America/Vancouver",
    "14": "America/Los_Angeles",
    "15": "America/Los_Angeles",
    "16": "America/Los_Angeles",
}
TEAM_ALIASES = {
    "Democratic Republic of the Congo": "DR Congo",
}
TEAM_DISPLAY_NAMES = {
    "Democratic Republic of the Congo": "DR Congo",
}
ROUND_NAMES = {
    "r32": "Round of 32",
    "r16": "Round of 16",
    "qf": "Quarter-finals",
    "sf": "Semi-finals",
    "third": "3rd Place",
    "final": "Final",
}

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


def api_get(endpoint: str, response_key: str) -> list[dict[str, Any]]:
    response = requests.get(f"{BASE_URL}/{endpoint.lstrip('/')}", timeout=30)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        data = data.get(response_key, [])
    if not isinstance(data, list):
        raise RuntimeError(f"worldcup26.ir returned an unexpected response for {endpoint}")
    return data


def as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def by_id(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(item.get("id")): item for item in items if item.get("id") is not None}


def parse_worldcup_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%m/%d/%Y %H:%M").isoformat()
    except ValueError:
        return value


def parse_api_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%m/%d/%Y %H:%M")
    except ValueError:
        return None


def game_kickoff_utc(game: dict[str, Any]) -> datetime | None:
    kickoff = parse_api_datetime(game.get("local_date"))
    if not kickoff:
        return None
    zone_name = STADIUM_TIMEZONES.get(str(game.get("stadium_id")))
    zone = ZoneInfo(zone_name) if zone_name else timezone.utc
    return kickoff.replace(tzinfo=zone).astimezone(timezone.utc)


def team_payload(
    team: dict[str, Any] | None, fallback_name: str | None = None
) -> dict[str, Any] | None:
    name = (team or {}).get("name_en") or fallback_name
    if not name:
        return None
    return {"name": name, "logo": (team or {}).get("flag")}


def match_status(game: dict[str, Any]) -> dict[str, str]:
    if str(game.get("finished")).upper() == "TRUE":
        return {"short": "FT", "long": "Full Time"}
    elapsed = str(game.get("time_elapsed") or "").lower()
    if elapsed in {"notstarted", "not_started", "0", ""}:
        return {"short": "NS", "long": "Not Started"}
    return {"short": "LIVE", "long": f"{game.get('time_elapsed')} elapsed"}


def is_finished_game(game: dict[str, Any]) -> bool:
    return str(game.get("finished")).upper() == "TRUE"


def is_live_game(game: dict[str, Any]) -> bool:
    elapsed = str(game.get("time_elapsed") or "").lower()
    return not is_finished_game(game) and elapsed not in {"notstarted", "not_started", "0", ""}


def should_update_for_games(games: list[dict[str, Any]], now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    for game in games:
        if is_live_game(game):
            return True
        kickoff = game_kickoff_utc(game)
        if kickoff and not is_finished_game(game) and kickoff <= now <= kickoff + MATCH_UPDATE_WINDOW:
            return True
    return False


def round_name(game: dict[str, Any]) -> str:
    match_type = str(game.get("type") or "").lower()
    if match_type == "group":
        group = game.get("group") or ""
        matchday = game.get("matchday")
        suffix = f" - Matchday {matchday}" if matchday else ""
        return f"Group {group}{suffix}".strip()
    return ROUND_NAMES.get(match_type, str(game.get("group") or match_type or "Other"))


def normalize_fixtures(
    games: list[dict[str, Any]], teams: list[dict[str, Any]], stadiums: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    teams_by_id = by_id(teams)
    stadiums_by_id = by_id(stadiums)
    fixtures = []
    for game in games:
        home_team = teams_by_id.get(str(game.get("home_team_id")))
        away_team = teams_by_id.get(str(game.get("away_team_id")))
        stadium = stadiums_by_id.get(str(game.get("stadium_id")), {})
        fixtures.append(
            {
                "fixture": {
                    "id": as_int(game.get("id")),
                    "date": parse_worldcup_date(game.get("local_date")),
                    "status": match_status(game),
                    "venue": {
                        "name": stadium.get("fifa_name") or stadium.get("name_en"),
                        "city": stadium.get("city_en"),
                    },
                },
                "league": {"round": round_name(game)},
                "teams": {
                    "home": team_payload(
                        home_team, game.get("home_team_name_en") or game.get("home_team_label")
                    ),
                    "away": team_payload(
                        away_team, game.get("away_team_name_en") or game.get("away_team_label")
                    ),
                },
                "goals": {
                    "home": as_int(game.get("home_score")),
                    "away": as_int(game.get("away_score")),
                },
            }
        )
    return fixtures


def normalize_standings(
    groups: list[dict[str, Any]], teams: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    teams_by_id = by_id(teams)
    standings = []
    for group in groups:
        rows = []
        group_name = group.get("name") or group.get("group") or ""
        for rank, row in enumerate(group.get("teams", []), start=1):
            team = teams_by_id.get(str(row.get("team_id")), {})
            goals_for = as_int(row.get("gf"))
            goals_against = as_int(row.get("ga"))
            rows.append(
                {
                    "rank": rank,
                    "team": team_payload(team) or {"name": f"Team {row.get('team_id')}"},
                    "group": f"Group {group_name}",
                    "points": as_int(row.get("pts")),
                    "goalsDiff": as_int(row.get("gd"), goals_for - goals_against),
                    "all": {
                        "played": as_int(row.get("mp")),
                        "win": as_int(row.get("w")),
                        "draw": as_int(row.get("d")),
                        "lose": as_int(row.get("l")),
                        "goals": {"for": goals_for, "against": goals_against},
                    },
                }
            )
        standings.append(rows)
    standings.sort(key=lambda rows: rows[0].get("group", "") if rows else "")
    return [{"league": {"standings": standings}}]


def fetch_api() -> ApiPayload:
    games = api_get("get/games", "games")
    groups = api_get("get/groups", "groups")
    teams = api_get("get/teams", "teams")
    stadiums = api_get("get/stadiums", "stadiums")
    fixtures = normalize_fixtures(games, teams, stadiums)
    standings = normalize_standings(groups, teams)
    rounds = list(
        dict.fromkeys(f["league"]["round"] for f in fixtures if "Group" not in f["league"]["round"])
    )
    return ApiPayload(fixtures, standings, rounds, datetime.now(timezone.utc), "worldcup26.ir")


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
        source="cached-worldcup26.ir",
    )


def team_owner(team_name: str, people_map: dict[str, str]) -> str:
    return (
        people_map.get(team_name)
        or people_map.get(TEAM_ALIASES.get(team_name, ""))
        or people_map.get(team_name.replace("Côte", "Cote"))
        or "—"
    )


def display_team_name(team_name: str) -> str:
    return TEAM_DISPLAY_NAMES.get(team_name, team_name)


def display_team(
    team: dict[str, Any] | None, people_map: dict[str, str], show_owner: bool = True
) -> str:
    if not team:
        return "<span class='placeholder'>TBC</span>"
    name = team.get("name") or "TBC"
    label = display_team_name(name)
    owner = team_owner(name, people_map)
    logo = team.get("logo")
    logo_html = f"<img src='{html.escape(logo)}' alt='' loading='lazy'>" if logo else ""
    owner_html = f"<span class='owner'>{html.escape(owner)}</span>" if show_owner and owner != "—" else ""
    return f"<span class='team'>{logo_html}<span class='team-name'>{html.escape(label)}</span>{owner_html}</span>"


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
        return f"{dt.strftime('%a')} {dt.day} {dt.strftime('%b %Y, %H:%M')}"
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
        group_people = sorted(
            {
                team_owner(row.get("team", {}).get("name", ""), people_map)
                for row in rows
                if team_owner(row.get("team", {}).get("name", ""), people_map) != "—"
            }
        )
        group_people_attr = html.escape("|".join(group_people), quote=True)
        for row in rows:
            all_stats = row.get("all", {})
            goals = all_stats.get("goals", {})
            team = row.get("team", {})
            body.append(
                f"""
                <tr>
                  <td class='rank'>{row.get('rank', '')}</td>
                  <td>{display_team(team, people_map, show_owner=False)}</td>
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
            <section class='group-card' id='{html.escape(group.lower().replace(' ', '-'))}' data-people='{group_people_attr}'>
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
    for team, person in people_map.items():
        by_person[person].append(team)
    cards = []
    for person in sorted(by_person):
        teams = "".join(f"<li>{html.escape(team)}</li>" for team in sorted(by_person[person]))
        cards.append(
            f"<article class='person-card' data-person='{html.escape(person, quote=True)}' "
            f"role='button' tabindex='0' aria-pressed='false'>"
            f"<h3>{html.escape(person)}</h3>"
            f"<ul>{teams}</ul></article>"
        )
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
      <p class='eyebrow'>World Cup 2026 wall chart</p>
      <h1>RDUH Gastro Sweepstake</h1>
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
    <a href='#people'>People</a>
    <a href='#groups'>Groups</a>
    <a href='#group-fixtures'>Group fixtures</a>
    <a href='#knockouts'>Knockouts</a>
  </nav>

  <main>
    <section id='people'>
      <div class='section-heading'><h2>Sweepstake people</h2><p>Team ownership transcribed from the photo.</p></div>
      <div class='people-grid'>{render_people(people_map)}</div>
    </section>

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
  </main>

  <footer>
    <p>Last generated {html.escape(generated)} from {html.escape(payload.source)}. Data source: worldcup26.ir. Built as static HTML and refreshed by Cloudflare Workers.</p>
  </footer>
  <script src='assets/site.js'></script>
</body>
</html>"""


def generate(allow_cache: bool = True) -> None:
    SITE_DIR.mkdir(exist_ok=True)
    ASSETS_DIR.mkdir(exist_ok=True)
    try:
        payload = fetch_api()
        cache_payload(payload)
    except (requests.RequestException, RuntimeError):
        if allow_cache and (cached := load_cached_payload()):
            payload = cached
        else:
            payload = ApiPayload(
                [], [], [], datetime.now(timezone.utc), "worldcup26.ir unavailable / no cache"
            )

    (SITE_DIR / "index.html").write_text(render_page(payload), encoding="utf-8")
    shutil.copyfile(DATA_DIR / "people_teams.json", SITE_DIR / "people_teams.json")


def should_update_now() -> bool:
    return should_update_for_games(api_get("get/games", "games"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the World Cup 2026 static site.")
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument(
        "--should-update-now",
        action="store_true",
        help="Print true when a match is live or inside its scheduled update window.",
    )
    args = parser.parse_args()
    if args.should_update_now:
        print(str(should_update_now()).lower())
        return
    generate(allow_cache=not args.no_cache)


if __name__ == "__main__":
    main()
