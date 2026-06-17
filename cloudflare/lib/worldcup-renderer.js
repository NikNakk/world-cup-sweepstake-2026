const BASE_URL = 'https://worldcup26.ir';
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const MATCH_UPDATE_WINDOW_MS = 3 * 60 * 60 * 1000;
const CACHE_KEYS = {
  html: 'site:index.html',
  payload: 'site:payload.json',
  status: 'site:last-update.json',
};

const STADIUM_TIMEZONES = {
  '1': 'America/Mexico_City',
  '2': 'America/Mexico_City',
  '3': 'America/Monterrey',
  '4': 'America/Chicago',
  '5': 'America/Chicago',
  '6': 'America/Chicago',
  '7': 'America/New_York',
  '8': 'America/New_York',
  '9': 'America/New_York',
  '10': 'America/New_York',
  '11': 'America/New_York',
  '12': 'America/Toronto',
  '13': 'America/Vancouver',
  '14': 'America/Los_Angeles',
  '15': 'America/Los_Angeles',
  '16': 'America/Los_Angeles',
};

const TEAM_ALIASES = {
  'Democratic Republic of the Congo': 'DR Congo',
};

const TEAM_DISPLAY_NAMES = {
  'Democratic Republic of the Congo': 'DR Congo',
};


const BROADCASTER_TEAM_ALIASES = {
  Curacao: 'Curaçao',
  'DR Congo': 'Democratic Republic of the Congo',
};

const GROUP_STAGE_BROADCASTERS = [
  ['Mexico', 'South Africa', 'ITV1'],
  ['South Korea', 'Czech Republic', 'ITV1'],
  ['Canada', 'Bosnia and Herzegovina', 'BBC One'],
  ['United States', 'Paraguay', 'BBC One'],
  ['Qatar', 'Switzerland', 'ITV1'],
  ['Brazil', 'Morocco', 'BBC One'],
  ['Haiti', 'Scotland', 'BBC One'],
  ['Australia', 'Turkey', 'ITV1'],
  ['Germany', 'Curacao', 'ITV1'],
  ['Netherlands', 'Japan', 'ITV1'],
  ['Ivory Coast', 'Ecuador', 'BBC One'],
  ['Sweden', 'Tunisia', 'ITV1'],
  ['Spain', 'Cape Verde', 'ITV1'],
  ['Belgium', 'Egypt', 'BBC One'],
  ['Saudi Arabia', 'Uruguay', 'ITV1'],
  ['Iran', 'New Zealand', 'BBC One'],
  ['France', 'Senegal', 'BBC One'],
  ['Iraq', 'Norway', 'BBC One'],
  ['Argentina', 'Algeria', 'ITV1'],
  ['Austria', 'Jordan', 'BBC One'],
  ['Portugal', 'DR Congo', 'BBC One'],
  ['England', 'Croatia', 'ITV1'],
  ['Ghana', 'Panama', 'ITV1'],
  ['Uzbekistan', 'Colombia', 'BBC One'],
  ['Czech Republic', 'South Africa', 'BBC One'],
  ['Switzerland', 'Bosnia and Herzegovina', 'ITV1'],
  ['Canada', 'Qatar', 'ITV1'],
  ['Mexico', 'South Korea', 'BBC Two'],
  ['United States', 'Australia', 'BBC One'],
  ['Scotland', 'Morocco', 'ITV1/STV'],
  ['Brazil', 'Haiti', 'ITV1'],
  ['Turkey', 'Paraguay', 'ITV1'],
  ['Netherlands', 'Sweden', 'BBC One'],
  ['Germany', 'Ivory Coast', 'ITV1'],
  ['Ecuador', 'Curacao', 'BBC One'],
  ['Tunisia', 'Japan', 'BBC One'],
  ['Spain', 'Saudi Arabia', 'BBC One'],
  ['Belgium', 'Iran', 'ITV1'],
  ['Cape Verde', 'Uruguay', 'BBC One'],
  ['New Zealand', 'Egypt', 'ITV1'],
  ['Argentina', 'Austria', 'BBC One'],
  ['France', 'Iraq', 'BBC One'],
  ['Norway', 'Senegal', 'ITV1'],
  ['Jordan', 'Algeria', 'ITV1'],
  ['Portugal', 'Uzbekistan', 'ITV1'],
  ['England', 'Ghana', 'BBC One'],
  ['Croatia', 'Panama', 'BBC One'],
  ['Colombia', 'DR Congo', 'ITV1'],
  ['Canada', 'Switzerland', 'ITV1'],
  ['Scotland', 'Brazil', 'BBC One'],
  ['Mexico', 'Czech Republic', 'BBC One'],
  ['Germany', 'Ecuador', 'BBC One'],
  ['Japan', 'Sweden', 'BBC One'],
  ['United States', 'Turkey', 'ITV1'],
  ['France', 'Norway', 'ITV1'],
  ['Colombia', 'Portugal', 'BBC One'],
  ['Cape Verde', 'Saudi Arabia', 'ITV1'],
  ['Algeria', 'Austria', 'BBC One'],
  ['Egypt', 'Iran', 'BBC One'],
  ['England', 'Panama', 'ITV1'],
  ['Bosnia and Herzegovina', 'Qatar', 'ITV1'],
  ['Morocco', 'Haiti', 'BBC One'],
  ['South Africa', 'South Korea', 'BBC One'],
  ['Curacao', 'Ivory Coast', 'BBC One'],
  ['Netherlands', 'Tunisia', 'BBC One'],
  ['Paraguay', 'Australia', 'ITV1'],
  ['Senegal', 'Iraq', 'ITV1'],
  ['DR Congo', 'Uzbekistan', 'BBC One'],
  ['Uruguay', 'Spain', 'ITV1'],
  ['Argentina', 'Jordan', 'BBC One'],
  ['New Zealand', 'Belgium', 'BBC One'],
  ['Croatia', 'Ghana', 'ITV1'],
].reduce((map, [home, away, broadcaster]) => {
  map.set(broadcasterKey(home, away), broadcaster);
  return map;
}, new Map());

