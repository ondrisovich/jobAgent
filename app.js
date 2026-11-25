const regions = {
  cz: 'Česko',
  swiss: 'Švýcarsko',
  'de-au': 'Německo a Rakousko',
  eu: 'Ostatní Evropa',
};
const countryNames = new Intl.DisplayNames(['cs'], { type: 'region' });
const number = new Intl.NumberFormat('cs');
const plural = new Intl.PluralRules('cs');
const dateFormat = new Intl.DateTimeFormat('cs', { timeZone: 'Europe/Berlin' });
const jobs = document.querySelector('#jobs');
const status = document.querySelector('#status');
const collections = ['dismissed', 'applied'].map(id => document.getElementById(id));
const saving = new Set();
let listings = [];
let jobStatuses = {};
let lastResponse;
let loaded = false;

function regionFor(code) {
  return { CZ: 'cz', CH: 'swiss', DE: 'de-au', AT: 'de-au' }[code] ?? 'eu';
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function stateFor(url) {
  const saved = jobStatuses[url];
  return typeof saved === 'string' ? { status: saved } : saved ?? {};
}

function cvMatch(job) {
  const description = (job.description ?? '').split(/\n\s*\n\s*(?:shoda s cv|cv match):/i)[0];
  const text = (job.title + ' ' + description).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const has = pattern => pattern.test(text);
  const platforms = [
    /\bwincc\b|citect/,
    /\bsiemens\b|\bs[57](?:-\d+)?\b|\btia\b|pcs\s*7|step\s*7/,
    /schneider|\bm580\b|control expert/,
    /beckhoff|twincat|ethercat/,
    /mitsubishi|opc[\s-]*ua/,
  ].filter(has).length;
  const controls = has(/\b(?:plc|sps|scada|dcs|hmi|mcr|msre?)\b|control systems?|control[- ]commande|controle[- ]commande|ridic[iy]ch? system|leittechnik|prozessleit|automatiz|automatis|automation/);
  const engineering = has(/program|software|vyvoj|develop|konfigur|parametr|integr|architekt|design|navrh|konzept/);
  const delivery = has(/commission|inbetrieb|mise en service|zprovozn|uveden|uvadeni|oziv|\b(?:fat|sat|sit)\b|prejim|diagnos|diagnost|troubleshoot|depann|fehlersuch/);
  const sector = has(/kryogen|cryogen|\b(?:hvac|cvc)\b|chlazen|ventil|process control|procesni|prozess|pharm|farmac|chemick|chemical|energet|energie|energy|instrument/);
  const software = has(/c\+\+|\bpython\b|control\+\+|\bctrl\b|ci\/cd|gitlab|\bwincc oa\b/);
  const level = has(/\b(?:senior|experienced|erfahren|leader|lead)\b|zkusen|mehrjahr|plusieurs annees|experimente|engineering degree/);
  const language = has(/anglictin|english|anglais|francouz|francais|polstin|cestin/);
  const germanRequired = has(/nemcin[^.]{0,28}(?:povinn|vyzad|nutn)|(?:povinn|vyzad|nutn)[^.]{0,28}nemcin|deutschkenntnisse|allemand courant|german (?:is )?(?:mandatory|required)/);
  const graduateOnly = has(/graduate only|phd are not eligible|absolventsky program|pouze pro absolventy/);
  const points = 12 + (controls ? 21 : 0) + Math.min(platforms * 8, 24)
    + (engineering ? 11 : 0) + (delivery ? 13 : 0) + (sector ? 9 : 0)
    + (software ? 9 : 0) + (level ? 7 : 0) + (language ? 4 : 0)
    - (germanRequired ? 14 : 0) - (graduateOnly ? 30 : 0);
  return Math.max(0, Math.min(100, points));
}

function card(job, expanded, archived = false) {
  const item = element('article', 'job-card');
  const details = element('details', 'job-details');
  details.dataset.url = job.url;
  details.open = expanded.has(job.url);
  const summary = element('summary');
  const content = element('span');
  const meta = element('span', 'meta');
  const savedDate = job.savedAt ? new Date(job.savedAt) : null;
  const match = cvMatch(job);
  const matchBand = match > 80 ? 'high' : match >= 60 ? 'medium' : 'low';
  const matchLabel = element('span', 'cv-match ' + matchBand, 'Shoda s CV: ' + match + ' %');
  matchLabel.title = 'Orientační skóre podle technologií, náplně práce a požadavků v inzerátu';
  meta.append(
    element('span', '', [job.city, countryNames.of(job.country)].filter(Boolean).join(', ')),
    element('span', '', job.salary ? 'Plat: ' + job.salary : 'Plat: neuveden'),
    element('span', '', 'Remote: ' + ({ yes: 'Ano', no: 'Ne', na: 'N/A' }[job.remote] ?? 'N/A')),
    element('span', '', 'Uloženo: ' + (savedDate && Number.isFinite(savedDate.getTime()) ? dateFormat.format(savedDate) : 'N/A')),
    matchLabel,
  );
  const title = element('span', 'title', job.title);
  if (archived) meta.append(element('span', '', 'Inzerát již není v aktivních nabídkách'));
  content.append(title, meta);
  const toggle = element('span', 'toggle');
  toggle.setAttribute('aria-hidden', 'true');
  summary.append(content, toggle);
  const detail = element('div', 'detail');
  detail.append(element('p', '', job.description));
  const source = new URL(job.url);
  if (['https:', 'http:'].includes(source.protocol)) {
    const link = element('a', '', 'Otevřít původní inzerát');
    link.href = source.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    detail.append(link);
  }
  const actions = element('div', 'actions');
  const saved = stateFor(job.url);
  const controls = [
    ['favorite', '♡', '♥', 'Uložit nabídku', 'Odebrat z uložených', Boolean(saved.favorite)],
    ['dismissed', '×', '×', 'Přesunout do Not interesting', 'Vrátit z Not interesting', saved.status === 'dismissed'],
    ['applied', '✓', '✓', 'Poslal jsem žádost', 'Vrátit z Applied', saved.status === 'applied'],
  ];
  for (const [action, icon, activeIcon, label, undoLabel, active] of controls) {
    const button = element('button', 'job-action ' + action, active ? activeIcon : icon);
    button.type = 'button';
    button.dataset.action = action;
    button.title = active ? undoLabel : label;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = saving.has(job.url);
    button.addEventListener('click', () => saveStatus(action, active));
    actions.append(button);
  }

  async function saveStatus(action, active) {
    if (saving.has(job.url)) return;
    saving.add(job.url);
    for (const button of actions.children) button.disabled = true;
    const change = action === 'favorite' ? { favorite: !active } : { status: active ? null : action };
    try {
      const response = await fetch('./api/job-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: job.url, ...change }),
      });
      if (!response.ok) throw new Error();
      jobStatuses[job.url] = await response.json();
      saving.delete(job.url);
      render();
      const current = [...document.querySelectorAll('.job-details')].find(node => node.dataset.url === job.url);
      const collection = current?.closest('.collection');
      const focusTarget = collection && !collection.open
        ? collection.querySelector('summary')
        : current?.parentElement.querySelector('button[data-action="' + action + '"]');
      focusTarget?.focus({ preventScroll: true });
    } catch {
      status.textContent = 'Změnu se nepodařilo uložit. Zkus to znovu.';
    } finally {
      saving.delete(job.url);
      for (const button of actions.children) button.disabled = false;
    }
  }

  details.append(summary, detail);
  item.append(details, actions);
  return item;
}

