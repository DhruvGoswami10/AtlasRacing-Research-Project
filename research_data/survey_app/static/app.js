const TLX_FIELDS = [
  {
    id: "mentalDemand",
    label: "Mental Demand",
    prompt: "How mentally demanding was the race?",
    left: "Very low",
    right: "Very high",
  },
  {
    id: "physicalDemand",
    label: "Physical Demand",
    prompt: "How physically demanding was the race?",
    left: "Very low",
    right: "Very high",
  },
  {
    id: "temporalDemand",
    label: "Temporal Demand",
    prompt: "How rushed or time-pressured did the race feel?",
    left: "Very low",
    right: "Very high",
  },
  {
    id: "performance",
    label: "Performance",
    prompt: "How unsuccessful did you feel your performance was?",
    left: "Perfect",
    right: "Failure",
  },
  {
    id: "effort",
    label: "Effort",
    prompt: "How hard did you have to work to achieve your level of performance?",
    left: "Very low",
    right: "Very high",
  },
  {
    id: "frustration",
    label: "Frustration",
    prompt: "How insecure, discouraged, irritated, stressed, or annoyed were you?",
    left: "Very low",
    right: "Very high",
  },
];

const state = {
  races: [],
  selectedRaceId: null,
  selectedRace: null,
  touched: new Set(),
};

const phaseFilter = document.querySelector("#phaseFilter");
const participantFilter = document.querySelector("#participantFilter");
const conditionFilter = document.querySelector("#conditionFilter");
const statusFilter = document.querySelector("#statusFilter");
const searchInput = document.querySelector("#searchInput");
const raceList = document.querySelector("#raceList");
const statsGrid = document.querySelector("#statsGrid");
const emptyState = document.querySelector("#emptyState");
const detailContent = document.querySelector("#detailContent");
const detailPhase = document.querySelector("#detailPhase");
const detailTitle = document.querySelector("#detailTitle");
const detailSubtitle = document.querySelector("#detailSubtitle");
const detailCode = document.querySelector("#detailCode");
const detailStatus = document.querySelector("#detailStatus");
const detailTrack = document.querySelector("#detailTrack");
const detailDate = document.querySelector("#detailDate");
const detailStart = document.querySelector("#detailStart");
const detailFinish = document.querySelector("#detailFinish");
const detailPoints = document.querySelector("#detailPoints");
const detailLaps = document.querySelector("#detailLaps");
const detailHeadline = document.querySelector("#detailHeadline");
const detailRecapCards = document.querySelector("#detailRecapCards");
const detailKeyMoments = document.querySelector("#detailKeyMoments");
const detailTimeline = document.querySelector("#detailTimeline");
const detailNotes = document.querySelector("#detailNotes");
const tlxFields = document.querySelector("#tlxFields");
const rawTlxValue = document.querySelector("#rawTlxValue");
const trustScale = document.querySelector("#trustScale");
const trustHelp = document.querySelector("#trustHelp");
const recallScale = document.querySelector("#recallScale");
const commentInput = document.querySelector("#commentInput");
const surveyForm = document.querySelector("#surveyForm");
const saveButton = document.querySelector("#saveButton");
const saveStatus = document.querySelector("#saveStatus");

init();

async function init() {
  buildTlxFields();
  buildScaleOptions(trustScale, "trustInAIRaceEngineer", 7, "trust");
  buildScaleOptions(recallScale, "recallConfidence", 7, "recall");

  await loadRaces();
  bindFilters();
}

function buildTlxFields() {
  tlxFields.innerHTML = "";
  TLX_FIELDS.forEach((field) => {
    const wrapper = document.createElement("label");
    wrapper.className = "tlx-card";
    wrapper.innerHTML = `
      <div class="tlx-header">
        <div>
          <strong>${field.label}</strong>
          <p>${field.prompt}</p>
        </div>
        <output id="${field.id}Value">50</output>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value="50"
        id="${field.id}"
        data-field="${field.id}"
      />
      <div class="range-ends">
        <span>${field.left}</span>
        <span>${field.right}</span>
      </div>
    `;
    const input = wrapper.querySelector("input");
    const output = wrapper.querySelector("output");
    input.addEventListener("input", () => {
      output.textContent = input.value;
      state.touched.add(field.id);
      updateRawTlx();
      updateSaveState();
    });
    tlxFields.appendChild(wrapper);
  });
}