const ROUND_NAMES = {
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-finals',
  sf: 'Semi-finals',
  third: '3rd Place',
  final: 'Final',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function byId(items) {
  return Object.fromEntries(
    items.filter((item) => item?.id !== undefined && item?.id !== null).map((item) => [String(item.id), item]),
  );
}

async function apiGet(endpoint, responseKey) {
  const response = await fetch(`${BASE_URL}/${endpoint.replace(/^\/+/, '')}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`worldcup26.ir ${endpoint} returned HTTP ${response.status}`);
  }
  let data = await response.json();
  if (data && !Array.isArray(data) && typeof data === 'object') {
    data = data[responseKey] ?? [];
  }
  if (!Array.isArray(data)) {
    throw new Error(`worldcup26.ir returned an unexpected response for ${endpoint}`);
  }
  return data;
}

function parseWorldCupDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return value;
  const [, month, day, year, hour, minute] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00`;
}

function zonedTimeToUtc(dateTime, timeZone) {
  const iso = parseWorldCupDate(dateTime);
  if (!iso || !String(iso).includes('T')) return null;
  const [datePart, timePart] = String(iso).split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(utcGuess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour === '24' ? '0' : values.hour),
    Number(values.minute),
    Number(values.second),
  );
  const offset = asIfUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offset);
}

function gameKickoffUtc(game) {
  const zone = STADIUM_TIMEZONES[String(game?.stadium_id)] ?? 'UTC';
  return zonedTimeToUtc(game?.local_date, zone);
}

function isFinishedGame(game) {
  return String(game?.finished).toUpperCase() === 'TRUE';
}

function isLiveGame(game) {
  const elapsed = String(game?.time_elapsed ?? '').toLowerCase();
  return !isFinishedGame(game) && !['notstarted', 'not_started', '0', ''].includes(elapsed);
}

function shouldUpdateForGames(games, now = new Date()) {
  return games.some((game) => {
    if (isLiveGame(game)) return true;
    const kickoff = gameKickoffUtc(game);
    return Boolean(
      kickoff && !isFinishedGame(game) && kickoff <= now && now <= new Date(kickoff.getTime() + MATCH_UPDATE_WINDOW_MS),
    );
  });
}

