import { PEOPLE_MAP } from './people-map.js';
import { renderPage } from './worldcup-renderer.js';

const DEFAULT_API_STATE_URL = '/api/state';
const POLL_INTERVAL_MS = 60 * 1000;
let selectedPerson = null;
let selectedFixtureFilter = null;
let isLoadingState = false;
let apiStateUrlPromise = null;

function showError(message) {
  const status = document.querySelector('[data-load-status]');
  if (status) {
    status.textContent = message;
    status.classList.add('load-error');
  }
}

function replaceDocumentWithRenderedPage(payload) {
  const rendered = new DOMParser().parseFromString(renderPage(payload, PEOPLE_MAP), 'text/html');
  rendered.body.querySelectorAll('script').forEach((script) => script.remove());
  document.title = rendered.title;
  document.body.replaceChildren(...rendered.body.childNodes);
}

function initializeFilters() {
  const matches = document.querySelectorAll('.match.live');
  if (matches.length) {
    document.title = `LIVE: ${document.title}`;
  }

  const personCards = [...document.querySelectorAll('.person-card[data-person]')];
  const matchCards = [...document.querySelectorAll('.match')];
  const groupCards = [...document.querySelectorAll('.group-card[data-people]')];
  const fixtureFilterButtons = [...document.querySelectorAll('[data-fixture-filter]')];
  const fixtureSections = [...document.querySelectorAll('.fixture-group, .knockout-round')];
  const groupsSection = document.querySelector('#groups');

  function matchFeaturesPerson(match, person) {
    return [...match.querySelectorAll('.owner')].some((owner) => owner.textContent.trim() === person);
  }

  function groupFeaturesPerson(group, person) {
    return group.dataset.people.split('|').includes(person);
  }

  function matchPassesFixtureFilter(match) {
    if (!selectedFixtureFilter || selectedFixtureFilter === 'all') {
      return true;
    }
    return match.classList.contains(selectedFixtureFilter);
  }

  function matchPassesPersonFilter(match) {
    return !selectedPerson || matchFeaturesPerson(match, selectedPerson);
  }

  function sectionHasVisibleMatches(section) {
    return [...section.querySelectorAll('.match')].some((match) => !match.hidden);
  }

  function filtersAreActive() {
    return Boolean(selectedFixtureFilter || selectedPerson);
  }

  function updatePersonCards() {
    personCards.forEach((card) => {
      const isSelected = card.dataset.person === selectedPerson;
      card.classList.toggle('is-selected', isSelected);
      card.classList.toggle('is-dimmed', Boolean(selectedPerson) && !isSelected);
      card.setAttribute('aria-pressed', String(isSelected));
    });
  }

  function updateFilteredContent() {
    document.body.classList.toggle('person-filter-active', Boolean(selectedPerson));
    document.body.classList.toggle('fixture-filter-active', Boolean(selectedFixtureFilter));

    updatePersonCards();

    matchCards.forEach((match) => {
      match.hidden = !matchPassesFixtureFilter(match) || !matchPassesPersonFilter(match);
    });

    fixtureSections.forEach((section) => {
      section.hidden = filtersAreActive() && !sectionHasVisibleMatches(section);
    });

    if (groupsSection) {
      groupsSection.hidden = Boolean(selectedFixtureFilter);
    }

    groupCards.forEach((group) => {
      group.hidden = Boolean(selectedPerson) && !groupFeaturesPerson(group, selectedPerson);
    });
  }

  function setSelectedPerson(person) {
    selectedPerson = selectedPerson === person ? null : person;
    updateFilteredContent();
  }

  function setSelectedFixtureFilter(filter) {
    selectedFixtureFilter = filter === 'all' || selectedFixtureFilter === filter ? null : filter;

    fixtureFilterButtons.forEach((button) => {
      const isSelected = button.dataset.fixtureFilter === selectedFixtureFilter;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });

    updateFilteredContent();
  }

  personCards.forEach((card) => {
    card.addEventListener('click', () => {
      setSelectedPerson(card.dataset.person);
    });

    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      setSelectedPerson(card.dataset.person);
    });
  });

  fixtureFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setSelectedFixtureFilter(button.dataset.fixtureFilter);
    });
  });

  fixtureFilterButtons.forEach((button) => {
    const isSelected = button.dataset.fixtureFilter === selectedFixtureFilter;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
  updateFilteredContent();
}

async function loadState() {
  if (isLoadingState) return;
  isLoadingState = true;
  const apiStateUrl = await getApiStateUrl();
  const response = await fetch(apiStateUrl, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`The sweepstake API returned HTTP ${response.status}.`);
  }

  const state = await response.json();
  if (!state.payload) {
    throw new Error(state.error ?? 'The sweepstake API did not return a payload.');
  }

  replaceDocumentWithRenderedPage(state.payload);
  initializeFilters();
  isLoadingState = false;
}

async function getApiStateUrl() {
  apiStateUrlPromise ??= fetch('api-config.json', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
    .then((response) => (response.ok ? response.json() : {}))
    .then((config) => config.stateUrl || DEFAULT_API_STATE_URL)
    .catch(() => DEFAULT_API_STATE_URL);
  return apiStateUrlPromise;
}

if (typeof document !== 'undefined') {
  loadState().catch((error) => {
    isLoadingState = false;
    console.error(error);
    showError('Live sweepstake data is temporarily unavailable.');
  });
  setInterval(() => {
    loadState().catch((error) => {
      isLoadingState = false;
      console.error(error);
    });
  }, POLL_INTERVAL_MS);
}
