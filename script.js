/* =========================================================
   SkillMatch — vanilla JS port of the React/TSX prototype
   Backed by Supabase Auth + DB: student & company accounts
   ========================================================= */

const SUPABASE_URL = "https://noluueokvovoxtkvpusm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vbHV1ZW9rdm92b3h0a3ZwdXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDkyNzgsImV4cCI6MjEwMzIyNTI3OH0.ydJfA5ZajXJv9E-3FDMl5EP9KHVIenubImfKE5i4eV4";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let POSTINGS = [];
let studentId = null;   // == auth user id, when logged in as a student
let companyId = null;   // == auth user id, when logged in as a company

function mapPostingRow(row) {
  const c = row.companies || {};
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    location: row.location,
    summary: row.summary,
    description: row.description,
    tags: row.tags || [],
    logo: row.logo,
    companyId: row.company_id,
    companyIndustry: c.industry || "",
    companySpecialization: c.specialization || "",
    companyAbout: c.about || "",
  };
}

// ---------------------------------------------------------
// Auth state & helpers
// ---------------------------------------------------------
const authState = { mode: "login", role: "student", email: "", password: "", companyName: "", error: "", info: "" };

async function signUp() {
  authState.error = "";
  authState.info = "";
  const { email, password, role, companyName } = authState;
  if (!email || !password) { authState.error = "Enter an email and password."; render(); return; }
  if (role === "company" && !companyName.trim()) { authState.error = "Enter a company name."; render(); return; }

  // Stash the chosen role/company name in the auth user's own metadata.
  // This survives the "check your email to confirm" gap, since no
  // session exists yet to write to our own tables until they confirm
  // and log in for the first time (see routeAfterAuth below).
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { pending_role: role, pending_company_name: companyName } },
  });
  if (error) { authState.error = error.message; render(); return; }

  // Supabase returns a user with an empty identities array (no error!)
  // when the email is already registered, to avoid leaking which
  // emails exist. Treat that as "please log in instead."
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    authState.error = "This email is already registered. Please log in instead.";
    authState.mode = "login";
    render();
    return;
  }

  if (!data.session) {
    authState.info = "Check your email to confirm your account, then log in.";
    authState.mode = "login";
    render();
    return;
  }
  await routeAfterAuth();
}

async function createProfileAfterSignup(userId, role, companyName) {
  await sb.from("profiles").insert({ id: userId, role });
  if (role === "student") {
    await sb.from("students").insert({ id: userId, name: "" });
  } else {
    await sb.from("companies").insert({ id: userId, name: companyName, logo: (companyName || "?").trim().charAt(0).toUpperCase() });
  }
}

async function signIn() {
  authState.error = "";
  authState.info = "";
  const { email, password } = authState;
  if (!email || !password) { authState.error = "Enter an email and password."; render(); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { authState.error = error.message; render(); return; }
  await routeAfterAuth();
}

async function signOut() {
  await sb.auth.signOut();
  studentId = null;
  companyId = null;
  state.session = null;
  state.hasProfile = false;
  state.activeTab = "home";
  state.selectedPostingId = null;
  render();
}

// After a successful login/signup, look up the user's role and load
// the right dataset (student browsing data vs company's own listings).
// If this is their first-ever authenticated login (no profiles row
// yet), create the profile + student/company row now, using the role
// they picked at signup (stashed in user_metadata).
async function routeAfterAuth() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;

  contentEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ABABAB;font-size:13px;">Loading…</div>`;

  let { data: profileRows } = await sb.from("profiles").select("role").eq("id", user.id).limit(1);
  let role = profileRows && profileRows[0] ? profileRows[0].role : null;

  if (!role) {
    const meta = user.user_metadata || {};
    role = meta.pending_role || "student";
    await createProfileAfterSignup(user.id, role, meta.pending_company_name || "");
  }

  if (role === "company") {
    companyId = user.id;
    state.session = { userId: user.id, role: "company", email: user.email };
    await loadCompanyListings();
  } else {
    studentId = user.id;
    state.session = { userId: user.id, role: "student", email: user.email };
    await loadStudentData();
  }
  render();
}

// Loads public postings + this student's profile/applications/saves.
async function loadStudentData() {
  const { data: postingRows } = await sb
    .from("postings")
    .select("*, companies(industry,specialization,about,name)")
    .order("created_at");
  POSTINGS = (postingRows || []).map(mapPostingRow);

  const { data: studentRows } = await sb.from("students").select("*").eq("id", studentId).limit(1);
  const s = studentRows && studentRows[0];
  if (s) {
    profileState.skills = s.skills || [];
    profileState.interests = s.interests || "";
    profileState.program = s.program || "";
    profileState.yearLevel = s.year_level || "";
    state.hasProfile = !!(s.program); // onboarding sets program, so its presence = profile completed
  }

  const { data: apps } = await sb.from("applications").select("posting_id").eq("student_id", studentId);
  state.appliedIds = new Set((apps || []).map((a) => a.posting_id));

  const { data: saves } = await sb.from("saved_postings").select("posting_id").eq("student_id", studentId);
  state.savedIds = new Set((saves || []).map((sv) => sv.posting_id));

  recomputeMatches();
}

// Persists the current profileState to Supabase for the logged-in student.
async function persistProfile() {
  if (!studentId) return;
  await sb.from("students").update({
    program: profileState.program,
    year_level: profileState.yearLevel,
    skills: profileState.skills,
    interests: profileState.interests,
  }).eq("id", studentId);
}

// ---------------------------------------------------------
// Company: own listings (post / edit / delete)
// ---------------------------------------------------------
let companyName = "";
let companyListings = [];
const companyProfileState = { name: "", industry: "", specialization: "", workType: "", about: "" };