function previousLiveMatchesFinished(games, previousPayload) {
  const liveFixtureIds = new Set(
    (previousPayload?.fixtures ?? [])
      .filter((fixture) => LIVE_STATUSES.has(fixture?.fixture?.status?.short))
      .map((fixture) => String(fixture?.fixture?.id ?? ''))
      .filter(Boolean),
  );

  if (!liveFixtureIds.size) return [];

  return games
    .filter((game) => liveFixtureIds.has(String(game?.id ?? '')) && isFinishedGame(game))
    .map((game) => ({
      id: asInt(game?.id),
      home: game?.home_team_name_en ?? game?.home_team_label,
      away: game?.away_team_name_en ?? game?.away_team_label,
    }));
}

function summarizeGames(games, now = new Date()) {
  return games.reduce((summary, game) => {
    const isFinished = isFinishedGame(game);
    const isLive = isLiveGame(game);
    const kickoff = gameKickoffUtc(game);
    const inActiveWindow = Boolean(
      kickoff && !isFinished && kickoff <= now && now <= new Date(kickoff.getTime() + MATCH_UPDATE_WINDOW_MS),
    );

    summary.total += 1;
    if (isFinished) summary.finished += 1;
    else if (isLive) summary.live += 1;
    else summary.upcoming += 1;
    if (inActiveWindow) summary.activeWindow += 1;
    return summary;
  }, {
    total: 0,
    finished: 0,
    live: 0,
    upcoming: 0,
    activeWindow: 0,
  });
}

function teamPayload(team, fallbackName = null) {
  const name = team?.name_en ?? fallbackName;
  return name ? { name, logo: team?.flag } : null;
}

function matchStatus(game) {
  if (isFinishedGame(game)) return { short: 'FT', long: 'Full Time' };
  const elapsed = String(game?.time_elapsed ?? '').toLowerCase();
  if (['notstarted', 'not_started', '0', ''].includes(elapsed)) {
    return { short: 'NS', long: 'Not Started' };
  }
  return { short: 'LIVE', long: `${game?.time_elapsed} elapsed` };
}

function roundName(game) {
  const matchType = String(game?.type ?? '').toLowerCase();
  if (matchType === 'group') {
    const suffix = game?.matchday ? ` - Matchday ${game.matchday}` : '';
    return `Group ${game?.group ?? ''}${suffix}`.trim();
  }
  return ROUND_NAMES[matchType] ?? String(game?.group ?? matchType ?? 'Other');
}

function normalizeFixtures(games, teams, stadiums) {
  const teamsById = byId(teams);
  const stadiumsById = byId(stadiums);
  return games.map((game) => {
    const stadium = stadiumsById[String(game?.stadium_id)] ?? {};
    return {
      fixture: {
        id: asInt(game?.id),
        date: gameKickoffUtc(game)?.toISOString() ?? parseWorldCupDate(game?.local_date),
        status: matchStatus(game),
        venue: {
          name: stadium.fifa_name ?? stadium.name_en,
          city: stadium.city_en,
        },
      },
      league: { round: roundName(game) },
      teams: {
        home: teamPayload(teamsById[String(game?.home_team_id)], game?.home_team_name_en ?? game?.home_team_label),
        away: teamPayload(teamsById[String(game?.away_team_id)], game?.away_team_name_en ?? game?.away_team_label),
      },
      goals: {
        home: asInt(game?.home_score),
        away: asInt(game?.away_score),
      },
    };
  });
}

function normalizeStandings(groups, teams) {
  const teamsById = byId(teams);
  const standings = groups.map((group) => {
    const groupName = group?.name ?? group?.group ?? '';
    return (group?.teams ?? []).map((row, index) => {
      const team = teamsById[String(row?.team_id)] ?? {};
      const goalsFor = asInt(row?.gf);
      const goalsAgainst = asInt(row?.ga);
      return {
        rank: index + 1,
        team: teamPayload(team) ?? { name: `Team ${row?.team_id}` },
        group: `Group ${groupName}`,
        points: asInt(row?.pts),
        goalsDiff: asInt(row?.gd, goalsFor - goalsAgainst),
        all: {
          played: asInt(row?.mp),
          win: asInt(row?.w),
          draw: asInt(row?.d),
          lose: asInt(row?.l),
          goals: { for: goalsFor, against: goalsAgainst },
        },
      };
    });
  });
  standings.sort((a, b) => String(a[0]?.group ?? '').localeCompare(String(b[0]?.group ?? '')));
  return [{ league: { standings } }];
}