function buildScaleOptions(container, fieldName, maxValue, touchKey) {
  container.innerHTML = "";
  for (let value = 1; value <= maxValue; value += 1) {
    const label = document.createElement("label");
    label.className = "scale-option";
    label.innerHTML = `
      <input type="radio" name="${fieldName}" value="${value}" />
      <span>${value}</span>
    `;
    const input = label.querySelector("input");
    input.addEventListener("change", () => {
      state.touched.add(touchKey);
      updateSaveState();
    });
    container.appendChild(label);
  }
}

async function loadRaces() {
  const response = await fetch("/api/races");
  const payload = await response.json();
  state.races = payload.races;
  hydrateFilters();
  renderStats();
  renderRaceList();
}

function bindFilters() {
  [phaseFilter, participantFilter, conditionFilter, statusFilter].forEach((element) =>
    element.addEventListener("change", () => renderRaceList())
  );
  searchInput.addEventListener("input", () => renderRaceList());
  surveyForm.addEventListener("submit", saveSurvey);
}

function hydrateFilters() {
  const phases = ["all", ...new Set(state.races.map((race) => race.phase))];
  const participants = ["all", ...new Set(state.races.map((race) => race.participantId))];

  phaseFilter.innerHTML = phases
    .map((value) => `<option value="${value}">${value === "all" ? "All" : value}</option>`)
    .join("");
  participantFilter.innerHTML = participants
    .map((value) => `<option value="${value}">${value === "all" ? "All" : value}</option>`)
    .join("");
}