async function loadCompanyListings() {
  const { data: companyRows } = await sb.from("companies").select("*").eq("id", companyId).limit(1);
  const c = companyRows && companyRows[0];
  companyName = c ? c.name : "";
  if (c) {
    companyProfileState.name = c.name || "";
    companyProfileState.industry = c.industry || "";
    companyProfileState.specialization = c.specialization || "";
    companyProfileState.workType = c.work_type || "";
    companyProfileState.about = c.about || "";
  }
  state.hasCompanyProfile = !!(c && c.industry);

  const { data: rows } = await sb.from("postings").select("*").eq("company_id", companyId).order("created_at");
  companyListings = (rows || []).map(mapPostingRow);
}

// Persists the company's name/industry/specialization/work-type/about.
async function persistCompanyProfile() {
  if (!companyId) return;
  await sb.from("companies").update({
    name: companyProfileState.name,
    industry: companyProfileState.industry,
    specialization: companyProfileState.specialization,
    work_type: companyProfileState.workType,
    about: companyProfileState.about,
  }).eq("id", companyId);
  companyName = companyProfileState.name;
  state.hasCompanyProfile = true;
}

const postingFormState = { id: null, role: "", location: "", summary: "", description: "", tags: [], tagInput: "" };

function resetPostingForm(existing) {
  if (existing) {
    postingFormState.id = existing.id;
    postingFormState.role = existing.role;
    postingFormState.location = existing.location;
    postingFormState.summary = existing.summary || "";
    postingFormState.description = existing.description || "";
    postingFormState.tags = [...existing.tags];
  } else {
    postingFormState.id = null;
    postingFormState.role = "";
    postingFormState.location = "";
    postingFormState.summary = "";
    postingFormState.description = "";
    postingFormState.tags = [];
  }
  postingFormState.tagInput = "";
}

async function savePostingForm() {
  const payload = {
    company: companyName,
    role: postingFormState.role,
    location: postingFormState.location,
    summary: postingFormState.summary,
    description: postingFormState.description,
    tags: postingFormState.tags,
    logo: companyName.trim().charAt(0).toUpperCase() || "?",
    company_id: companyId,
  };
  if (postingFormState.id) {
    await sb.from("postings").update(payload).eq("id", postingFormState.id);
  } else {
    await sb.from("postings").insert(payload);
  }
  await loadCompanyListings();
  state.companyView = "list";
  render();
}

async function deleteCompanyPosting(id) {
  await sb.from("postings").delete().eq("id", id);
  await loadCompanyListings();
  render();
}

// ---------------------------------------------------------
// Global app state
// ---------------------------------------------------------
const state = {
  session: null,          // { userId, role: "student" | "company" }
  hasCompanyProfile: false,
  companyView: "list",    // list | form | profile  (company dashboard sub-view)
  hasProfile: false,
  activeTab: "home", // home | matches | profile | notifications
  selectedPostingId: null,
  appliedIds: new Set(),
  savedIds: new Set(),
  homeFilter: "All",
  showHomeFilter: false,
  showQuiz: false,
  matchScores: {}, // { postingId: { score, baseline } } — from recomputeMatches()
};

const contentEl = document.getElementById("app-content");