async function fetchApiPayload() {
  const [games, groups, teams, stadiums] = await Promise.all([
    apiGet('get/games', 'games'),
    apiGet('get/groups', 'groups'),
    apiGet('get/teams', 'teams'),
    apiGet('get/stadiums', 'stadiums'),
  ]);
  const fixtures = normalizeFixtures(games, teams, stadiums);
  const standings = normalizeStandings(groups, teams);
  const rounds = [...new Set(fixtures.map((fixture) => fixture.league.round).filter((round) => !round.includes('Group')))];
  return {
    fixtures,
    standings,
    rounds,
    generatedAt: new Date().toISOString(),
    source: 'worldcup26.ir',
  };
}

function teamOwner(teamName, peopleMap) {
  return peopleMap[teamName]
    ?? peopleMap[TEAM_ALIASES[teamName] ?? '']
    ?? peopleMap[teamName.replace('Côte', 'Cote')]
    ?? '—';
}

function displayTeamName(teamName) {
  return TEAM_DISPLAY_NAMES[teamName] ?? teamName;
}

function displayTeam(team, peopleMap, showOwner = true) {
  if (!team) return "<span class='placeholder'>TBC</span>";
  const name = team.name ?? 'TBC';
  const owner = teamOwner(name, peopleMap);
  const logoHtml = team.logo ? `<img src='${escapeHtml(team.logo)}' alt='' loading='lazy'>` : '';
  const ownerHtml = showOwner && owner !== '—' ? `<span class='owner'>${escapeHtml(owner)}</span>` : '';
  return `<span class='team'>${logoHtml}<span class='team-name'>${escapeHtml(displayTeamName(name))}</span>${ownerHtml}</span>`;
}

function fixtureSortKey(fixture) {
  return `${fixture?.fixture?.date ?? '9999'}|${String(fixture?.fixture?.id ?? 0).padStart(4, '0')}`;
}

function formatDate(dateString) {
  if (!dateString) return 'TBC';
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    hour12: false,
  }).format(parsed).replace(',', '');
}

function formatTime(dateString) {
  if (!dateString) return 'TBC';
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    hour12: false,
  }).format(parsed);
}

function scoreOrTime(match) {
  const status = match?.fixture?.status?.short;
  if (FINISHED_STATUSES.has(status) || LIVE_STATUSES.has(status)) {
    return `${match?.goals?.home ?? '–'}–${match?.goals?.away ?? '–'}`;
  }
  return formatTime(match?.fixture?.date);
}

function matchClass(match) {
  const short = match?.fixture?.status?.short;
  if (FINISHED_STATUSES.has(short)) return 'done';
  if (LIVE_STATUSES.has(short)) return 'live';
  return 'upcoming';
}


function broadcasterTeamName(teamName) {
  return BROADCASTER_TEAM_ALIASES[teamName] ?? teamName;
}

function broadcasterKey(home, away) {
  return [broadcasterTeamName(home), broadcasterTeamName(away)].sort().join(' vs ');
}

function matchBroadcaster(match) {
  const round = match?.league?.round ?? '';
  if (round === 'Final') return 'BBC One + ITV1';
  if (!round.includes('Group')) return null;
  const home = match?.teams?.home?.name;
  const away = match?.teams?.away?.name;
  if (!home || !away) return null;
  return GROUP_STAGE_BROADCASTERS.get(broadcasterKey(home, away)) ?? null;
}

function renderBroadcasterBadge(match) {
  const broadcaster = matchBroadcaster(match);
  return broadcaster ? `<span class='broadcaster-badge' title='TV broadcaster'>${escapeHtml(broadcaster)}</span>` : '';
}

function renderMatch(match, peopleMap) {
  const fixture = match.fixture ?? {};
  const venue = fixture.venue ?? {};
  const status = fixture.status ?? {};
  const round = match.league?.round ?? '';
  const venueText = [venue.name, venue.city].filter(Boolean).join(', ');
  return `<article class='match ${matchClass(match)}'>
    <div class='match-meta'><span>${escapeHtml(round)}</span><span class='match-meta-right'>${renderBroadcasterBadge(match)}<span>${escapeHtml(status.long ?? status.short ?? '')}</span></span></div>
    <div class='teams-row'>
      ${displayTeam(match.teams?.home, peopleMap)}
      <strong class='score'>${escapeHtml(scoreOrTime(match))}</strong>
      ${displayTeam(match.teams?.away, peopleMap)}
    </div>
    <div class='venue'><span>${escapeHtml(formatDate(fixture.date))}</span><span>${escapeHtml(venueText)}</span></div>
  </article>`;
}

