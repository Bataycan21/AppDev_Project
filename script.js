/* =========================================================
   SkillMatch — vanilla JS port of the React/TSX prototype
   ========================================================= */

const POSTINGS = [
  {
    id: "1",
    company: "Accenture Philippines",
    role: "Software Engineering Intern",
    fitScore: 94,
    location: "BGC, Taguig · On-site",
    summary: "React, TypeScript, and REST APIs required. Agile team of 8.",
    description:
      "Join our delivery team building enterprise web applications for financial clients. You'll work alongside senior engineers on real production features, participate in daily standups, and contribute to code reviews. The role requires strong fundamentals in component-based UI development and familiarity with RESTful API integration.",
    tags: ["React", "TypeScript", "REST APIs", "Agile", "Git"],
    logo: "A",
  },
  {
    id: "2",
    company: "Globe Telecom",
    role: "Data Analytics OJT",
    fitScore: 87,
    location: "Mandaluyong · Hybrid",
    summary: "Python and SQL for telco data pipelines. Tableau reporting.",
    description:
      "Work with Globe's data engineering team to build and maintain ETL pipelines processing millions of subscriber records daily. You'll write SQL queries, build Python scripts for data transformation, and create dashboards in Tableau for business stakeholders.",
    tags: ["Python", "SQL", "Tableau", "ETL", "Pandas"],
    logo: "G",
  },
  {
    id: "3",
    company: "PayMaya",
    role: "Mobile Dev Intern (Flutter)",
    fitScore: 81,
    location: "Makati · On-site",
    summary: "Flutter/Dart for fintech mobile features. Strong Dart skills.",
    description:
      "Help build new features on PayMaya's consumer app used by 5M+ Filipinos. You'll work on UI components, integrate payment APIs, and write unit tests. Good understanding of state management patterns is expected.",
    tags: ["Flutter", "Dart", "Firebase", "UI/UX", "Testing"],
    logo: "P",
  },
  {
    id: "4",
    company: "Thinking Machines",
    role: "ML Engineering Intern",
    fitScore: 76,
    location: "BGC, Taguig · Remote",
    summary: "Python ML pipelines, scikit-learn, model deployment basics.",
    description:
      "Contribute to client-facing machine learning projects across agriculture, finance, and logistics. You'll help train models, evaluate performance metrics, and assist in deploying models to staging environments.",
    tags: ["Python", "scikit-learn", "ML", "Jupyter", "Docker"],
    logo: "T",
  },
  {
    id: "5",
    company: "Canva Philippines",
    role: "Frontend Engineering Intern",
    fitScore: 72,
    location: "Manila · Hybrid",
    summary: "Web performance, React, canvas rendering APIs, TypeScript.",
    description:
      "Work on Canva's web editor team to improve rendering performance and build new canvas interactions. Requires solid JavaScript fundamentals and enthusiasm for visual tooling.",
    tags: ["React", "TypeScript", "Canvas API", "Performance", "CSS"],
    logo: "C",
  },
];

// ---------------------------------------------------------
// Global app state
// ---------------------------------------------------------
const state = {
  hasProfile: false,
  activeTab: "home", // home | matches | profile | notifications
  selectedPostingId: null,
  appliedIds: new Set(),
  savedIds: new Set(["2", "3"]),
  homeFilter: "All",
  showHomeFilter: false,
  showQuiz: false,
};

const contentEl = document.getElementById("app-content");