function render() {
  contentEl.innerHTML = "";

  if (!state.session) {
    contentEl.appendChild(renderAuthScreen());
    return;
  }

  if (state.session.role === "company") {
    if (!state.hasCompanyProfile) {
      contentEl.appendChild(renderCompanyOnboardingScreen());
      return;
    }
    contentEl.appendChild(renderCompanyApp());
    return;
  }

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
// Matching Engine — TF-IDF vectorization + Cosine Similarity
// (content-based filtering, recomputed in a batch step rather
// than on every keystroke, per the algorithmic design doc)
// ===========================================================
const STOPWORDS = new Set([
  "a","an","and","the","for","to","of","in","on","with","is","are",
  "this","that","i","you","we","our","your","be","as","it","or","at",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

// ---------------------------------------------------------
// Domain keyword groups — lets related-but-different words count
// as compatible (e.g. "IT" ~ "debugging"/"troubleshooting"/"helpdesk",
// "machine learning" ~ "data analysis"/"databases"/"servers").
// Any text mentioning a word from a group also earns that group's
// tag, so two texts using different words from the same group still
// score similar in the TF-IDF vectors.
// ---------------------------------------------------------
const KEYWORD_GROUPS = {
  Engineering: [
    "it", "software", "developer", "development", "engineer", "engineering",
    "programming", "coding", "code", "debugging", "debug", "troubleshooting",
    "troubleshoot", "helpdesk", "networks", "network", "servers", "server",
    "systems", "system", "support", "technical", "infrastructure", "hardware",
    "react", "javascript", "typescript", "flutter", "mobile", "web", "app",
    "git", "api", "apis",
  ],
  Data: [
    "data", "analytics", "analysis", "analyst", "machine", "learning", "ml",
    "statistics", "statistical", "sql", "database", "databases", "reporting",
    "insights", "bi", "python", "pandas", "etl", "dashboards", "tableau",
    "modeling", "algorithms",
  ],
  Design: [
    "design", "ui", "ux", "user", "interface", "experience", "figma",
    "prototyping", "prototype", "visual", "creative", "graphics", "canvas",
    "css", "layout", "branding",
  ],
  Business: [
    "business", "operations", "ops", "management", "manager", "coordination",
    "coordinator", "administrative", "admin", "planning", "process", "processes",
    "logistics", "sales", "marketing", "finance", "strategy", "project",
  ],
};

// Reverse lookup: word -> group tag(s)
const WORD_TO_GROUPS = {};
Object.entries(KEYWORD_GROUPS).forEach(([group, words]) => {
  words.forEach((w) => {
    if (!WORD_TO_GROUPS[w]) WORD_TO_GROUPS[w] = [];
    WORD_TO_GROUPS[w].push(group);
  });
});

// Expands a token list with group tags for any domain keyword found,
// so related vocabulary (not just exact words) counts toward similarity.
function expandWithSynonyms(tokens) {
  const expanded = [...tokens];
  tokens.forEach((t) => {
    const groups = WORD_TO_GROUPS[t];
    if (groups) groups.forEach((g) => expanded.push(`_group_${g.toLowerCase()}`));
  });
  return expanded;
}

function postingText(p) {
  return [p.role, p.tags.join(" "), p.description, p.companyIndustry, p.companySpecialization, p.companyAbout].join(" ");
}

function profileText(profile) {
  return [profile.skills.join(" "), profile.interests, profile.program].join(" ");
}

// Step 1: TF-IDF vectorization — converts skill/requirement text into
// comparable numeric vectors across the profile + all postings.
function buildTFIDFVectors(tokenDocs) {
  const df = {};
  tokenDocs.forEach((doc) => {
    new Set(doc).forEach((term) => { df[term] = (df[term] || 0) + 1; });
  });

  const N = tokenDocs.length;
  const idf = {};
  Object.keys(df).forEach((term) => {
    idf[term] = Math.log((N + 1) / (df[term] + 1)) + 1; // smoothed idf
  });

  return tokenDocs.map((doc) => {
    const tf = {};
    doc.forEach((t) => { tf[t] = (tf[t] || 0) + 1; });
    const vec = {};
    Object.keys(tf).forEach((t) => {
      vec[t] = (tf[t] / doc.length) * idf[t];
    });
    return vec;
  });
}

// Step 2: Cosine similarity — scores fit between the student vector
// and each posting vector. Content-based filtering, reliable on
// small datasets like this one.
function cosineSimilarity(vecA, vecB) {
  let dot = 0, magA = 0, magB = 0;
  const keys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
  keys.forEach((k) => {
    const a = vecA[k] || 0;
    const b = vecB[k] || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  });
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Simple keyword-overlap baseline, used only to sanity-check the
// TF-IDF + cosine ranking quality against a naive approach.
function keywordBaselineScore(profileTokens, postingTokens) {
  const pSet = new Set(profileTokens);
  const uniquePosting = new Set(postingTokens);
  if (uniquePosting.size === 0) return 0;
  let overlap = 0;
  uniquePosting.forEach((t) => { if (pSet.has(t)) overlap += 1; });
  return overlap / uniquePosting.size;
}

// Step 3: Batch recompute — run when the profile changes (onboarding
// save, profile save), not on every render, to keep things fast/simple.
function recomputeMatches() {
  const profileTokens = expandWithSynonyms(tokenize(profileText(profileState)));
  const postingTokenDocs = POSTINGS.map((p) => expandWithSynonyms(tokenize(postingText(p))));
  const allDocs = [profileTokens, ...postingTokenDocs];

  const vectors = buildTFIDFVectors(allDocs);
  const profileVec = vectors[0];

  POSTINGS.forEach((p, i) => {
    const postingVec = vectors[i + 1];
    const sim = cosineSimilarity(profileVec, postingVec);
    const baseline = keywordBaselineScore(profileTokens, postingTokenDocs[i]);
    state.matchScores[p.id] = {
      score: Math.max(Math.round(sim * 100), 5), // floor so nothing reads 0%
      baseline: Math.round(baseline * 100),
    };
  });
}

function getFitScore(id) {
  const entry = state.matchScores[id];
  return entry ? entry.score : 50;
}

// ===========================================================
// Auth Screen (student / company sign up + login)
// ===========================================================
function renderAuthScreen() {
  const root = el("div", "flex:1;overflow-y:auto;background:#FAFAFA;display:flex;flex-direction:column;padding:0 24px;");

  const top = el("div", "padding-top:48px;margin-bottom:28px;");
  const brand = el("div", "display:inline-flex;align-items:center;gap:6px;margin-bottom:24px;");
  const logoBox = el("div", "width:28px;height:28px;border-radius:8px;background:#1D9E75;display:flex;align-items:center;justify-content:center;");
  logoBox.innerHTML = '<span style="font-size:14px;font-weight:700;color:#FFF;">S</span>';
  const brandName = el("span", "font-size:17px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;");
  brandName.textContent = "SkillMatch";
  brand.appendChild(logoBox);
  brand.appendChild(brandName);
  const h1 = el("h1", "font-size:24px;font-weight:700;color:#1B1B1B;letter-spacing:-0.5px;margin:0 0 4px;");
  h1.textContent = authState.mode === "login" ? "Welcome back" : "Create your account";
  top.appendChild(brand);
  top.appendChild(h1);
  root.appendChild(top);

  // Role toggle (only relevant for sign up)
  if (authState.mode === "signup") {
    const roleRow = el("div", "display:flex;gap:8px;margin-bottom:18px;");
    [["student", "I'm a Student"], ["company", "I'm a Company"]].forEach(([val, label]) => {
      const active = authState.role === val;
      const btn = el("button", `flex:1;padding:12px 0;border-radius:10px;border:${active ? "none" : "1.5px solid #E8E8E8"};background:${active ? "#1D9E75" : "#FFFFFF"};color:${active ? "#FFFFFF" : "#1B1B1B"};font-size:13px;font-weight:600;cursor:pointer;`);
      btn.textContent = label;
      btn.addEventListener("click", () => { authState.role = val; render(); });
      roleRow.appendChild(btn);
    });
    root.appendChild(roleRow);
  }

  const form = el("div", "display:flex;flex-direction:column;gap:14px;");

  if (authState.mode === "signup" && authState.role === "company") {
    const nameField = el("div");
    nameField.appendChild(labelEl("Company Name"));
    const nameInput = el("input", inputStyleText());
    nameInput.placeholder = "e.g. Accenture Philippines";
    nameInput.value = authState.companyName;
    nameInput.addEventListener("input", (e) => { authState.companyName = e.target.value; });
    nameField.appendChild(nameInput);
    form.appendChild(nameField);
  }

  const emailField = el("div");
  emailField.appendChild(labelEl("Email"));
  const emailInput = el("input", inputStyleText());
  emailInput.type = "email";
  emailInput.placeholder = "you@example.com";
  emailInput.value = authState.email;
  emailInput.addEventListener("input", (e) => { authState.email = e.target.value; });
  emailField.appendChild(emailInput);
  form.appendChild(emailField);

  const pwField = el("div");
  pwField.appendChild(labelEl("Password"));
  const pwInput = el("input", inputStyleText());
  pwInput.type = "password";
  pwInput.placeholder = "••••••••";
  pwInput.value = authState.password;
  pwInput.addEventListener("input", (e) => { authState.password = e.target.value; });
  pwField.appendChild(pwInput);
  form.appendChild(pwField);

  if (authState.error) {
    const err = el("p", "font-size:12px;color:#DC2626;margin:0;");
    err.textContent = authState.error;
    form.appendChild(err);
  }
  if (authState.info) {
    const info = el("p", "font-size:12px;color:#1D9E75;margin:0;");
    info.textContent = authState.info;
    form.appendChild(info);
  }

  const submitBtn = el("button", "width:100%;padding:15px;background:#1D9E75;border:none;border-radius:14px;color:#FFFFFF;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:-0.2px;margin-top:4px;");
  submitBtn.textContent = authState.mode === "login" ? "Log In" : "Sign Up";
  submitBtn.addEventListener("click", () => {
    if (authState.mode === "login") signIn();
    else signUp();
  });
  form.appendChild(submitBtn);

  const switchRow = el("p", "text-align:center;font-size:13px;color:#8A8A8A;margin:16px 0 32px;");
  const switchLink = document.createElement("span");
  switchLink.style.cssText = "color:#1D9E75;font-weight:600;cursor:pointer;";
  if (authState.mode === "login") {
    switchRow.append("New here? ");
    switchLink.textContent = "Create an account";
  } else {
    switchRow.append("Already have an account? ");
    switchLink.textContent = "Log in";
  }
  switchLink.addEventListener("click", () => {
    authState.mode = authState.mode === "login" ? "signup" : "login";
    authState.error = "";
    authState.info = "";
    render();
  });
  switchRow.appendChild(switchLink);
  form.appendChild(switchRow);

  root.appendChild(form);
  return root;
}

// ===========================================================
// Company Dashboard (post / edit / delete listings)
// ===========================================================
// ===========================================================
// Company Onboarding / Edit Profile (industry, specialization, work setup)
// ===========================================================
const COMPANY_INDUSTRIES = [
  "Technology", "Finance", "Telecommunications", "Retail & E-commerce",
  "Healthcare", "Manufacturing", "Education", "Media & Entertainment", "Other",
];
const COMPANY_WORK_TYPES = ["On-site", "Hybrid", "Remote", "Flexible"];

function renderCompanyOnboardingScreen(isEdit) {
  const root = el("div", `flex:1;overflow-y:auto;background:#FAFAFA;display:flex;flex-direction:column;${isEdit ? "" : "padding:0 24px;"}`);
  const container = isEdit ? el("div", "padding:0 24px 24px;") : root;

  if (isEdit) {
    const backRow = el("button", "align-self:flex-start;background:none;border:none;color:#8A8A8A;font-size:12px;cursor:pointer;padding:16px 24px 0;");
    backRow.textContent = "← Back to Dashboard";
    backRow.addEventListener("click", () => { state.companyView = "list"; render(); });
    root.appendChild(backRow);
  }

  if (!isEdit) {
    const top = el("div", "padding:24px 0 0;");
    const backRow = el("button", "background:none;border:none;color:#8A8A8A;font-size:12px;cursor:pointer;padding:0;margin-bottom:16px;");
    backRow.textContent = "← Back to Login";
    backRow.addEventListener("click", signOut);
    top.appendChild(backRow);

    const brand = el("div", "display:inline-flex;align-items:center;gap:6px;margin-bottom:24px;");
    const logoBox = el("div", "width:28px;height:28px;border-radius:8px;background:#1D9E75;display:flex;align-items:center;justify-content:center;");
    logoBox.innerHTML = '<span style="font-size:14px;font-weight:700;color:#FFF;">S</span>';
    const brandName = el("span", "font-size:17px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;");
    brandName.textContent = "SkillMatch";
    brand.appendChild(logoBox);
    brand.appendChild(brandName);
    const h1 = el("h1", "font-size:24px;font-weight:700;color:#1B1B1B;letter-spacing:-0.5px;line-height:1.2;margin:0 0 6px;");
    h1.textContent = "Build your company profile";
    const sub = el("p", "font-size:14px;color:#8A8A8A;margin:0 0 24px;line-height:1.5;");
    sub.textContent = "Tell students what your company does and what you hire for.";
    top.appendChild(brand);
    top.appendChild(h1);
    top.appendChild(sub);
    root.appendChild(top);
  }

  const form = el("div", "display:flex;flex-direction:column;gap:20px;");

  // Company Name
  const nameField = el("div");
  nameField.appendChild(labelEl("Company Name"));
  const nameInput = el("input", inputStyleText());
  nameInput.placeholder = "e.g. Accenture Philippines";
  nameInput.value = companyProfileState.name;
  nameInput.addEventListener("input", (e) => { companyProfileState.name = e.target.value; });
  nameField.appendChild(nameInput);
  form.appendChild(nameField);

  // Industry (single select)
  const industryField = el("div");
  industryField.appendChild(labelEl("Industry"));
  const industryRow = el("div", "display:flex;flex-wrap:wrap;gap:8px;");
  COMPANY_INDUSTRIES.forEach((ind) => {
    const active = companyProfileState.industry === ind;
    const btn = el("button", `padding:8px 14px;border-radius:20px;border:${active ? "none" : "1.5px solid #E8E8E8"};background:${active ? "#1D9E75" : "#FFFFFF"};color:${active ? "#FFFFFF" : "#1B1B1B"};font-size:12px;font-weight:${active ? 600 : 400};cursor:pointer;`);
    btn.textContent = ind;
    btn.addEventListener("click", () => { companyProfileState.industry = ind; render(); });
    industryRow.appendChild(btn);
  });
  industryField.appendChild(industryRow);
  form.appendChild(industryField);

  // Specialization (free text)
  const specField = el("div");
  specField.appendChild(labelEl("Specialization"));
  const specInput = el("input", inputStyleText());
  specInput.placeholder = "e.g. Fintech mobile solutions, enterprise SaaS";
  specInput.value = companyProfileState.specialization;
  specInput.addEventListener("input", (e) => { companyProfileState.specialization = e.target.value; });
  specField.appendChild(specInput);
  form.appendChild(specField);

  // Work setup (single select)
  const workField = el("div");
  workField.appendChild(labelEl("Typical Work Setup"));
  const workRow = el("div", "display:flex;gap:8px;");
  COMPANY_WORK_TYPES.forEach((w) => {
    const active = companyProfileState.workType === w;
    const btn = el("button", `flex:1;padding:10px 0;border-radius:10px;border:${active ? "none" : "1.5px solid #E8E8E8"};background:${active ? "#1D9E75" : "#FFFFFF"};color:${active ? "#FFFFFF" : "#1B1B1B"};font-size:12px;font-weight:${active ? 600 : 400};cursor:pointer;`);
    btn.textContent = w;
    btn.addEventListener("click", () => { companyProfileState.workType = w; render(); });
    workRow.appendChild(btn);
  });
  workField.appendChild(workRow);
  form.appendChild(workField);

  // Introduction (fill-in-the-blank, no multiple choice — this is what
  // gets matched against student descriptions via the keyword engine)
  const aboutField = el("div");
  aboutField.appendChild(labelEl("Introduce Your Company"));
  const aboutHint = el("p", "font-size:12px;color:#8A8A8A;margin:-4px 0 8px;line-height:1.5;");
  aboutHint.textContent = "In your own words: what does your company do, and what kind of work will interns/hires actually be doing?";
  const aboutInput = el("textarea", inputStyleText() + "resize:none;line-height:1.5;");
  aboutInput.rows = 4;
  aboutInput.placeholder = "e.g. We're an IT services company — our interns help with servers, networks, and troubleshooting for client systems.";
  aboutInput.value = companyProfileState.about;
  aboutInput.addEventListener("input", (e) => { companyProfileState.about = e.target.value; });
  aboutField.appendChild(aboutHint);
  aboutField.appendChild(aboutInput);
  form.appendChild(aboutField);

  const saveBtn = el("button", "width:100%;padding:15px;background:#1D9E75;border:none;border-radius:14px;color:#FFFFFF;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:-0.2px;margin-top:4px;margin-bottom:32px;");
  saveBtn.textContent = isEdit ? "Save Changes" : "Save Company Profile";
  saveBtn.addEventListener("click", async () => {
    await persistCompanyProfile();
    if (isEdit) state.companyView = "list";
    render();
  });
  form.appendChild(saveBtn);

  container.appendChild(form);
  if (isEdit) root.appendChild(container);
  return root;
}

function renderCompanyApp() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  const header = el("div", "display:flex;align-items:center;justify-content:space-between;padding:20px 24px 12px;flex-shrink:0;");
  const headLeft = el("div");
  const nameH1 = el("h1", "font-size:20px;font-weight:700;color:#1B1B1B;margin:0;letter-spacing:-0.4px;");
  nameH1.textContent = companyName || "Company";
  const sub = el("p", "font-size:12px;color:#8A8A8A;margin:2px 0 0;");
  sub.textContent = `${companyProfileState.industry || "No industry set"} · ${companyListings.length} active listing${companyListings.length === 1 ? "" : "s"}`;
  headLeft.appendChild(nameH1);
  headLeft.appendChild(sub);
  const headRight = el("div", "display:flex;flex-direction:column;align-items:flex-end;gap:6px;");
  const editProfileBtn = el("button", "background:none;border:none;color:#1D9E75;font-size:12px;font-weight:600;cursor:pointer;padding:0;");
  editProfileBtn.textContent = "Edit Profile";
  editProfileBtn.addEventListener("click", () => { state.companyView = "profile"; render(); });
  const signOutBtn = el("button", "background:none;border:none;color:#DC2626;font-size:12px;font-weight:600;cursor:pointer;padding:0;");
  signOutBtn.textContent = "Sign Out";
  signOutBtn.addEventListener("click", signOut);
  headRight.appendChild(editProfileBtn);
  headRight.appendChild(signOutBtn);
  header.appendChild(headLeft);
  header.appendChild(headRight);
  root.appendChild(header);

  if (state.companyView === "profile") {
    root.appendChild(renderCompanyOnboardingScreen(true));
    return root;
  }

  if (state.companyView === "form") {
    root.appendChild(renderPostingForm());
    return root;
  }

  const content = el("div", "flex:1;overflow-y:auto;padding:0 24px 20px;");

  const newBtn = el("button", "width:100%;padding:13px;background:#1D9E75;border:none;border-radius:14px;color:#FFFFFF;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:16px;");
  newBtn.textContent = "+ New Listing";
  newBtn.addEventListener("click", () => {
    resetPostingForm(null);
    state.companyView = "form";
    render();
  });
  content.appendChild(newBtn);

  if (companyListings.length === 0) {
    const empty = el("p", "text-align:center;color:#ABABAB;font-size:13px;margin-top:60px;");
    empty.textContent = "No listings yet. Post your first one!";
    content.appendChild(empty);
  }

  companyListings.forEach((p) => {
    const card = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");
    const roleH3 = el("h3", "font-size:15px;font-weight:600;color:#1B1B1B;margin:0 0 4px;letter-spacing:-0.2px;");
    roleH3.textContent = p.role;
    const locP = el("p", "font-size:12px;color:#8A8A8A;margin:0 0 12px;");
    locP.textContent = p.location;

    const tagsRow = el("div", "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;");
    p.tags.forEach((t) => {
      const chip = el("span", "background:#F4F4F4;color:#1B1B1B;font-size:11px;padding:3px 9px;border-radius:20px;");
      chip.textContent = t;
      tagsRow.appendChild(chip);
    });

    const actionsRow = el("div", "display:flex;gap:8px;");
    const editBtn = el("button", "flex:1;padding:9px 0;background:#F0F0F0;border:none;border-radius:10px;color:#1B1B1B;font-size:12px;font-weight:600;cursor:pointer;");
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      resetPostingForm(p);
      state.companyView = "form";
      render();
    });
    const delBtn = el("button", "flex:1;padding:9px 0;background:#FFF0F0;border:none;border-radius:10px;color:#DC2626;font-size:12px;font-weight:600;cursor:pointer;");
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      if (confirm(`Delete "${p.role}"? This can't be undone.`)) deleteCompanyPosting(p.id);
    });
    actionsRow.appendChild(editBtn);
    actionsRow.appendChild(delBtn);

    card.appendChild(roleH3);
    card.appendChild(locP);
    card.appendChild(tagsRow);
    card.appendChild(actionsRow);
    content.appendChild(card);
  });

  root.appendChild(content);
  return root;
}