function getStandingsTables(standings) {
  const tables = {};
  const league = Array.isArray(standings) && typeof standings[0] === 'object' ? standings[0].league ?? {} : {};
  for (const table of league.standings ?? []) {
    if (!table?.length) continue;
    tables[table[0].group ?? 'Group stage'] = table;
  }
  return Object.fromEntries(Object.entries(tables).sort(([a], [b]) => a.localeCompare(b)));
}

function buildTeamToGroup(tables) {
  const mapping = {};
  for (const [group, rows] of Object.entries(tables)) {
    for (const row of rows) {
      if (row?.team?.name) mapping[row.team.name] = group;
    }
  }
  return mapping;
}


function rankingValue(row) {
  const all = row?.all ?? {};
  const goals = all.goals ?? {};
  return [
    asInt(row?.points),
    asInt(row?.goalsDiff),
    asInt(goals.for),
  ];
}

function compareRankingRows(a, b) {
  const left = rankingValue(a);
  const right = rankingValue(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return String(a?.team?.name ?? '').localeCompare(String(b?.team?.name ?? ''));
}

function compareGroupTiebreakRows(a, b, tiedTeamNames, fixtures) {
  const leftHeadToHead = headToHeadValue(a, tiedTeamNames, fixtures);
  const rightHeadToHead = headToHeadValue(b, tiedTeamNames, fixtures);
  const left = [
    leftHeadToHead.points,
    leftHeadToHead.goalsFor - leftHeadToHead.goalsAgainst,
    leftHeadToHead.goalsFor,
    asInt(a?.goalsDiff),
    asInt(a?.all?.goals?.for),
  ];
  const right = [
    rightHeadToHead.points,
    rightHeadToHead.goalsFor - rightHeadToHead.goalsAgainst,
    rightHeadToHead.goalsFor,
    asInt(b?.goalsDiff),
    asInt(b?.all?.goals?.for),
  ];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return String(a?.team?.name ?? '').localeCompare(String(b?.team?.name ?? ''));
}

function headToHeadValue(row, tiedTeamNames, fixtures) {
  const teamName = row?.team?.name;
  const stats = { points: 0, goalsFor: 0, goalsAgainst: 0 };
  if (!teamName) return stats;

  for (const fixture of fixtures) {
    if (!FINISHED_STATUSES.has(fixture?.fixture?.status?.short)) continue;
    const home = fixture?.teams?.home?.name;
    const away = fixture?.teams?.away?.name;
    if (!tiedTeamNames.has(home) || !tiedTeamNames.has(away)) continue;
    if (home !== teamName && away !== teamName) continue;

    const goalsFor = home === teamName ? asInt(fixture?.goals?.home) : asInt(fixture?.goals?.away);
    const goalsAgainst = home === teamName ? asInt(fixture?.goals?.away) : asInt(fixture?.goals?.home);
    stats.goalsFor += goalsFor;
    stats.goalsAgainst += goalsAgainst;
    if (goalsFor > goalsAgainst) stats.points += 3;
    if (goalsFor === goalsAgainst) stats.points += 1;
  }

  return stats;
}

function sortGroupRows(rows, fixtures = []) {
  const sortedRows = [...rows].sort((a, b) => {
    const pointsDifference = asInt(b?.points) - asInt(a?.points);
    if (pointsDifference) return pointsDifference;
    return String(a?.team?.name ?? '').localeCompare(String(b?.team?.name ?? ''));
  });
  const orderedRows = [];

  for (let index = 0; index < sortedRows.length;) {
    const points = asInt(sortedRows[index]?.points);
    const tiedRows = [];
    while (index < sortedRows.length && asInt(sortedRows[index]?.points) === points) {
      tiedRows.push(sortedRows[index]);
      index += 1;
    }

    if (tiedRows.length > 1) {
      const tiedTeamNames = new Set(tiedRows.map((row) => row?.team?.name).filter(Boolean));
      tiedRows.sort((a, b) => compareGroupTiebreakRows(a, b, tiedTeamNames, fixtures));
    }

    orderedRows.push(...tiedRows);
  }

  return orderedRows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function sortStandingsTables(standings, fixtures = []) {
  return Object.fromEntries(
    Object.entries(standings).map(([group, rows]) => [group, sortGroupRows(rows, fixtures)]),
  );
}

function groupFixturesFinished(fixtures, group, teamGroups) {
  const groupFixturesForGroup = fixtures.filter((fixture) => {
    const round = fixture.league?.round ?? '';
    if (!round.includes('Group')) return false;
    return teamGroups[fixture.teams?.home?.name] === group || teamGroups[fixture.teams?.away?.name] === group;
  });
  return groupFixturesForGroup.length > 0 && groupFixturesForGroup.every((fixture) => FINISHED_STATUSES.has(fixture.fixture?.status?.short));
}

function findLosingTeam(match) {
  if (!FINISHED_STATUSES.has(match?.fixture?.status?.short)) return null;
  const homeGoals = match?.goals?.home;
  const awayGoals = match?.goals?.away;
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals) || homeGoals === awayGoals) return null;
  return homeGoals < awayGoals ? match?.teams?.home?.name : match?.teams?.away?.name;
}