function render() {
  contentEl.innerHTML = "";

  if (!state.hasProfile) {
    contentEl.appendChild(renderOnboardingScreen());
    return;
  }

  if (state.selectedPostingId) {
    const posting = POSTINGS.find((p) => p.id === state.selectedPostingId);
    contentEl.appendChild(renderPostingDetailScreen(posting));
    return;
  }

  if (state.showQuiz) {
    contentEl.appendChild(renderQuizScreen());
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display:flex;flex-direction:column;height:100%;background:#FAFAFA;";

  const tabArea = document.createElement("div");
  tabArea.style.cssText = "flex:1;overflow:hidden;";

  if (state.activeTab === "home") tabArea.appendChild(renderHomeScreen());
  else if (state.activeTab === "matches") tabArea.appendChild(renderMatchesScreen());
  else if (state.activeTab === "profile") tabArea.appendChild(renderProfileScreen());
  else if (state.activeTab === "notifications") tabArea.appendChild(renderNotificationsScreen());

  wrapper.appendChild(tabArea);
  wrapper.appendChild(renderBottomNav());
  contentEl.appendChild(wrapper);
}

// ---------------------------------------------------------
// Small helpers
// ---------------------------------------------------------
function el(tag, styleText, props) {
  const e = document.createElement(tag);
  if (styleText) e.style.cssText = styleText;
  if (props) Object.assign(e, props);
  return e;
}

function scoreColor(fitScore, threeStep) {
  if (threeStep) {
    if (fitScore >= 90) return "#1D9E75";
    if (fitScore >= 80) return "#2FB87E";
    return "#6DC9A4";
  }
  if (fitScore >= 90) return "#1D9E75";
  if (fitScore >= 80) return "#2FB87E";
  if (fitScore >= 70) return "#6DC9A4";
  return "#ABABAB";
}

function hexAlpha(hex, alpha) {
  return hex + alpha;
}

// ===========================================================
// Onboarding Screen
// ===========================================================
const SKILL_SUGGESTIONS = [
  "Web Development", "Python", "React", "SQL", "UI/UX Design",
  "Data Analysis", "Java", "Node.js", "Flutter", "Machine Learning",
  "Figma", "TypeScript", "REST APIs", "Tableau", "Git",
];

const onboardingState = {
  program: "",
  yearLevel: "",
  skills: ["Web Development", "Python"],
  skillInput: "",
  interests: "",
};

function renderOnboardingScreen() {
  const root = el("div", "flex:1;overflow-y:auto;background:#FAFAFA;display:flex;flex-direction:column;");

  const top = el("div", "padding:24px 24px 0;");

  const brand = el("div", "display:inline-flex;align-items:center;gap:6px;margin-bottom:24px;");
  const logoBox = el("div", "width:28px;height:28px;border-radius:8px;background:#1D9E75;display:flex;align-items:center;justify-content:center;");
  logoBox.innerHTML = '<span style="font-size:14px;font-weight:700;color:#FFF;">S</span>';
  const brandName = el("span", "font-size:17px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;");
  brandName.textContent = "SkillMatch";
  brand.appendChild(logoBox);
  brand.appendChild(brandName);

  const h1 = el("h1", "font-size:26px;font-weight:700;color:#1B1B1B;letter-spacing:-0.6px;line-height:1.2;margin:0 0 6px;");
  h1.textContent = "Build your profile";
  const sub = el("p", "font-size:14px;color:#8A8A8A;margin:0 0 28px;line-height:1.5;");
  sub.textContent = "We'll match you to internships that fit your skills.";

  top.appendChild(brand);
  top.appendChild(h1);
  top.appendChild(sub);
  root.appendChild(top);

  const form = el("div", "padding:0 24px;display:flex;flex-direction:column;gap:20px;");

  // Program field
  const programField = el("div");
  const programLabel = labelEl("Program / Specialization");
  const programInput = el("input", inputStyleText());
  programInput.placeholder = "e.g. BS Computer Science";
  programInput.value = onboardingState.program;
  programInput.addEventListener("input", (e) => { onboardingState.program = e.target.value; });
  programField.appendChild(programLabel);
  programField.appendChild(programInput);
  form.appendChild(programField);

  // Year level field
  const yearField = el("div");
  yearField.appendChild(labelEl("Year Level"));
  const yearRow = el("div", "display:flex;gap:8px;");
  ["1st", "2nd", "3rd", "4th"].forEach((yr) => {
    const active = onboardingState.yearLevel === yr;
    const btn = el("button", `flex:1;padding:10px 0;border-radius:10px;border:${active ? "none" : "1.5px solid #E8E8E8"};background:${active ? "#1D9E75" : "#FFFFFF"};color:${active ? "#FFFFFF" : "#1B1B1B"};font-size:13px;font-weight:${active ? 600 : 400};cursor:pointer;transition:all 0.15s ease;`);
    btn.textContent = yr;
    btn.addEventListener("click", () => {
      onboardingState.yearLevel = yr;
      render();
    });
    yearRow.appendChild(btn);
  });
  yearField.appendChild(yearRow);
  form.appendChild(yearField);

  // Skills field
  const skillsField = el("div");
  skillsField.appendChild(labelEl("Skills"));
  const skillsBox = el("div", "background:#FFFFFF;border-radius:12px;border:1.5px solid #E8E8E8;padding:10px 12px;min-height:52px;");

  const chipRow = el("div", `display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${onboardingState.skills.length > 0 ? "8px" : "0"};`);
  onboardingState.skills.forEach((skill) => {
    const chip = el("span", "display:inline-flex;align-items:center;gap:4px;background:#E8F7F2;color:#1D9E75;font-size:12px;font-weight:500;padding:4px 10px;border-radius:20px;");
    const chipText = document.createTextNode(skill);
    const removeBtn = el("button", "background:none;border:none;cursor:pointer;color:#1D9E75;padding:0;line-height:1;font-size:14px;");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      onboardingState.skills = onboardingState.skills.filter((s) => s !== skill);
      render();
    });
    chip.appendChild(chipText);
    chip.appendChild(removeBtn);
    chipRow.appendChild(chip);
  });
  skillsBox.appendChild(chipRow);

  const skillInputRow = el("div", "display:flex;align-items:center;gap:6px;");
  const skillInput = el("input", "flex:1;border:none;outline:none;background:transparent;font-size:13px;color:#1B1B1B;");
  skillInput.placeholder = "Add a skill...";
  skillInput.value = onboardingState.skillInput;
  skillInput.id = "onboarding-skill-input";

  function addOnboardingSkill(skill) {
    const trimmed = (skill || "").trim();
    if (trimmed && !onboardingState.skills.includes(trimmed)) {
      onboardingState.skills.push(trimmed);
    }
    onboardingState.skillInput = "";
    render();
    const input = document.getElementById("onboarding-skill-input");
    if (input) input.focus();
  }

  skillInput.addEventListener("input", (e) => {
    onboardingState.skillInput = e.target.value;
    render();
    const input = document.getElementById("onboarding-skill-input");
    if (input) {
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
    }
  });
  skillInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addOnboardingSkill(skillInput.value);
    }
  });

  const addBtn = el("button", "width:24px;height:24px;border-radius:6px;background:#1D9E75;border:none;cursor:pointer;color:#FFF;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;");
  addBtn.textContent = "+";
  addBtn.addEventListener("click", () => addOnboardingSkill(skillInput.value));

  skillInputRow.appendChild(skillInput);
  skillInputRow.appendChild(addBtn);
  skillsBox.appendChild(skillInputRow);
  skillsField.appendChild(skillsBox);

  const filtered = SKILL_SUGGESTIONS.filter(
    (s) =>
      onboardingState.skillInput.length > 0 &&
      s.toLowerCase().includes(onboardingState.skillInput.toLowerCase()) &&
      !onboardingState.skills.includes(s)
  );

  if (filtered.length > 0) {
    const suggBox = el("div", "background:#FFFFFF;border:1px solid #E8E8E8;border-radius:10px;margin-top:4px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);");
    filtered.slice(0, 4).forEach((s, i, arr) => {
      const btn = el("button", `width:100%;padding:10px 14px;background:none;border:none;text-align:left;font-size:13px;color:#1B1B1B;cursor:pointer;border-bottom:${i < arr.length - 1 ? "1px solid #F4F4F4" : "none"};`);
      btn.textContent = s;
      btn.addEventListener("click", () => addOnboardingSkill(s));
      suggBox.appendChild(btn);
    });
    skillsField.appendChild(suggBox);
  }

  form.appendChild(skillsField);

  // Interests field
  const interestsField = el("div");
  interestsField.appendChild(labelEl("Interests & Goals"));
  const interestsInput = el("textarea", inputStyleText() + "resize:none;line-height:1.5;");
  interestsInput.placeholder = "e.g. I want to work in fintech or startup environments, focusing on full-stack development...";
  interestsInput.rows = 3;
  interestsInput.value = onboardingState.interests;
  interestsInput.addEventListener("input", (e) => { onboardingState.interests = e.target.value; });
  interestsField.appendChild(interestsInput);
  form.appendChild(interestsField);

  const saveBtn = el("button", "width:100%;padding:15px;background:#1D9E75;border:none;border-radius:14px;color:#FFFFFF;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:-0.2px;margin-top:4px;margin-bottom:32px;");
  saveBtn.textContent = "Save Profile";
  saveBtn.addEventListener("click", () => {
    state.hasProfile = true;
    startQuiz();
  });
  form.appendChild(saveBtn);

  root.appendChild(form);
  return root;
}

