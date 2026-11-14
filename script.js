let config = null;
let icons = {};
let languages = [];
let langData = null;
let langCode = null;
let currentIdx = 0;
let scoreHistory = [];
let userSex = null;
let finished = false;

const DEFAULT_LANG = "en";
const FALLBACK_TITLE = "Diabetes Risk Assessment Quiz";
const langCache = {};
let switchId = 0;

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function getLang(code) {
  if (!langCache[code]) langCache[code] = await getJSON(`lang/${code}.json`);
  return langCache[code];
}

function pickInitialLang() {
  const codes = languages.map((l) => l.code);
  const saved = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/)?.[1];
  if (saved && codes.includes(saved)) return saved;
  const htmlLang = document.documentElement.lang;
  if (codes.includes(htmlLang)) return htmlLang;
  return codes.includes(DEFAULT_LANG) ? DEFAULT_LANG : codes[0];
}

function buildLangSelect() {
  const select = document.getElementById("lang-select");
  select.innerHTML = "";
  languages.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.code;
    opt.lang = l.code;
    opt.textContent = l.name;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => switchLanguage(select.value));
}

function applyLanguage(code, data) {
  langCode = code;
  langData = data;

  const meta = languages.find((l) => l.code === code);
  document.documentElement.lang = code;
  document.documentElement.dir = meta?.dir ?? "ltr";

  document.title = data.metaTitle || data.appName || FALLBACK_TITLE;
  const desc = data.metaDescription || data.appDescription;
  if (desc) document.getElementById("meta-desc")?.setAttribute("content", desc);

  const select = document.getElementById("lang-select");
  select.value = code;
  select.setAttribute("aria-label", data.langLabel || "Language");
}

async function switchLanguage(code) {
  if (code === langCode) return;
  const id = ++switchId;

  let data;
  try {
    data = await getLang(code);
  } catch (e) {
    console.error(e);
    alert(langData?.loadError || "Could not load language file.");
    document.getElementById("lang-select").value = langCode;
    return;
  }
  if (id !== switchId) return;

  applyLanguage(code, data);

  document.cookie = `lang=${code}; path=/; max-age=31536000; SameSite=Lax`;

  rerender();
}

function rerender() {
  if (finished) {
    showFinal();
    return;
  }
  const h = document.getElementById("h-input")?.value;
  const w = document.getElementById("w-input")?.value;

  loadStep({ quiet: true });

  if (h) document.getElementById("h-input").value = h;
  if (w) document.getElementById("w-input").value = w;
}

async function init() {
  try {
    [config, icons, languages] = await Promise.all([
      getJSON("config.json"),
      getJSON("icons.json"),
      getJSON("languages.json"),
    ]);
  } catch (e) {
    console.error(e);
    return;
  }

  buildLangSelect();

  let code = pickInitialLang();
  let data;
  try {
    data = await getLang(code);
  } catch (e) {
    console.error(e);
    code = languages[0].code;
    try {
      data = await getLang(code);
    } catch (e2) {
      console.error(e2);
      return;
    }
  }

  applyLanguage(code, data);
  loadStep();
}

function iconFor(key) {
  const d = icons[key];
  return d ? `<svg viewBox="0 -960 960 960"><path d="${d}"/></svg>` : "";
}

function shouldSkip(question) {
  const rule = config.skip?.[question.key];
  return Boolean(rule) && rule === userSex;
}

function loadStep({ quiet = false } = {}) {
  const content = document.getElementById("content-area");
  if (!quiet) {
    content.classList.remove("fade-in");
    void content.offsetWidth;
    content.classList.add("fade-in");
  }

  const data = langData.questions[currentIdx];

  if (shouldSkip(data)) {
    scoreHistory.push(0);
    currentIdx++;
    loadStep({ quiet });
    return;
  }

  let innerHTML = `<div class="icon-wrapper" aria-hidden="true">${iconFor(data.key)}</div>
    <h2 id="step-title" tabindex="-1">${data.q}</h2>`;

  if (data.isBMI) {
    innerHTML += `<div class="button-group">
  <input type="number" id="h-input" class="input-field" placeholder="${langData.hPlace}" aria-label="${langData.hPlace}">
  <input type="number" id="w-input" class="input-field" placeholder="${langData.wPlace}" aria-label="${langData.wPlace}">
  <button onclick="handleBMIScore()" style="background:var(--primary); color:white; border:none;">${langData.continue}</button>
</div>`;
  } else {
    innerHTML += `<div class="button-group">`;
    data.a.forEach((ans) => {
      const clickAction =
        data.key === "sex"
          ? `handleSexClick('${ans.id}', ${ans.s})`
          : `next(${ans.s})`;
      innerHTML += `<button onclick="${clickAction}">${ans.t}</button>`;
    });
    innerHTML += `</div>`;
  }

  innerHTML +=
    currentIdx > 0
      ? `<button class="back-btn" onclick="goBack()">${langData.back}</button>`
      : "";
  content.innerHTML = innerHTML;

  const progress = (currentIdx / langData.questions.length) * 100;
  const progressBar = document.getElementById("progress");
  progressBar.style.width = progress + "%";
  progressBar.setAttribute("aria-valuenow", Math.round(progress));

  if (!quiet) document.getElementById("step-title").focus();
}

function handleSexClick(id, score) {
  userSex = id;
  next(score);
}

function handleBMIScore() {
  const h = document.getElementById("h-input").value / 100;
  const w = document.getElementById("w-input").value;

  if (!h || !w || h <= 0 || w <= 0 || h > 3 || w > 500) {
    showError(langData.error);
    return;
  }

  const bmi = w / (h * h);
  const rule = config.bmi.find((r) => bmi >= r.min);
  next(rule ? rule.score : 0);
}

function showError(message) {
  let existingError = document.querySelector(".error-msg");
  if (!existingError) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "error-msg";
    const container = document.querySelector(".button-group");
    container.parentNode.insertBefore(errorDiv, container);
    existingError = errorDiv;
  }
  existingError.textContent = message;
}

function next(s) {
  scoreHistory.push(s);
  currentIdx++;
  if (currentIdx < langData.questions.length) {
    loadStep();
  } else {
    showFinal();
  }
}

function goBack() {
  scoreHistory.pop();
  currentIdx--;
  while (currentIdx > 0 && shouldSkip(langData.questions[currentIdx])) {
    scoreHistory.pop();
    currentIdx--;
  }
  loadStep();
}

function showFinal() {
  finished = true;
  document.getElementById("progress").style.width = "100%";
  const totalScore = scoreHistory.reduce((a, b) => a + b, 0);
  const level = config.levels.find((l) => totalScore >= l.min);
  const status = langData.levels[level.index];

  document.getElementById("content-area").innerHTML = `<div class="fade-in">
  <h2>${langData.resTitle}: ${totalScore}</h2>
  <div class="result-val ${level.css}">${status}</div>
  <p style="line-height:1.6; color:var(--muted-text);">${langData.resMsg}</p>
  <button onclick="location.reload()" style="margin-top:25px; background:var(--primary); color:white; border:none; width:100%">${langData.retry}</button>
</div>`;
}

init();