function renderStats() {
  const total = state.races.length;
  const completed = state.races.filter((race) => race.hasSurvey).length;
  const pending = total - completed;
  const llm = state.races.filter((race) => race.condition === "llm").length;
  const control = total - llm;

  const cards = [
    ["Total races", total],
    ["Completed", completed],
    ["Pending", pending],
    ["AI-assisted races", llm],
    ["Control races", control],
  ];

  statsGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `
    )
    .join("");
}

function getFilteredRaces() {
  const phaseValue = phaseFilter.value || "all";
  const participantValue = participantFilter.value || "all";
  const conditionValue = conditionFilter.value || "all";
  const statusValue = statusFilter.value || "all";
  const searchValue = (searchInput.value || "").trim().toLowerCase();

  return state.races.filter((race) => {
    const matchesPhase = phaseValue === "all" || race.phase === phaseValue;
    const matchesParticipant =
      participantValue === "all" || race.participantId === participantValue;
    const matchesCondition = conditionValue === "all" || race.condition === conditionValue;
    const matchesStatus =
      statusValue === "all" ||
      (statusValue === "completed" ? race.hasSurvey : !race.hasSurvey);
    const haystack = `${race.raceId} ${race.track} ${race.participantId}`.toLowerCase();
    const matchesSearch = !searchValue || haystack.includes(searchValue);
    return (
      matchesPhase &&
      matchesParticipant &&
      matchesCondition &&
      matchesStatus &&
      matchesSearch
    );
  });
}

function renderRaceList() {
  const races = getFilteredRaces();

  if (!races.length) {
    raceList.innerHTML = `<div class="list-empty">No races match the current filters.</div>`;
    selectRace(null);
    return;
  }

  raceList.innerHTML = races
    .map((race) => {
      const active = race.raceId === state.selectedRaceId ? "active" : "";
      const status = race.hasSurvey ? "completed" : "pending";
      return `
        <button class="race-item ${active}" data-race-id="${race.raceId}">
          <div class="race-item-top">
            <strong>${race.participantId}</strong>
            <span class="badge ${race.condition}">${race.condition === "llm" ? "AI" : "Control"}</span>
          </div>
          <div class="race-item-meta">${race.track} · R${race.raceNumber} · ${race.phase}</div>
          <div class="race-item-bottom">
            <span>${race.startingPosition} → ${race.finishPosition}</span>
            <span class="status ${status}">${status}</span>
          </div>
        </button>
      `;
    })
    .join("");

  raceList.querySelectorAll(".race-item").forEach((button) => {
    button.addEventListener("click", () => selectRace(button.dataset.raceId));
  });

  if (!state.selectedRaceId || !races.some((race) => race.raceId === state.selectedRaceId)) {
    selectRace(races[0].raceId);
  }
}

async function selectRace(raceId) {
  if (!raceId) {
    state.selectedRaceId = null;
    state.selectedRace = null;
    emptyState.hidden = false;
    detailContent.hidden = true;
    return;
  }

  state.selectedRaceId = raceId;
  raceList.querySelectorAll(".race-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.raceId === raceId);
  });

  const response = await fetch(`/api/races/${encodeURIComponent(raceId)}`);
  state.selectedRace = await response.json();
  state.touched = new Set();

  renderDetail();
}

function renderDetail() {
  const race = state.selectedRace;
  emptyState.hidden = true;
  detailContent.hidden = false;
  const lapProgress = race.lapProgress || buildLapProgress(race);
  const didFinish =
    typeof race.didFinish === "boolean"
      ? race.didFinish
      : inferDidFinish(race, lapProgress);

  detailPhase.textContent = `${race.phase} · ${race.participantId}`;
  detailTitle.textContent = `Race ${race.raceNumber} · ${race.track}`;
  detailSubtitle.textContent = `${race.condition === "llm" ? "AI-assisted run" : "Control run"} · survey ${
    race.hasSurvey ? "already submitted" : "pending"
  }`;
  detailCode.textContent = race.raceId;
  detailStatus.textContent = race.hasSurvey ? "Completed" : "Pending";
  detailStatus.className = `status-pill ${race.hasSurvey ? "completed" : "pending"}`;

  detailTrack.textContent = race.track;
  detailDate.textContent = formatDate(race.date);
  detailStart.textContent = `P${race.startingPosition}`;
  detailFinish.textContent = `P${race.finishPosition}`;
  detailPoints.textContent = race.points;
  detailLaps.textContent = didFinish
    ? `${lapProgress} (finished)`
    : `${lapProgress} (DNF)`;
  detailHeadline.textContent = race.recap?.headline || "Race recap unavailable.";
  detailRecapCards.innerHTML = (race.recap?.cards || [])
    .map(
      (card) => `
        <article class="recap-card">
          <span>${card.label}</span>
          <strong>${card.value}</strong>
        </article>
      `
    )
    .join("");
  detailKeyMoments.innerHTML = renderListItems(
    race.recap?.keyMoments || ["No key moments available for this race."]
  );
  detailTimeline.innerHTML = renderListItems(
    race.recap?.strategyTimeline || ["No timeline events available for this race."]
  );
  detailNotes.textContent = race.notes || "No archived note on file.";

  const survey = race.survey;
  TLX_FIELDS.forEach((field) => {
    const input = document.querySelector(`#${field.id}`);
    const output = document.querySelector(`#${field.id}Value`);
    const value = survey?.nasaTlx?.[field.id] ?? 50;
    input.value = value;
    output.textContent = value;
    if (survey) {
      state.touched.add(field.id);
    }
  });

  setScaleSelection(trustScale, "trustInAIRaceEngineer", survey?.trust?.trustInAIRaceEngineer);
  setScaleSelection(recallScale, "recallConfidence", survey?.responseQuality?.recallConfidence);
  commentInput.value = survey?.openText?.comment ?? "";

  if (race.condition === "llm") {
    trustScale.classList.remove("disabled");
    trustScale.querySelectorAll("input").forEach((input) => {
      input.disabled = false;
    });
    trustHelp.textContent = "Rate how much you trusted the AI race engineer's advice in this race.";
    if (survey?.trust?.trustInAIRaceEngineer) {
      state.touched.add("trust");
    }
  } else {
    trustScale.classList.add("disabled");
    trustScale.querySelectorAll("input").forEach((input) => {
      input.checked = false;
      input.disabled = true;
    });
    trustHelp.textContent = "Not applicable for control races because no AI race engineer was present.";
    state.touched.add("trust");
  }

  if (survey?.responseQuality?.recallConfidence) {
    state.touched.add("recall");
  }

  saveStatus.textContent = survey ? `Last saved ${formatDateTime(survey.submittedAt)}` : "";
  updateRawTlx();
  updateSaveState();
}