function labelEl(text) {
  const l = el("label", "display:block;font-size:12px;font-weight:600;color:#8A8A8A;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:8px;");
  l.textContent = text;
  return l;
}

function inputStyleText() {
  return "width:100%;padding:12px 14px;background:#FFFFFF;border:1.5px solid #E8E8E8;border-radius:12px;font-size:14px;color:#1B1B1B;outline:none;box-sizing:border-box;";
}

// ===========================================================
// Home Screen
// ===========================================================
const HOME_FILTERS = ["All", "On-site", "Hybrid", "Remote"];

function renderHomeScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  const filtered =
    state.homeFilter === "All"
      ? POSTINGS
      : POSTINGS.filter((p) => p.location.toLowerCase().includes(state.homeFilter.toLowerCase()));

  const header = el("div", "padding:20px 24px 0;background:#FAFAFA;");
  const headerTop = el("div", "display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;");

  const greetBlock = el("div");
  const greet = el("p", "font-size:13px;color:#8A8A8A;margin:0;margin-bottom:2px;");
  greet.textContent = "Good morning, Marco 👋";
  const title = el("h1", "font-size:22px;font-weight:700;color:#1B1B1B;margin:0;letter-spacing:-0.5px;");
  title.textContent = "Top Matches";
  greetBlock.appendChild(greet);
  greetBlock.appendChild(title);

  const filterBtn = el("button", `width:38px;height:38px;border-radius:10px;background:${state.showHomeFilter ? "#1D9E75" : "#F0F0F0"};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;margin-top:4px;color:${state.showHomeFilter ? "#FFF" : "#1B1B1B"};`);
  filterBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>`;
  filterBtn.addEventListener("click", () => {
    state.showHomeFilter = !state.showHomeFilter;
    render();
  });

  headerTop.appendChild(greetBlock);
  headerTop.appendChild(filterBtn);
  header.appendChild(headerTop);

  if (state.showHomeFilter) {
    const filterRow = el("div", "display:flex;gap:6px;margin-top:14px;margin-bottom:2px;");
    HOME_FILTERS.forEach((f) => {
      const active = state.homeFilter === f;
      const btn = el("button", `padding:6px 14px;border-radius:20px;border:${active ? "none" : "1.5px solid #E8E8E8"};background:${active ? "#1D9E75" : "#FFFFFF"};color:${active ? "#FFF" : "#1B1B1B"};font-size:12px;font-weight:500;cursor:pointer;`);
      btn.textContent = f;
      btn.addEventListener("click", () => {
        state.homeFilter = f;
        state.showHomeFilter = false;
        render();
      });
      filterRow.appendChild(btn);
    });
    header.appendChild(filterRow);
  }

  const countLine = el("p", "font-size:12px;color:#ABABAB;margin:10px 0 0;");
  countLine.textContent = `${filtered.length} internships · Ranked by fit`;
  header.appendChild(countLine);

  root.appendChild(header);

  const feed = el("div", "flex:1;overflow-y:auto;padding:14px 24px 20px;display:flex;flex-direction:column;gap:12px;");
  filtered.forEach((posting, i) => {
    feed.appendChild(renderPostingCard(posting, i + 1));
  });
  root.appendChild(feed);

  return root;
}

function renderPostingCard(posting, rank) {
  const applied = state.appliedIds.has(posting.id);
  const saved = state.savedIds.has(posting.id);
  const sColor = scoreColor(posting.fitScore, false);

  const card = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);cursor:pointer;position:relative;");
  card.addEventListener("click", () => {
    state.selectedPostingId = posting.id;
    render();
  });

  if (applied) {
    const badge = el("div", "position:absolute;top:12px;right:12px;background:#E8F7F2;color:#1D9E75;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;");
    badge.textContent = "Applied";
    card.appendChild(badge);
  }

  const row = el("div", "display:flex;align-items:flex-start;gap:12px;");
  const logo = el("div", "width:40px;height:40px;border-radius:10px;background:#F4F4F4;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;font-weight:700;color:#1B1B1B;");
  logo.textContent = posting.logo;

  const info = el("div", "flex:1;min-width:0;");

  const topRow = el("div", "display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;");
  const companyName = el("span", "font-size:11px;color:#8A8A8A;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
  companyName.textContent = posting.company;
  const fitBadge = el("div", `display:inline-flex;align-items:center;gap:3px;background:${hexAlpha(sColor, "18")};color:${sColor};font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;flex-shrink:0;margin-left:8px;`);
  fitBadge.innerHTML = `<div style="width:5px;height:5px;border-radius:50%;background:${sColor};"></div>${posting.fitScore}% fit`;
  topRow.appendChild(companyName);
  topRow.appendChild(fitBadge);

  const roleTitle = el("h3", "font-size:15px;font-weight:600;color:#1B1B1B;margin:0 0 6px;letter-spacing:-0.2px;");
  roleTitle.textContent = posting.role;

  const summary = el("p", "font-size:12px;color:#8A8A8A;margin:0 0 10px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;");
  summary.textContent = posting.summary;

  const bottomRow = el("div", "display:flex;align-items:center;justify-content:space-between;");
  const locSpan = el("span", "font-size:11px;color:#ABABAB;");
  locSpan.textContent = posting.location;

  const saveBtn = el("button", `background:none;border:none;cursor:pointer;color:${saved ? "#1D9E75" : "#CCCCCC"};padding:0;line-height:1;`);
  saveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${saved ? "#1D9E75" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>`;
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSave(posting.id);
  });

  bottomRow.appendChild(locSpan);
  bottomRow.appendChild(saveBtn);

  info.appendChild(topRow);
  info.appendChild(roleTitle);
  info.appendChild(summary);
  info.appendChild(bottomRow);

  row.appendChild(logo);
  row.appendChild(info);
  card.appendChild(row);

  return card;
}