function getEliminatedTeams(standings, fixtures, teamGroups) {
  const eliminated = new Set();
  const finishedGroupRows = [];

  for (const [group, rows] of Object.entries(standings)) {
    if (!groupFixturesFinished(fixtures, group, teamGroups)) continue;
    const sortedRows = sortGroupRows(rows, fixtures);
    sortedRows.forEach((row, index) => {
      if (index >= 3 && row?.team?.name) eliminated.add(row.team.name);
    });
    const thirdPlaced = sortedRows[2];
    if (thirdPlaced) finishedGroupRows.push(thirdPlaced);
  }

  if (finishedGroupRows.length >= 12) {
    [...finishedGroupRows].sort(compareRankingRows).slice(8).forEach((row) => {
      if (row?.team?.name) eliminated.add(row.team.name);
    });
  }

  fixtures
    .filter((fixture) => !(fixture.league?.round ?? '').includes('Group'))
    .map(findLosingTeam)
    .filter(Boolean)
    .forEach((team) => eliminated.add(team));

  return eliminated;
}

function renderStandings(standings, peopleMap) {
  if (!Object.keys(standings).length) return "<p class='empty'>No group table data available yet.</p>";
  return Object.entries(standings).map(([group, rows]) => {
    const people = rows.map((row) => teamOwner(row.team?.name ?? '', peopleMap)).filter((owner) => owner !== '—');
    const body = rows.map((row) => {
      const all = row.all ?? {};
      const goals = all.goals ?? {};
      return `<tr>
        <td class='rank'>${escapeHtml(row.rank)}</td>
        <td>${displayTeam(row.team, peopleMap, false)}</td>
        <td>${escapeHtml(teamOwner(row.team?.name ?? '', peopleMap))}</td>
        <td>${escapeHtml(all.played ?? 0)}</td>
        <td>${escapeHtml(all.win ?? 0)}</td>
        <td>${escapeHtml(all.draw ?? 0)}</td>
        <td>${escapeHtml(all.lose ?? 0)}</td>
        <td>${escapeHtml(`${goals.for ?? 0}-${goals.against ?? 0}`)}</td>
        <td>${escapeHtml(row.goalsDiff ?? 0)}</td>
        <td><strong>${escapeHtml(row.points ?? 0)}</strong></td>
      </tr>`;
    }).join('');
    return `<article class='group-card' data-people='${escapeHtml([...new Set(people)].join('|'))}'>
      <h3>${escapeHtml(group)}</h3>
      <div class='table-wrap'><table>
        <thead><tr><th>#</th><th>Team</th><th>Person</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF-GA</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </article>`;
  }).join('');
}

function groupFixtures(fixtures, teamGroups) {
  const grouped = {};
  for (const fixture of fixtures) {
    const round = fixture.league?.round ?? '';
    if (!round.includes('Group')) continue;
    const homeGroup = teamGroups[fixture.teams?.home?.name];
    const awayGroup = teamGroups[fixture.teams?.away?.name];
    const group = homeGroup ?? awayGroup ?? round.split(' - ')[0] ?? 'Group stage';
    grouped[group] ??= [];
    grouped[group].push(fixture);
  }
  return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)));
}