function setScaleSelection(container, name, value) {
  container.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = Number(input.value) === Number(value);
  });
}

function updateRawTlx() {
  const values = TLX_FIELDS.map((field) => Number(document.querySelector(`#${field.id}`).value));
  const average = values.reduce((sum, current) => sum + current, 0) / values.length;
  rawTlxValue.textContent = average.toFixed(1);
}

function updateSaveState() {
  const race = state.selectedRace;
  if (!race) {
    saveButton.disabled = true;
    return;
  }

  const required = new Set(TLX_FIELDS.map((field) => field.id));
  required.add("recall");
  required.add("trust");

  const allTouched = [...required].every((field) => state.touched.has(field));
  saveButton.disabled = !allTouched;
}

function renderListItems(items) {
  return items.map((item) => `<li>${item}</li>`).join("");
}

function buildLapProgress(race) {
  const completed =
    Number.isFinite(Number(race.completedLaps)) && Number(race.completedLaps) > 0
      ? Number(race.completedLaps)
      : Number(race.totalLaps);
  const total = Number(race.totalLaps);
  if (!Number.isFinite(total) || total <= 0) {
    return "Unavailable";
  }
  return `${completed} / ${total}`;
}

function inferDidFinish(race, lapProgress) {
  if (typeof race.finishPosition === "number" && race.finishPosition === 20) {
    const note = String(race.notes || "").toLowerCase();
    if (note.includes("dnf")) {
      return false;
    }
  }
  if (typeof lapProgress === "string" && lapProgress.includes("/")) {
    const [completedText, totalText] = lapProgress.split("/").map((part) => Number(part.trim()));
    if (Number.isFinite(completedText) && Number.isFinite(totalText)) {
      return completedText >= totalText;
    }
  }
  return true;
}

async function saveSurvey(event) {
  event.preventDefault();
  if (!state.selectedRace) {
    return;
  }

  const race = state.selectedRace;
  const payload = {
    nasaTlx: Object.fromEntries(
      TLX_FIELDS.map((field) => [field.id, Number(document.querySelector(`#${field.id}`).value)])
    ),
    trust: {
      trustInAIRaceEngineer:
        race.condition === "llm"
          ? Number(
              trustScale.querySelector('input[name="trustInAIRaceEngineer"]:checked')?.value || 0
            )
          : null,
    },
    responseQuality: {
      recallConfidence: Number(
        recallScale.querySelector('input[name="recallConfidence"]:checked')?.value || 0
      ),
    },
    openText: {
      comment: commentInput.value.trim(),
    },
  };

  saveStatus.textContent = "Saving...";
  const response = await fetch(`/api/races/${encodeURIComponent(race.raceId)}/survey`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();

  if (!response.ok) {
    saveStatus.textContent = result.error || "Save failed.";
    return;
  }

  const raceIndex = state.races.findIndex((item) => item.raceId === race.raceId);
  if (raceIndex >= 0) {
    state.races[raceIndex] = {
      ...state.races[raceIndex],
      hasSurvey: true,
      submittedAt: result.survey.submittedAt,
      rawTlx: result.survey.nasaTlx.rawTlx,
      trustInAIRaceEngineer: result.survey.trust.trustInAIRaceEngineer,
    };
  }

  state.selectedRace = {
    ...state.selectedRace,
    hasSurvey: true,
    submittedAt: result.survey.submittedAt,
    survey: result.survey,
  };

  renderStats();
  renderRaceList();
  renderDetail();
  saveStatus.textContent = `Saved ${formatDateTime(result.survey.submittedAt)}`;
}

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