function toggleSave(id) {
  if (state.savedIds.has(id)) state.savedIds.delete(id);
  else state.savedIds.add(id);
  render();
}

function applyToPosting(id) {
  state.appliedIds.add(id);
  state.selectedPostingId = null;
  render();
}

// ===========================================================
// Posting Detail Screen
// ===========================================================
function renderPostingDetailScreen(posting) {
  const applied = state.appliedIds.has(posting.id);
  const saved = state.savedIds.has(posting.id);
  const sColor = scoreColor(posting.fitScore, true);

  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  // Header
  const header = el("div", "display:flex;align-items:center;justify-content:space-between;padding:16px 24px 12px;background:#FAFAFA;flex-shrink:0;");
  const backBtn = el("button", "width:36px;height:36px;border-radius:10px;background:#F0F0F0;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#1B1B1B;");
  backBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6" /></svg>`;
  backBtn.addEventListener("click", () => {
    state.selectedPostingId = null;
    render();
  });

  const headerTitle = el("span", "font-size:15px;font-weight:600;color:#1B1B1B;letter-spacing:-0.2px;");
  headerTitle.textContent = "Posting Detail";

  const saveBtn = el("button", `width:36px;height:36px;border-radius:10px;background:${saved ? "#E8F7F2" : "#F0F0F0"};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:${saved ? "#1D9E75" : "#8A8A8A"};`);
  saveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${saved ? "#1D9E75" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>`;
  saveBtn.addEventListener("click", () => toggleSave(posting.id));

  header.appendChild(backBtn);
  header.appendChild(headerTitle);
  header.appendChild(saveBtn);
  root.appendChild(header);

  // Scrollable content
  const content = el("div", "flex:1;overflow-y:auto;padding:0 24px 24px;");

  // Company + role card
  const card1 = el("div", "background:#FFFFFF;border-radius:16px;padding:20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");
  const row1 = el("div", "display:flex;align-items:center;gap:14px;margin-bottom:14px;");
  const logo = el("div", "width:52px;height:52px;border-radius:14px;background:#F4F4F4;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#1B1B1B;");
  logo.textContent = posting.logo;
  const nameBlock = el("div");
  const companyP = el("p", "margin:0;font-size:12px;color:#8A8A8A;font-weight:500;");
  companyP.textContent = posting.company;
  const roleH2 = el("h2", "margin:0;font-size:18px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;");
  roleH2.textContent = posting.role;
  nameBlock.appendChild(companyP);
  nameBlock.appendChild(roleH2);
  row1.appendChild(logo);
  row1.appendChild(nameBlock);
  card1.appendChild(row1);

  const row2 = el("div", "display:flex;align-items:center;gap:8px;");
  const fitBadge = el("div", `display:inline-flex;align-items:center;gap:6px;background:${hexAlpha(sColor, "15")};color:${sColor};font-size:13px;font-weight:700;padding:6px 14px;border-radius:24px;`);
  fitBadge.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${sColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>${posting.fitScore}% Skill Match`;
  const locBadge = el("span", "font-size:11px;color:#ABABAB;background:#F4F4F4;padding:5px 10px;border-radius:20px;");
  locBadge.textContent = posting.location;
  row2.appendChild(fitBadge);
  row2.appendChild(locBadge);
  card1.appendChild(row2);

  content.appendChild(card1);

  // Required competencies
  const card2 = el("div", "background:#FFFFFF;border-radius:16px;padding:18px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");
  const h3a = el("h3", "margin:0 0 12px;font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;");
  h3a.textContent = "Required Competencies";
  const tagsRow = el("div", "display:flex;flex-wrap:wrap;gap:6px;");
  posting.tags.forEach((tag) => {
    const t = el("span", "background:#F4F4F4;color:#1B1B1B;font-size:12px;font-weight:500;padding:5px 12px;border-radius:20px;");
    t.textContent = tag;
    tagsRow.appendChild(t);
  });
  card2.appendChild(h3a);
  card2.appendChild(tagsRow);
  content.appendChild(card2);

  // Description
  const card3 = el("div", "background:#FFFFFF;border-radius:16px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");
  const h3b = el("h3", "margin:0 0 10px;font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;");
  h3b.textContent = "About the Role";
  const descP = el("p", "margin:0;font-size:14px;color:#3A3A3A;line-height:1.65;");
  descP.textContent = posting.description;
  card3.appendChild(h3b);
  card3.appendChild(descP);
  content.appendChild(card3);

  root.appendChild(content);

  // Apply CTA
  const ctaWrap = el("div", "padding:12px 24px 20px;background:#FAFAFA;border-top:1px solid #EFEFEF;flex-shrink:0;");
  const applyBtn = el("button", `width:100%;padding:15px;background:${applied ? "#E8F7F2" : "#1D9E75"};border:none;border-radius:14px;color:${applied ? "#1D9E75" : "#FFFFFF"};font-size:15px;font-weight:600;cursor:${applied ? "default" : "pointer"};letter-spacing:-0.2px;transition:background 0.2s ease;`);
  applyBtn.textContent = applied ? "Application Submitted" : "Apply Now";
  applyBtn.disabled = applied;
  applyBtn.addEventListener("click", () => {
    if (!applied) applyToPosting(posting.id);
  });
  ctaWrap.appendChild(applyBtn);
  root.appendChild(ctaWrap);

  return root;
}

// ===========================================================
// Matches Screen
// ===========================================================
const STATUS_CONFIG = {
  "Pending": { bg: "#FFF8E6", color: "#D98A00" },
  "Under Review": { bg: "#EFF6FF", color: "#2563EB" },
  "Approved by Coordinator": { bg: "#E8F7F2", color: "#1D9E75" },
  "Saved": { bg: "#F4F4F4", color: "#8A8A8A" },
};

function renderMatchesScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  const statusCycle = ["Pending", "Under Review", "Approved by Coordinator"];
  const appliedPostings = POSTINGS.filter((p) => state.appliedIds.has(p.id)).map((p, i) => ({
    ...p,
    status: statusCycle[i % 3],
  }));
  const savedPostings = POSTINGS.filter((p) => state.savedIds.has(p.id) && !state.appliedIds.has(p.id)).map((p) => ({
    ...p,
    status: "Saved",
  }));
  const allMatches = [...appliedPostings, ...savedPostings];

  const header = el("div", "padding:20px 24px 12px;");
  const h1 = el("h1", "font-size:22px;font-weight:700;color:#1B1B1B;margin:0 0 2px;letter-spacing:-0.5px;");
  h1.textContent = "My Matches";
  const sub = el("p", "font-size:13px;color:#8A8A8A;margin:0;");
  sub.textContent = `${appliedPostings.length} applied · ${savedPostings.length} saved`;
  header.appendChild(h1);
  header.appendChild(sub);
  root.appendChild(header);

  const list = el("div", "flex:1;overflow-y:auto;padding:4px 24px 20px;display:flex;flex-direction:column;gap:10px;");

  if (allMatches.length === 0) {
    const empty = el("div", "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:80px;gap:10px;");
    const iconBox = el("div", "width:52px;height:52px;border-radius:16px;background:#F0F0F0;display:flex;align-items:center;justify-content:center;");
    iconBox.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ABABAB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 12l2 2 4-4" />
        <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" />
      </svg>`;
    const emptyText = el("p", "font-size:14px;color:#ABABAB;margin:0;text-align:center;");
    emptyText.innerHTML = "No applications yet.<br />Apply to postings from the Home tab.";
    empty.appendChild(iconBox);
    empty.appendChild(emptyText);
    list.appendChild(empty);
  } else {
    allMatches.forEach((match) => {
      const cfg = STATUS_CONFIG[match.status];
      const row = el("div", "background:#FFFFFF;border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);cursor:pointer;display:flex;align-items:center;gap:12px;");
      row.addEventListener("click", () => {
        state.selectedPostingId = match.id;
        render();
      });

      const logo = el("div", "width:40px;height:40px;border-radius:10px;background:#F4F4F4;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#1B1B1B;flex-shrink:0;");
      logo.textContent = match.logo;

      const info = el("div", "flex:1;min-width:0;");
      const topRow = el("div", "display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;");
      const roleSpan = el("span", "font-size:14px;font-weight:600;color:#1B1B1B;letter-spacing:-0.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:8px;");
      roleSpan.textContent = match.role;
      const statusSpan = el("span", `font-size:10px;font-weight:600;color:${cfg.color};background:${cfg.bg};padding:3px 8px;border-radius:20px;flex-shrink:0;white-space:nowrap;`);
      statusSpan.textContent = match.status;
      topRow.appendChild(roleSpan);
      topRow.appendChild(statusSpan);

      const subP = el("p", "margin:0;font-size:12px;color:#8A8A8A;");
      subP.textContent = `${match.company} · ${match.fitScore}% fit`;

      info.appendChild(topRow);
      info.appendChild(subP);

      const chevron = el("div");
      chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#CCCCCC" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6" /></svg>`;

      row.appendChild(logo);
      row.appendChild(info);
      row.appendChild(chevron);
      list.appendChild(row);
    });
  }

  root.appendChild(list);
  return root;
}

