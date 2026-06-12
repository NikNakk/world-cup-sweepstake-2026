const matches = document.querySelectorAll('.match.live');
if (matches.length) {
  document.title = `LIVE: ${document.title}`;
}

const personCards = [...document.querySelectorAll('.person-card[data-person]')];
const matchCards = [...document.querySelectorAll('.match')];
const groupCards = [...document.querySelectorAll('.group-card[data-people]')];
let selectedPerson = null;

function matchFeaturesPerson(match, person) {
  return [...match.querySelectorAll('.owner')].some((owner) => owner.textContent.trim() === person);
}

function groupFeaturesPerson(group, person) {
  return group.dataset.people.split('|').includes(person);
}

function setSelectedPerson(person) {
  selectedPerson = selectedPerson === person ? null : person;
  document.body.classList.toggle('person-filter-active', Boolean(selectedPerson));

  personCards.forEach((card) => {
    const isSelected = card.dataset.person === selectedPerson;
    card.classList.toggle('is-selected', isSelected);
    card.classList.toggle('is-dimmed', Boolean(selectedPerson) && !isSelected);
    card.setAttribute('aria-pressed', String(isSelected));
  });

  matchCards.forEach((match) => {
    match.classList.toggle(
      'is-dimmed',
      Boolean(selectedPerson) && !matchFeaturesPerson(match, selectedPerson),
    );
  });

  groupCards.forEach((group) => {
    group.classList.toggle(
      'is-dimmed',
      Boolean(selectedPerson) && !groupFeaturesPerson(group, selectedPerson),
    );
  });
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