function renderPostingForm() {
  const wrap = el("div", "flex:1;overflow-y:auto;padding:0 24px 24px;display:flex;flex-direction:column;gap:16px;");

  const backRow = el("button", "align-self:flex-start;background:none;border:none;color:#8A8A8A;font-size:12px;cursor:pointer;padding:0;margin-bottom:-6px;");
  backRow.textContent = "← Back to listings";
  backRow.addEventListener("click", () => { state.companyView = "list"; render(); });
  wrap.appendChild(backRow);

  const roleField = el("div");
  roleField.appendChild(labelEl("Role Title"));
  const roleInput = el("input", inputStyleText());
  roleInput.placeholder = "e.g. Frontend Engineering Intern";
  roleInput.value = postingFormState.role;
  roleInput.addEventListener("input", (e) => { postingFormState.role = e.target.value; });
  roleField.appendChild(roleInput);
  wrap.appendChild(roleField);

  const locField = el("div");
  locField.appendChild(labelEl("Location"));
  const locInput = el("input", inputStyleText());
  locInput.placeholder = "e.g. BGC, Taguig · On-site";
  locInput.value = postingFormState.location;
  locInput.addEventListener("input", (e) => { postingFormState.location = e.target.value; });
  locField.appendChild(locInput);
  wrap.appendChild(locField);

  const sumField = el("div");
  sumField.appendChild(labelEl("Short Summary"));
  const sumInput = el("input", inputStyleText());
  sumInput.placeholder = "One line shown on the feed card";
  sumInput.value = postingFormState.summary;
  sumInput.addEventListener("input", (e) => { postingFormState.summary = e.target.value; });
  sumField.appendChild(sumInput);
  wrap.appendChild(sumField);

  const descField = el("div");
  descField.appendChild(labelEl("Full Description"));
  const descInput = el("textarea", inputStyleText() + "resize:none;line-height:1.5;");
  descInput.rows = 4;
  descInput.value = postingFormState.description;
  descInput.addEventListener("input", (e) => { postingFormState.description = e.target.value; });
  descField.appendChild(descInput);
  wrap.appendChild(descField);

  // Required competencies (tag chips, same pattern as onboarding skills)
  const tagsField = el("div");
  tagsField.appendChild(labelEl("Required Competencies"));
  const tagsBox = el("div", "background:#FFFFFF;border-radius:12px;border:1.5px solid #E8E8E8;padding:10px 12px;");
  const chipRow = el("div", `display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${postingFormState.tags.length ? "8px" : "0"};`);
  postingFormState.tags.forEach((tag) => {
    const chip = el("span", "display:inline-flex;align-items:center;gap:4px;background:#E8F7F2;color:#1D9E75;font-size:12px;font-weight:500;padding:4px 10px;border-radius:20px;");
    chip.appendChild(document.createTextNode(tag));
    const rm = el("button", "background:none;border:none;cursor:pointer;color:#1D9E75;padding:0;font-size:14px;line-height:1;");
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      postingFormState.tags = postingFormState.tags.filter((t) => t !== tag);
      render();
    });
    chip.appendChild(rm);
    chipRow.appendChild(chip);
  });
  tagsBox.appendChild(chipRow);

  const tagInputRow = el("div", "display:flex;align-items:center;gap:6px;");
  const tagInput = el("input", "flex:1;border:none;outline:none;background:transparent;font-size:13px;color:#1B1B1B;");
  tagInput.placeholder = "Add a skill/tag...";
  tagInput.value = postingFormState.tagInput;
  tagInput.id = "posting-tag-input";
  function addTag(v) {
    const t = (v || "").trim();
    if (t && !postingFormState.tags.includes(t)) postingFormState.tags.push(t);
    postingFormState.tagInput = "";
    render();
    const inp = document.getElementById("posting-tag-input");
    if (inp) inp.focus();
  }
  tagInput.addEventListener("input", (e) => {
    postingFormState.tagInput = e.target.value;
    render();
    const inp = document.getElementById("posting-tag-input");
    if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = inp.value.length; }
  });
  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput.value); }
  });
  const addTagBtn = el("button", "width:24px;height:24px;border-radius:6px;background:#1D9E75;border:none;cursor:pointer;color:#FFF;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;");
  addTagBtn.textContent = "+";
  addTagBtn.addEventListener("click", () => addTag(tagInput.value));
  tagInputRow.appendChild(tagInput);
  tagInputRow.appendChild(addTagBtn);
  tagsBox.appendChild(tagInputRow);
  tagsField.appendChild(tagsBox);
  wrap.appendChild(tagsField);

  const saveBtn = el("button", "width:100%;padding:15px;background:#1D9E75;border:none;border-radius:14px;color:#FFFFFF;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:-0.2px;");
  saveBtn.textContent = postingFormState.id ? "Save Changes" : "Post Listing";
  saveBtn.addEventListener("click", () => {
    if (!postingFormState.role.trim() || !postingFormState.location.trim()) return;
    savePostingForm();
  });
  wrap.appendChild(saveBtn);

  return wrap;
}

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

  const backRow = el("button", "background:none;border:none;color:#8A8A8A;font-size:12px;cursor:pointer;padding:0;margin-bottom:16px;");
  backRow.textContent = "← Back to Login";
  backRow.addEventListener("click", signOut);
  top.appendChild(backRow);

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
    profileState.skills = [...onboardingState.skills];
    profileState.interests = onboardingState.interests || profileState.interests;
    profileState.program = onboardingState.program || profileState.program;
    profileState.yearLevel = onboardingState.yearLevel || profileState.yearLevel;
    recomputeMatches();
    persistProfile();
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

  const filtered = (
    state.homeFilter === "All"
      ? POSTINGS
      : POSTINGS.filter((p) => p.location.toLowerCase().includes(state.homeFilter.toLowerCase()))
  ).slice().sort((a, b) => getFitScore(b.id) - getFitScore(a.id));

  const header = el("div", "padding:20px 24px 0;background:#FAFAFA;");
  const headerTop = el("div", "display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;");

  const greetBlock = el("div");
  const greet = el("p", "font-size:13px;color:#8A8A8A;margin:0;margin-bottom:2px;");
  greet.textContent = `Good morning 👋`;
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
  const fitScore = getFitScore(posting.id);
  const sColor = scoreColor(fitScore, false);

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
  fitBadge.innerHTML = `<div style="width:5px;height:5px;border-radius:50%;background:${sColor};"></div>${fitScore}% fit`;
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
  const wasSaved = state.savedIds.has(id);
  if (wasSaved) state.savedIds.delete(id);
  else state.savedIds.add(id);
  render();

  if (!studentId) return;
  if (wasSaved) {
    sb.from("saved_postings").delete().eq("student_id", studentId).eq("posting_id", id);
  } else {
    sb.from("saved_postings").upsert({ student_id: studentId, posting_id: id }, { onConflict: "student_id,posting_id" });
  }
}