// ===========================================================
// Profile Screen
// ===========================================================
const ALL_SKILLS = [
  "Web Development", "Python", "React", "TypeScript", "SQL",
  "REST APIs", "Node.js", "Git", "Agile",
];

const profileState = {
  skills: ["Web Development", "Python", "React", "TypeScript", "SQL"],
  skillInput: "",
  interests:
    "Interested in full-stack development and fintech. Looking for a startup environment where I can work on real production systems from day one.",
  program: "BS Computer Science",
  yearLevel: "3rd",
  saved: false,
};

function renderProfileScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  // Header
  const header = el("div", "padding:20px 24px 16px;flex-shrink:0;");
  const headRow = el("div", "display:flex;align-items:center;gap:14px;margin-bottom:20px;");
  const avatar = el("div", "width:52px;height:52px;border-radius:16px;background:#1D9E75;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#FFFFFF;");
  avatar.textContent = "M";
  const nameBlock = el("div");
  const nameH2 = el("h2", "margin:0;font-size:18px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;");
  nameH2.textContent = "Marco Reyes";
  const progP = el("p", "margin:0;font-size:12px;color:#8A8A8A;");
  progP.textContent = `${profileState.program} · ${profileState.yearLevel} Year`;
  nameBlock.appendChild(nameH2);
  nameBlock.appendChild(progP);
  headRow.appendChild(avatar);
  headRow.appendChild(nameBlock);
  header.appendChild(headRow);
  root.appendChild(header);

  // Scrollable content
  const content = el("div", "flex:1;overflow-y:auto;padding:0 24px 24px;display:flex;flex-direction:column;gap:16px;");

  // Stats row
  const statsRow = el("div", "display:flex;gap:10px;");
  const stats = [
    { label: "Applications", value: "3" },
    { label: "Skill Tags", value: String(profileState.skills.length) },
    { label: "Match Rate", value: "84%" },
  ];
  stats.forEach((stat) => {
    const box = el("div", "flex:1;background:#FFFFFF;border-radius:12px;padding:12px 10px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.05);");
    const val = el("div", "font-size:18px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;");
    val.textContent = stat.value;
    const lab = el("div", "font-size:10px;color:#8A8A8A;margin-top:2px;");
    lab.textContent = stat.label;
    box.appendChild(val);
    box.appendChild(lab);
    statsRow.appendChild(box);
  });
  content.appendChild(statsRow);

  // Skills section
  const skillsCard = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);");
  const skillsLabel = el("label", "display:block;font-size:11px;font-weight:600;color:#8A8A8A;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:12px;");
  skillsLabel.textContent = "Skills";
  skillsCard.appendChild(skillsLabel);

  const chipRow = el("div", "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;");
  profileState.skills.forEach((skill) => {
    const chip = el("span", "display:inline-flex;align-items:center;gap:4px;background:#E8F7F2;color:#1D9E75;font-size:12px;font-weight:500;padding:5px 10px;border-radius:20px;");
    chip.appendChild(document.createTextNode(skill));
    const rmBtn = el("button", "background:none;border:none;cursor:pointer;color:#1D9E75;padding:0;font-size:14px;line-height:1;");
    rmBtn.textContent = "×";
    rmBtn.addEventListener("click", () => {
      profileState.skills = profileState.skills.filter((s) => s !== skill);
      profileState.saved = false;
      render();
    });
    chip.appendChild(rmBtn);
    chipRow.appendChild(chip);
  });
  skillsCard.appendChild(chipRow);

  const addRow = el("div", "display:flex;align-items:center;gap:8px;background:#F9F9F9;border-radius:10px;padding:8px 12px;border:1.5px solid #EFEFEF;");
  const skillInput = el("input", "flex:1;border:none;outline:none;background:transparent;font-size:13px;color:#1B1B1B;");
  skillInput.placeholder = "Add skill...";
  skillInput.value = profileState.skillInput;
  skillInput.id = "profile-skill-input";

  function addProfileSkill(s) {
    if (s.trim() && !profileState.skills.includes(s.trim())) {
      profileState.skills.push(s.trim());
      profileState.saved = false;
    }
    profileState.skillInput = "";
    render();
  }

  skillInput.addEventListener("input", (e) => {
    profileState.skillInput = e.target.value;
    profileState.saved = false;
    render();
    const input = document.getElementById("profile-skill-input");
    if (input) {
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
    }
  });
  skillInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addProfileSkill(skillInput.value);
    }
  });

  const addBtn = el("button", "width:22px;height:22px;border-radius:6px;background:#1D9E75;border:none;cursor:pointer;color:#FFF;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;");
  addBtn.textContent = "+";
  addBtn.addEventListener("click", () => addProfileSkill(skillInput.value));

  addRow.appendChild(skillInput);
  addRow.appendChild(addBtn);
  skillsCard.appendChild(addRow);

  const suggestions = ALL_SKILLS.filter(
    (s) => !profileState.skills.includes(s) && s.toLowerCase().includes(profileState.skillInput.toLowerCase()) && profileState.skillInput.length > 0
  );
  if (suggestions.length > 0) {
    const suggBox = el("div", "background:#FFFFFF;border:1px solid #EFEFEF;border-radius:10px;margin-top:4px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);");
    suggestions.slice(0, 3).forEach((s, i, arr) => {
      const btn = el("button", `width:100%;padding:9px 14px;background:none;border:none;text-align:left;font-size:13px;color:#1B1B1B;cursor:pointer;border-bottom:${i < arr.length - 1 ? "1px solid #F4F4F4" : "none"};`);
      btn.textContent = s;
      btn.addEventListener("click", () => addProfileSkill(s));
      suggBox.appendChild(btn);
    });
    skillsCard.appendChild(suggBox);
  }

  content.appendChild(skillsCard);

  // Interests section
  const interestsCard = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);");
  const interestsLabel = el("label", "display:block;font-size:11px;font-weight:600;color:#8A8A8A;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:10px;");
  interestsLabel.textContent = "Interests & Goals";
  const interestsTextarea = el("textarea", "width:100%;border:1.5px solid #EFEFEF;border-radius:10px;padding:10px 12px;font-size:13px;color:#1B1B1B;line-height:1.6;resize:none;outline:none;background:#FAFAFA;box-sizing:border-box;");
  interestsTextarea.rows = 3;
  interestsTextarea.value = profileState.interests;
  interestsTextarea.addEventListener("input", (e) => {
    profileState.interests = e.target.value;
    profileState.saved = false;
  });
  interestsCard.appendChild(interestsLabel);
  interestsCard.appendChild(interestsTextarea);
  content.appendChild(interestsCard);

  // Save button
  const saveBtn = el("button", `width:100%;padding:14px;background:${profileState.saved ? "#E8F7F2" : "#1D9E75"};border:none;border-radius:14px;color:${profileState.saved ? "#1D9E75" : "#FFFFFF"};font-size:15px;font-weight:600;cursor:pointer;letter-spacing:-0.2px;transition:background 0.2s ease, color 0.2s ease;`);
  saveBtn.textContent = profileState.saved ? "Changes Saved" : "Save Changes";
  saveBtn.addEventListener("click", () => {
    profileState.saved = true;
    render();
  });
  content.appendChild(saveBtn);

  const quizBtn = el("button", "width:100%;padding:14px;background:#FFFFFF;border:1.5px solid #1D9E75;border-radius:14px;color:#1D9E75;font-size:14px;font-weight:600;cursor:pointer;");
  quizBtn.textContent = "Take Career Quiz →";
  quizBtn.addEventListener("click", startQuiz);
  content.appendChild(quizBtn);

  root.appendChild(content);
  return root;
}

