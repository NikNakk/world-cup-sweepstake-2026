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
let selectedPerson = null;
let selectedFixtureFilter = null;

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
  selectedFixtureFilter = selectedFixtureFilter === filter ? null : filter;

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