function render() {
  const hash = location.hash.slice(1);
  const region = Object.hasOwn(regions, hash) ? hash : 'cz';
  document.querySelector('#region').textContent = regions[region];
  for (const link of document.querySelectorAll('nav a')) {
    if (link.hash === '#' + region) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (!loaded) return;
  const regional = listings.filter(job => regionFor(job.country) === region).reverse();
  const activeUrls = new Set(regional.map(job => job.url));
  const archived = Object.values(jobStatuses)
    .filter(saved => saved?.status && saved.job && regionFor(saved.job.country) === region && !activeUrls.has(saved.job.url))
    .map(saved => saved.job);
  const matches = regional.filter(job => !stateFor(job.url).status);
  const count = matches.length;
  const noun = { one: 'nabídka', few: 'nabídky', other: 'nabídek' }[plural.select(count)];
  document.querySelector('#count').textContent = number.format(count) + ' ' + noun;
  const expanded = new Set([...document.querySelectorAll('.job-details[open]')].map(item => item.dataset.url));
  if (count) jobs.replaceChildren(...matches.map(job => card(job, expanded)));
  else {
    const empty = element('div', 'empty');
    empty.append(
      element('strong', '', 'Zatím žádné nabídky'),
      element('p', '', 'Nové inzeráty se tu objeví po importu v tomto regionu.'),
    );
    jobs.replaceChildren(empty);
  }
  for (const collection of collections) {
    const entries = [...regional, ...archived].filter(job => stateFor(job.url).status === collection.id);
    collection.querySelector('.collection-count').textContent = number.format(entries.length);
    collection.querySelector('.job-list').replaceChildren(...(entries.length
      ? entries.map(job => card(job, expanded, !activeUrls.has(job.url)))
      : [element('p', 'collection-empty', 'Zatím žádné nabídky')]));
  }
}

async function refresh() {
  try {
    const response = await fetch('./jobs.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Nelze načíst nabídky');
    const body = await response.text();
    if (body !== lastResponse) {
      const data = JSON.parse(body);
      if (!Array.isArray(data)) throw new Error('Neplatný formát nabídek');
      listings = data;
      loaded = true;
      render();
      lastResponse = body;
    }
    status.textContent = '';
  } catch {
    status.textContent = 'Nabídky se nepodařilo načíst. Stránka to zkusí znovu.';
  }
}

window.addEventListener('hashchange', render);
render();
status.textContent = 'Načítám nabídky…';
try {
  const response = await fetch('./api/job-status', { cache: 'no-store' });
  if (!response.ok) throw new Error();
  jobStatuses = await response.json();
} catch {
  console.warn('Uložené stavy nabídek se nepodařilo načíst.');
}
await refresh();
setInterval(refresh, 15_000);