// ===========================================================
// Notifications Screen
// ===========================================================
const NOTIFICATIONS = [
  {
    id: "1",
    type: "match",
    title: "New High-Fit Match",
    body: "Canva Philippines posted a Frontend Engineering Intern role — 72% match.",
    time: "2 hours ago",
    read: false,
    icon: "✦",
    iconBg: "#E8F7F2",
    iconColor: "#1D9E75",
  },
  {
    id: "2",
    type: "status",
    title: "Application Update",
    body: "Your application to Accenture Philippines is now Under Review by your coordinator.",
    time: "Yesterday",
    read: false,
    icon: "↗",
    iconBg: "#EFF6FF",
    iconColor: "#2563EB",
  },
  {
    id: "3",
    type: "reminder",
    title: "Profile Incomplete",
    body: "Add your year level to improve match accuracy and unlock more postings.",
    time: "2 days ago",
    read: true,
    icon: "!",
    iconBg: "#FFF8E6",
    iconColor: "#D98A00",
  },
  {
    id: "4",
    type: "match",
    title: "5 New Postings This Week",
    body: "Based on your skills, 5 new internships were added this week. Check your Home feed.",
    time: "3 days ago",
    read: true,
    icon: "✦",
    iconBg: "#E8F7F2",
    iconColor: "#1D9E75",
  },
  {
    id: "5",
    type: "status",
    title: "Saved Posting Expiring",
    body: "Globe Telecom's Data Analytics OJT closes in 3 days. Apply before it's gone.",
    time: "4 days ago",
    read: true,
    icon: "⏱",
    iconBg: "#FFF0F0",
    iconColor: "#DC2626",
  },
];

function renderNotificationsScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");
  const unread = NOTIFICATIONS.filter((n) => !n.read).length;

  const header = el("div", "padding:20px 24px 12px;flex-shrink:0;");
  const headRow = el("div", "display:flex;align-items:center;justify-content:space-between;");
  const h1 = el("h1", "font-size:22px;font-weight:700;color:#1B1B1B;margin:0;letter-spacing:-0.5px;");
  h1.textContent = "Notifications";
  headRow.appendChild(h1);
  if (unread > 0) {
    const badge = el("span", "background:#1D9E75;color:#FFFFFF;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;");
    badge.textContent = `${unread} new`;
    headRow.appendChild(badge);
  }
  header.appendChild(headRow);
  root.appendChild(header);

  const list = el("div", "flex:1;overflow-y:auto;padding:4px 24px 20px;display:flex;flex-direction:column;gap:8px;");
  NOTIFICATIONS.forEach((notif) => {
    const card = el("div", `background:${notif.read ? "#FFFFFF" : "#FAFFF9"};border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);display:flex;gap:12px;align-items:flex-start;border-left:${notif.read ? "none" : "3px solid #1D9E75"};`);

    const iconBox = el("div", `width:36px;height:36px;border-radius:10px;background:${notif.iconBg};display:flex;align-items:center;justify-content:center;font-size:14px;color:${notif.iconColor};font-weight:700;flex-shrink:0;`);
    iconBox.textContent = notif.icon;

    const info = el("div", "flex:1;min-width:0;");
    const topRow = el("div", "display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px;");
    const titleSpan = el("span", `font-size:13px;font-weight:${notif.read ? 500 : 600};color:#1B1B1B;letter-spacing:-0.1px;`);
    titleSpan.textContent = notif.title;
    topRow.appendChild(titleSpan);
    if (!notif.read) {
      const dot = el("div", "width:6px;height:6px;border-radius:50%;background:#1D9E75;flex-shrink:0;margin-top:4px;margin-left:6px;");
      topRow.appendChild(dot);
    }
    const bodyP = el("p", "margin:0 0 6px;font-size:12px;color:#6A6A6A;line-height:1.5;");
    bodyP.textContent = notif.body;
    const timeSpan = el("span", "font-size:11px;color:#ABABAB;");
    timeSpan.textContent = notif.time;

    info.appendChild(topRow);
    info.appendChild(bodyP);
    info.appendChild(timeSpan);

    card.appendChild(iconBox);
    card.appendChild(info);
    list.appendChild(card);
  });
  root.appendChild(list);

  return root;
}

// ===========================================================
// Career Quiz
// ===========================================================
const QUIZ_QUESTIONS = [
  {
    q: "Which task sounds most fun?",
    options: [
      { t: "Building an app feature", tag: "Engineering" },
      { t: "Finding patterns in a spreadsheet", tag: "Data" },
      { t: "Designing a clean UI screen", tag: "Design" },
      { t: "Planning a team's workflow", tag: "Business" },
    ],
  },
  {
    q: "Pick a tool you'd rather master:",
    options: [
      { t: "React / Flutter", tag: "Engineering" },
      { t: "SQL / Tableau", tag: "Data" },
      { t: "Figma", tag: "Design" },
      { t: "Excel / Notion", tag: "Business" },
    ],
  },
  {
    q: "In a group project, you're usually the one who:",
    options: [
      { t: "Writes the code", tag: "Engineering" },
      { t: "Crunches the numbers", tag: "Data" },
      { t: "Makes it look good", tag: "Design" },
      { t: "Keeps everyone organized", tag: "Business" },
    ],
  },
  {
    q: "Which problem interests you more?",
    options: [
      { t: "Why is this app slow?", tag: "Engineering" },
      { t: "Why did sales drop last month?", tag: "Data" },
      { t: "Why is this screen confusing?", tag: "Design" },
      { t: "Why is this process inefficient?", tag: "Business" },
    ],
  },
  {
    q: "Pick a dream first job:",
    options: [
      { t: "Software Engineer", tag: "Engineering" },
      { t: "Data Analyst", tag: "Data" },
      { t: "UI/UX Designer", tag: "Design" },
      { t: "Business/Ops Associate", tag: "Business" },
    ],
  },
];

const FIELD_INFO = {
  Engineering: { label: "Software Engineering", office: "Engineering / Product teams", desc: "You like building things that work. Look at software, mobile, or web dev roles." },
  Data: { label: "Data & Analytics", office: "Data / Analytics office", desc: "You like finding signal in numbers. Look at data analyst or BI roles." },
  Design: { label: "UI/UX Design", office: "Design / Product team", desc: "You care about how things look and feel. Look at product design roles." },
  Business: { label: "Business Operations", office: "Business/Ops or PM office", desc: "You like organizing people and process. Look at ops, PM, or coordinator roles." },
};

// Map each posting to the quiz field it best fits (by id)
const POSTING_FIELD = { "1": "Engineering", "2": "Data", "3": "Engineering", "4": "Data", "5": "Design" };

const quizState = { index: 0, tallies: {}, done: false };

function startQuiz() {
  quizState.index = 0;
  quizState.tallies = {};
  quizState.done = false;
  state.showQuiz = true;
  render();
}

function answerQuiz(tag) {
  quizState.tallies[tag] = (quizState.tallies[tag] || 0) + 1;
  if (quizState.index < QUIZ_QUESTIONS.length - 1) {
    quizState.index += 1;
  } else {
    quizState.done = true;
  }
  render();
}

function renderQuizScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  const header = el("div", "display:flex;align-items:center;gap:10px;padding:16px 24px 12px;flex-shrink:0;");
  if (state.activeTab === "profile" || quizState.done) {
    const backBtn = el("button", "width:36px;height:36px;border-radius:10px;background:#F0F0F0;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#1B1B1B;");
    backBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6" /></svg>`;
    backBtn.addEventListener("click", () => { state.showQuiz = false; render(); });
    header.appendChild(backBtn);
  }
  const titleSpan = el("span", "font-size:15px;font-weight:600;color:#1B1B1B;");
  titleSpan.textContent = "Career Quiz";
  header.appendChild(titleSpan);
  root.appendChild(header);

  const content = el("div", "flex:1;overflow-y:auto;padding:0 24px 24px;");

  if (!quizState.done) {
    const q = QUIZ_QUESTIONS[quizState.index];

    const barTrack = el("div", "width:100%;height:6px;background:#EFEFEF;border-radius:3px;margin-bottom:10px;overflow:hidden;");
    const barFill = el("div", `height:100%;background:#1D9E75;border-radius:3px;width:${((quizState.index) / QUIZ_QUESTIONS.length) * 100}%;transition:width 0.2s ease;`);
    barTrack.appendChild(barFill);
    content.appendChild(barTrack);

    const progress = el("p", "font-size:12px;color:#8A8A8A;margin:0 0 8px;");
    progress.textContent = `Question ${quizState.index + 1} of ${QUIZ_QUESTIONS.length}`;
    const qTitle = el("h2", "font-size:19px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;margin:0 0 20px;");
    qTitle.textContent = q.q;
    content.appendChild(progress);
    content.appendChild(qTitle);

    const optWrap = el("div", "display:flex;flex-direction:column;gap:10px;");
    q.options.forEach((opt) => {
      const btn = el("button", "text-align:left;padding:14px 16px;background:#FFFFFF;border:1.5px solid #E8E8E8;border-radius:12px;font-size:14px;color:#1B1B1B;cursor:pointer;");
      btn.textContent = opt.t;
      btn.addEventListener("click", () => answerQuiz(opt.tag));
      optWrap.appendChild(btn);
    });
    content.appendChild(optWrap);
  } else {
    const top = Object.entries(quizState.tallies).sort((a, b) => b[1] - a[1])[0][0];
    const info = FIELD_INFO[top];

    const badge = el("div", "width:56px;height:56px;border-radius:16px;background:#E8F7F2;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:16px;");
    badge.textContent = "✦";
    const resultLabel = el("p", "font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 6px;");
    resultLabel.textContent = "Your best fit";
    const resultTitle = el("h2", "font-size:22px;font-weight:700;color:#1B1B1B;letter-spacing:-0.5px;margin:0 0 10px;");
    resultTitle.textContent = info.label;
    const officeP = el("p", "font-size:13px;color:#1D9E75;font-weight:600;margin:0 0 12px;");
    officeP.textContent = `Go to: ${info.office}`;
    const descP = el("p", "font-size:14px;color:#3A3A3A;line-height:1.6;margin:0 0 24px;");
    descP.textContent = info.desc;

    content.appendChild(badge);
    content.appendChild(resultLabel);
    content.appendChild(resultTitle);
    content.appendChild(officeP);
    content.appendChild(descP);

    // Matching postings for this field
    const matches = POSTINGS.filter((p) => POSTING_FIELD[p.id] === top);
    if (matches.length > 0) {
      const matchLabel = el("p", "font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px;");
      matchLabel.textContent = "Postings for you";
      content.appendChild(matchLabel);
      const matchList = el("div", "display:flex;flex-direction:column;gap:10px;margin-bottom:20px;");
      matches.forEach((p) => matchList.appendChild(renderPostingCard(p)));
      content.appendChild(matchList);
    }

    const retakeBtn = el("button", "width:100%;padding:14px;background:#F0F0F0;border:none;border-radius:14px;color:#1B1B1B;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px;");
    retakeBtn.textContent = "Retake Quiz";
    retakeBtn.addEventListener("click", startQuiz);

    const doneBtn = el("button", "width:100%;padding:14px;background:#1D9E75;border:none;border-radius:14px;color:#FFFFFF;font-size:14px;font-weight:600;cursor:pointer;");
    doneBtn.textContent = state.activeTab === "profile" ? "Back to Profile" : "Continue to Home";
    doneBtn.addEventListener("click", () => { state.showQuiz = false; render(); });

    content.appendChild(retakeBtn);
    content.appendChild(doneBtn);
  }

  root.appendChild(content);
  return root;
}

// ===========================================================
// Bottom Nav
// ===========================================================
const TABS = [
  {
    id: "home",
    label: "Home",
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
      <path d="M9 21V12h6v9" />
    </svg>`,
  },
  {
    id: "matches",
    label: "Matches",
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor">
      <path d="M9 12l2 2 4-4" />
      <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" />
    </svg>`,
  },
  {
    id: "profile",
    label: "Profile",
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>`,
  },
  {
    id: "notifications",
    label: "Alerts",
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>`,
  },
];

function renderBottomNav() {
  const nav = el("div", "height:82px;background:#FFFFFF;border-top:1px solid #EFEFEF;display:flex;align-items:center;justify-content:space-around;padding-bottom:20px;flex-shrink:0;");
  TABS.forEach((tab) => {
    const isActive = tab.id === state.activeTab;
    const btn = el("button", `display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;cursor:pointer;padding:6px 16px;color:${isActive ? "#1D9E75" : "#ABABAB"};transition:color 0.15s ease;`);
    const iconWrap = el("div", `color:${isActive ? "#1D9E75" : "#ABABAB"};`);
    iconWrap.innerHTML = tab.icon;
    const label = el("span", `font-size:10px;font-weight:${isActive ? 600 : 400};letter-spacing:0.2px;`);
    label.textContent = tab.label;
    btn.appendChild(iconWrap);
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      state.activeTab = tab.id;
      render();
    });
    nav.appendChild(btn);
  });
  return nav;
}

// ---------------------------------------------------------
// Init
// ---------------------------------------------------------
render();