function renderFixturesByGroup(fixtures, teamGroups, peopleMap) {
  const grouped = groupFixtures(fixtures, teamGroups);
  if (!Object.keys(grouped).length) return "<p class='empty'>No group fixtures available yet.</p>";
  return Object.entries(grouped).map(([group, matches]) => {
    const cards = matches.sort((a, b) => fixtureSortKey(a).localeCompare(fixtureSortKey(b))).map((match) => renderMatch(match, peopleMap)).join('');
    return `<section class='fixture-group'><h3>${escapeHtml(group)}</h3>${cards}</section>`;
  }).join('');
}

function renderKnockouts(fixtures, rounds, peopleMap) {
  const grouped = {};
  for (const fixture of fixtures) {
    const round = fixture.league?.round ?? '';
    if (round.includes('Group')) continue;
    grouped[round] ??= [];
    grouped[round].push(fixture);
  }
  const orderedRounds = rounds.length ? rounds : Object.keys(grouped);
  if (!orderedRounds.length) return "<p class='empty'>No knockout fixtures available yet.</p>";
  return orderedRounds.map((round) => {
    const cards = (grouped[round] ?? []).sort((a, b) => fixtureSortKey(a).localeCompare(fixtureSortKey(b))).map((match) => renderMatch(match, peopleMap)).join('');
    return `<section class='knockout-round'><h3>${escapeHtml(round)}</h3>${cards}</section>`;
  }).join('');
}

function renderPeople(peopleMap, eliminatedTeams = new Set()) {
  const byPerson = {};
  for (const [team, person] of Object.entries(peopleMap)) {
    byPerson[person] ??= [];
    byPerson[person].push(team);
  }
  return Object.keys(byPerson).sort().map((person) => {
    const sortedTeams = byPerson[person].sort();
    const allTeamsEliminated = sortedTeams.every((team) => eliminatedTeams.has(team));
    const teams = sortedTeams.map((team) => {
      const className = eliminatedTeams.has(team) ? " class='team-eliminated'" : '';
      return `<li${className}>${escapeHtml(team)}</li>`;
    }).join('');
    const teamNames = sortedTeams.join(', ');
    const personClass = allTeamsEliminated ? " class='person-eliminated'" : '';
    return `<article class='person-card' data-person='${escapeHtml(person)}' title='${escapeHtml(teamNames)}' role='button' tabindex='0' aria-pressed='false'><h3${personClass}>${escapeHtml(person)}</h3><ul>${teams}</ul></article>`;
  }).join('');
}

function renderPage(payload, peopleMap) {
  const fixtures = [...(payload.fixtures ?? [])].sort((a, b) => fixtureSortKey(a).localeCompare(fixtureSortKey(b)));
  const standings = sortStandingsTables(getStandingsTables(payload.standings ?? []), fixtures);
  const teamGroups = buildTeamToGroup(standings);
  const finished = fixtures.filter((fixture) => FINISHED_STATUSES.has(fixture.fixture?.status?.short)).length;
  const live = fixtures.filter((fixture) => LIVE_STATUSES.has(fixture.fixture?.status?.short)).length;
  const upcoming = Math.max(fixtures.length - finished - live, 0);
  const eliminatedTeams = getEliminatedTeams(standings, fixtures, teamGroups);
  const generated = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(payload.generatedAt ?? Date.now())).replace(',', '') + ' UTC';

  return `<!doctype html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
  <title>World Cup 2026 Sweepstake</title>
  <link rel='icon' href='favicon.ico' sizes='any'>
  <link rel='icon' href='assets/gastro-world-cup.png' type='image/png'>
  <link rel='stylesheet' href='assets/style.css'>
</head>
<body>
  <header class='hero'>
    <div class='brand-lockup'>
      <img class='brand-mark' src='assets/gastro-world-cup.png' alt='' width='112' height='112'>
      <div>
        <p class='eyebrow'>World Cup 2026 wall chart</p>
        <h1>RDUH Gastro Sweepstake</h1>
        <p class='lead'>Fixtures, results, groups and knockout stages, with each team labelled by its person from the sweepstake sheet.</p>
      </div>
    </div>
    <div class='stats' aria-label='Fixture filters'>
      <button type='button' data-fixture-filter='all' aria-pressed='false'><strong>${fixtures.length}</strong><span>fixtures</span></button>
      <button type='button' data-fixture-filter='done' aria-pressed='false'><strong>${finished}</strong><span>finished</span></button>
      <button type='button' data-fixture-filter='live' aria-pressed='false'><strong>${live}</strong><span>live</span></button>
      <button type='button' data-fixture-filter='upcoming' aria-pressed='false'><strong>${upcoming}</strong><span>upcoming</span></button>
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
      <div class='people-grid'>${renderPeople(peopleMap, eliminatedTeams)}</div>
    </section>

    <section id='groups'>
      <div class='section-heading'><h2>Group tables</h2><p>Top two plus the eight best third-placed teams progress to the Round of 32.</p></div>
      <div class='grid groups-grid'>${renderStandings(standings, peopleMap)}</div>
    </section>

    <section id='group-fixtures'>
      <div class='section-heading'><h2>Group results & fixtures</h2><p>Grouped using the current standings feed where possible.</p></div>
      <div class='fixture-grid'>${renderFixturesByGroup(fixtures, teamGroups, peopleMap)}</div>
    </section>

    <section id='knockouts'>
      <div class='section-heading'><h2>Knockout stages</h2><p>Round of 32 onwards.</p></div>
      <div class='knockout-grid'>${renderKnockouts(fixtures, payload.rounds ?? [], peopleMap)}</div>
    </section>
  </main>

  <footer>
    <p>Last generated ${escapeHtml(generated)} from ${escapeHtml(payload.source ?? 'unknown')}. Data source: worldcup26.ir. Built as static HTML and refreshed by Cloudflare Workers.</p>
  </footer>
  <script src='assets/site.js'></script>
</body>
</html>`;
}