function applyToPosting(id) {
  state.appliedIds.add(id);
  state.selectedPostingId = null;
  render();

  if (!studentId) return;
  sb.from("applications").upsert({ student_id: studentId, posting_id: id }, { onConflict: "student_id,posting_id" });
}

// ===========================================================
// Posting Detail Screen
// ===========================================================
function renderPostingDetailScreen(posting) {
  const applied = state.appliedIds.has(posting.id);
  const saved = state.savedIds.has(posting.id);
  const fitScore = getFitScore(posting.id);
  const sColor = scoreColor(fitScore, true);

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
    </svg>${fitScore}% Skill Match`;
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
      subP.textContent = `${match.company} · ${getFitScore(match.id)}% fit`;

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
  skills: [],
  skillInput: "",
  interests: "",
  program: "",
  yearLevel: "",
  saved: false,
};

function renderProfileScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  // Header
  const header = el("div", "padding:20px 24px 16px;flex-shrink:0;");
  const headRow = el("div", "display:flex;align-items:center;gap:14px;margin-bottom:20px;");
  const avatar = el("div", "width:52px;height:52px;border-radius:16px;background:#1D9E75;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#FFFFFF;");
  avatar.textContent = (state.session && state.session.email ? state.session.email.charAt(0) : "S").toUpperCase();
  const nameBlock = el("div");
  const nameH2 = el("h2", "margin:0;font-size:18px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;");
  nameH2.textContent = state.session && state.session.email ? state.session.email : "My Profile";
  const progP = el("p", "margin:0;font-size:12px;color:#8A8A8A;");
  progP.textContent = `${profileState.program || "No program set"} · ${profileState.yearLevel || "—"} Year`;
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
    recomputeMatches();
    persistProfile();
    render();
  });
  content.appendChild(saveBtn);

  const quizBtn = el("button", "width:100%;padding:14px;background:#FFFFFF;border:1.5px solid #1D9E75;border-radius:14px;color:#1D9E75;font-size:14px;font-weight:600;cursor:pointer;");
  quizBtn.textContent = "Take Career Quiz →";
  quizBtn.addEventListener("click", startQuiz);
  content.appendChild(quizBtn);

  const signOutBtn = el("button", "width:100%;padding:14px;background:none;border:none;color:#DC2626;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;");
  signOutBtn.textContent = "Sign Out";
  signOutBtn.addEventListener("click", signOut);
  content.appendChild(signOutBtn);

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
// Career Quiz — fill-in-the-blank (no multiple choice). Answers
// are combined and matched against domain keyword groups, then
// folded into the student's profile so real posting matches
// (via the TF-IDF engine) reflect it too.
// ===========================================================
const QUIZ_QUESTIONS = [
  { q: "What kind of work do you want to do after graduating?", placeholder: "e.g. I want to focus on the IT department, fixing systems and helping people troubleshoot problems." },
  { q: "What skills or tools do you enjoy using the most?", placeholder: "e.g. debugging code, working with servers and databases, SQL, Figma..." },
  { q: "Describe a task or project you'd love to work on.", placeholder: "e.g. Building a dashboard that analyzes sales data with machine learning." },
];

const FIELD_INFO = {
  Engineering: { label: "Software Engineering / IT", office: "Engineering / IT Support office", desc: "Your answers lean toward building, fixing, and supporting technical systems. Look at software, mobile, or IT/helpdesk roles." },
  Data: { label: "Data & Analytics", office: "Data / Analytics office", desc: "Your answers lean toward numbers and patterns. Look at data analyst, BI, or ML-adjacent roles." },
  Design: { label: "UI/UX Design", office: "Design / Product team", desc: "Your answers lean toward how things look and feel. Look at product or UI/UX design roles." },
  Business: { label: "Business Operations", office: "Business/Ops or PM office", desc: "Your answers lean toward organizing people and process. Look at ops, PM, or coordinator roles." },
};

const quizState = { index: 0, answers: [], done: false, resultField: null };

function startQuiz() {
  quizState.index = 0;
  quizState.answers = QUIZ_QUESTIONS.map(() => "");
  quizState.done = false;
  quizState.resultField = null;
  state.showQuiz = true;
  render();
}

// Scores the combined free-text answers against each domain keyword
// group (with synonym expansion) and picks the strongest match.
function scoreQuizAnswers(combinedText) {
  const expanded = expandWithSynonyms(tokenize(combinedText));
  const counts = {};
  Object.keys(KEYWORD_GROUPS).forEach((group) => {
    counts[group] = expanded.filter((t) => t === `_group_${group.toLowerCase()}`).length;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] > 0 ? sorted[0][0] : "Engineering"; // sensible default if nothing matched
}

function submitQuizAnswer(text) {
  quizState.answers[quizState.index] = text;
  if (quizState.index < QUIZ_QUESTIONS.length - 1) {
    quizState.index += 1;
    render();
    return;
  }
  quizState.done = true;
  const combined = quizState.answers.join(" ");
  quizState.resultField = scoreQuizAnswers(combined);

  // Fold the quiz answers into the student's profile so the main
  // TF-IDF matching engine (postings feed, fit %) reflects it too.
  const existing = profileState.interests || "";
  profileState.interests = existing ? `${existing} ${combined}` : combined;
  recomputeMatches();
  persistProfile();
  render();
}

function renderQuizScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  const header = el("div", "display:flex;align-items:center;gap:10px;padding:16px 24px 12px;flex-shrink:0;");
  const backBtn = el("button", "width:36px;height:36px;border-radius:10px;background:#F0F0F0;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#1B1B1B;");
  backBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6" /></svg>`;
  backBtn.addEventListener("click", () => {
    if (!quizState.done && quizState.index > 0) {
      quizState.index -= 1; // step back a question
      render();
    } else {
      state.showQuiz = false; // exit the quiz entirely
      render();
    }
  });
  header.appendChild(backBtn);
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
    const qTitle = el("h2", "font-size:19px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;margin:0 0 16px;");
    qTitle.textContent = q.q;
    content.appendChild(progress);
    content.appendChild(qTitle);

    const textarea = el("textarea", inputStyleText() + "resize:none;line-height:1.5;min-height:120px;");
    textarea.placeholder = q.placeholder;
    textarea.value = quizState.answers[quizState.index] || "";
    textarea.id = "quiz-answer-input";
    textarea.addEventListener("input", (e) => { quizState.answers[quizState.index] = e.target.value; });
    content.appendChild(textarea);

    const nextBtn = el("button", "width:100%;padding:14px;background:#1D9E75;border:none;border-radius:14px;color:#FFFFFF;font-size:14px;font-weight:600;cursor:pointer;margin-top:16px;");
    nextBtn.textContent = quizState.index < QUIZ_QUESTIONS.length - 1 ? "Next" : "See My Result";
    nextBtn.addEventListener("click", () => {
      const val = document.getElementById("quiz-answer-input").value;
      submitQuizAnswer(val);
    });
    content.appendChild(nextBtn);
  } else {
    const top = quizState.resultField;
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

    // Top real postings by the (now quiz-updated) fit score
    const matches = [...POSTINGS].sort((a, b) => getFitScore(b.id) - getFitScore(a.id)).slice(0, 3);
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
// Init — always land on the login page first, even if a session
// was previously persisted (no silent auto-login on reopen).
// ---------------------------------------------------------
contentEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ABABAB;font-size:13px;">Loading SkillMatch…</div>`;
sb.auth.signOut().finally(() => {
  studentId = null;
  companyId = null;
  state.session = null;
  render();
});