async function refreshSite(kv, peopleMap, options = {}) {
  const games = await apiGet('get/games', 'games');
  const checkedAt = new Date();
  const previousPayload = await kv.get(CACHE_KEYS.payload, 'json');
  const finishedPreviouslyLiveMatches = previousLiveMatchesFinished(games, previousPayload);
  const gameSummary = summarizeGames(games, checkedAt);
  const hasFinishedPreviouslyLiveMatch = finishedPreviouslyLiveMatches.length > 0;
  const shouldUpdate = options.force || shouldUpdateForGames(games, checkedAt) || hasFinishedPreviouslyLiveMatch;
  const reason = options.force
    ? 'Forced refresh.'
    : hasFinishedPreviouslyLiveMatch
      ? 'Previously live match has finished.'
      : 'Match is live or inside its update window.';
  console.log('Refresh decision calculated.', {
    force: Boolean(options.force),
    shouldUpdate,
    gameSummary,
    finishedPreviouslyLiveMatches,
  });
  if (!shouldUpdate) {
    const status = {
      updated: false,
      reason: 'No live match or active match update window.',
      checkedAt: checkedAt.toISOString(),
      gameSummary,
      finishedPreviouslyLiveMatches,
    };
    await kv.put(CACHE_KEYS.status, JSON.stringify(status, null, 2));
    return status;
  }

  const [groups, teams, stadiums] = await Promise.all([
    apiGet('get/groups', 'groups'),
    apiGet('get/teams', 'teams'),
    apiGet('get/stadiums', 'stadiums'),
  ]);
  const payload = {
    fixtures: normalizeFixtures(games, teams, stadiums),
    standings: normalizeStandings(groups, teams),
    rounds: [],
    generatedAt: new Date().toISOString(),
    source: 'worldcup26.ir',
  };
  payload.rounds = [...new Set(payload.fixtures.map((fixture) => fixture.league.round).filter((round) => !round.includes('Group')))];
  const html = renderPage(payload, peopleMap);
  const status = {
    updated: true,
    reason,
    checkedAt: checkedAt.toISOString(),
    generatedAt: payload.generatedAt,
    fixtures: payload.fixtures.length,
    gameSummary,
    finishedPreviouslyLiveMatches,
  };
  await Promise.all([
    kv.put(CACHE_KEYS.html, html),
    kv.put(CACHE_KEYS.payload, JSON.stringify(payload, null, 2)),
    kv.put(CACHE_KEYS.status, JSON.stringify(status, null, 2)),
  ]);
  return status;
}

export {
  CACHE_KEYS,
  apiGet,
  fetchApiPayload,
  refreshSite,
  renderPage,
  shouldUpdateForGames,
  previousLiveMatchesFinished,
  summarizeGames,
};
