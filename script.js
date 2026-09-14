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
    logoUrl: c.logo_url || "",
    salary: row.salary || "",
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
  } else if (role === "company") {
    await sb.from("companies").insert({ id: userId, name: companyName, logo: (companyName || "?").trim().charAt(0).toUpperCase() });
  }
  // coordinator: no extra row needed, profiles.role is enough
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
  state.hasCompanyProfile = false;
  state.activeTab = "home";
  state.selectedPostingId = null;
  state.companyView = "list";
  state.appliedIds = new Set();
  state.savedIds = new Set();
  state.applicationStatus = {};
  companyListings = [];
  companyApplicants = [];
  applicantsForPostingId = null;
  coordinatorApplications = [];
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

  contentEl.innerHTML = "";
  contentEl.appendChild(skeletonFeedScreen());

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
  } else if (role === "coordinator") {
    state.session = { userId: user.id, role: "coordinator", email: user.email };
    await loadCoordinatorData();
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
    .select("*, companies(industry,specialization,about,name,logo_url)")
    .order("created_at");
  POSTINGS = (postingRows || []).map(mapPostingRow);

  const { data: studentRows } = await sb.from("students").select("*").eq("id", studentId).limit(1);
  const s = studentRows && studentRows[0];
  if (s) {
    profileState.name = s.name || "";
    profileState.skills = s.skills || [];
    profileState.interests = s.interests || "";
    profileState.program = s.program || "";
    profileState.yearLevel = s.year_level || "";
    profileState.resumeFilename = s.resume_filename || "";
    state.hasProfile = !!(s.program); // onboarding sets program, so its presence = profile completed
  }

  const { data: apps } = await sb.from("applications").select("posting_id, status").eq("student_id", studentId);
  state.appliedIds = new Set((apps || []).map((a) => a.posting_id));
  state.applicationStatus = {};
  (apps || []).forEach((a) => { state.applicationStatus[a.posting_id] = a.status; });

  const { data: saves } = await sb.from("saved_postings").select("posting_id").eq("student_id", studentId);
  state.savedIds = new Set((saves || []).map((sv) => sv.posting_id));

  await loadNotifications();

  recomputeMatches();
}

// Persists the current profileState to Supabase for the logged-in student.
async function persistProfile() {
  if (!studentId) return;
  await sb.from("students").update({
    name: profileState.name,
    program: profileState.program,
    year_level: profileState.yearLevel,
    skills: profileState.skills,
    interests: profileState.interests,
  }).eq("id", studentId);
}

// ---------------------------------------------------------
// Resume upload (student side) — stored in the private
// "resumes" bucket under {studentId}/{filename}
// ---------------------------------------------------------
async function uploadResume(file) {
  if (!studentId || !file) return;
  if (file.type !== "application/pdf") {
    alert("Please upload a PDF file.");
    return;
  }
  profileState.resumeUploading = true;
  render();

  const path = `${studentId}/${file.name}`;
  const { error: uploadError } = await sb.storage
    .from("resumes")
    .upload(path, file, { upsert: true, contentType: "application/pdf" });

  if (uploadError) {
    profileState.resumeUploading = false;
    alert("Resume upload failed: " + uploadError.message);
    render();
    return;
  }

  await sb.from("students").update({
    resume_path: path,
    resume_filename: file.name,
  }).eq("id", studentId);

  profileState.resumeFilename = file.name;
  profileState.resumeUploading = false;
  render();
}

async function removeResume() {
  if (!studentId) return;
  const { data: studentRows } = await sb.from("students").select("resume_path").eq("id", studentId).limit(1);
  const path = studentRows && studentRows[0] && studentRows[0].resume_path;
  if (path) await sb.storage.from("resumes").remove([path]);
  await sb.from("students").update({ resume_path: null, resume_filename: null }).eq("id", studentId);
  profileState.resumeFilename = "";
  render();
}

// ---------------------------------------------------------
// Company: own listings (post / edit / delete)
// ---------------------------------------------------------
let companyName = "";
let companyListings = [];
const companyProfileState = { name: "", industry: "", industryInput: "", specialization: "", workType: "", about: "", logoUrl: "", logoUploading: false };
let companyLogoUrl = ""; // mirrors companyProfileState.logoUrl for quick use on postings/header

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
    companyProfileState.logoUrl = c.logo_url || "";
    companyLogoUrl = c.logo_url || "";
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

// ---------------------------------------------------------
// Company logo upload — public bucket, so postings/cards can
// show a real image instead of the generated letter avatar.
// ---------------------------------------------------------
async function uploadCompanyLogo(file) {
  if (!companyId || !file) return;
  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file (PNG, JPG, etc).");
    return;
  }
  companyProfileState.logoUploading = true;
  render();

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${companyId}/logo-${Date.now()}.${ext}`;
  const { error: uploadError } = await sb.storage
    .from("logos")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    companyProfileState.logoUploading = false;
    alert("Logo upload failed: " + uploadError.message);
    render();
    return;
  }

  const { data: urlData } = sb.storage.from("logos").getPublicUrl(path);
  const publicUrl = urlData ? urlData.publicUrl : "";

  await sb.from("companies").update({ logo_url: publicUrl }).eq("id", companyId);
  companyProfileState.logoUrl = publicUrl;
  companyLogoUrl = publicUrl;
  companyProfileState.logoUploading = false;
  render();
}

const CURRENCY_OPTIONS = [
  { code: "PHP", symbol: "\u20b1", label: "\u20b1 PHP" },
  { code: "USD", symbol: "$", label: "$ USD" },
  { code: "EUR", symbol: "\u20ac", label: "\u20ac EUR" },
  { code: "OTHER", symbol: "", label: "Other" },
];

const postingFormState = {
  id: null, role: "", location: "", summary: "", description: "", tags: [], tagInput: "",
  salaryCurrency: "PHP", salaryCustomSymbol: "", salaryAmount: "", salaryPeriod: "month", salaryUnpaid: false,
};

// Best-effort parse of an existing "\u20b18,000/month" style string back into
// structured fields, so editing a posting pre-fills the dropdown sensibly.
function parseSalaryString(str) {
  const result = { currency: "PHP", customSymbol: "", amount: "", period: "month", unpaid: false };
  if (!str) return result;
  if (/unpaid|volunteer/i.test(str)) { result.unpaid = true; return result; }
  const match = str.match(/([\u20b1$\u20ac]|PHP|USD|EUR)?\s*([\d,]+(?:\.\d+)?)\s*\/?\s*(month|day|hour)?/i);
  if (!match) return result;
  const symbolOrCode = (match[1] || "").toUpperCase();
  const known = CURRENCY_OPTIONS.find((c) => c.symbol === match[1] || c.code === symbolOrCode);
  if (known && known.code !== "OTHER") {
    result.currency = known.code;
  } else if (match[1]) {
    result.currency = "OTHER";
    result.customSymbol = match[1];
  }
  result.amount = (match[2] || "").replace(/,/g, "");
  result.period = (match[3] || "month").toLowerCase();
  return result;
}

function resetPostingForm(existing) {
  if (existing) {
    postingFormState.id = existing.id;
    postingFormState.role = existing.role;
    postingFormState.location = existing.location;
    postingFormState.summary = existing.summary || "";
    postingFormState.description = existing.description || "";
    postingFormState.tags = [...existing.tags];
    const parsed = parseSalaryString(existing.salary);
    postingFormState.salaryCurrency = parsed.currency;
    postingFormState.salaryCustomSymbol = parsed.customSymbol;
    postingFormState.salaryAmount = parsed.amount;
    postingFormState.salaryPeriod = parsed.period;
    postingFormState.salaryUnpaid = parsed.unpaid;
  } else {
    postingFormState.id = null;
    postingFormState.role = "";
    postingFormState.location = "";
    postingFormState.summary = "";
    postingFormState.description = "";
    postingFormState.tags = [];
    postingFormState.salaryCurrency = "PHP";
    postingFormState.salaryCustomSymbol = "";
    postingFormState.salaryAmount = "";
    postingFormState.salaryPeriod = "month";
    postingFormState.salaryUnpaid = false;
  }
  postingFormState.tagInput = "";
}

// Composes the structured salary fields into the single display string
// stored in postings.salary (e.g. "\u20b18,000/month" or "Unpaid").
function composeSalaryString() {
  if (postingFormState.salaryUnpaid) return "Unpaid";
  if (!postingFormState.salaryAmount) return "";
  const opt = CURRENCY_OPTIONS.find((c) => c.code === postingFormState.salaryCurrency);
  const symbol = postingFormState.salaryCurrency === "OTHER"
    ? postingFormState.salaryCustomSymbol
    : (opt ? opt.symbol : "");
  const amountNum = Number(postingFormState.salaryAmount);
  const formattedAmount = Number.isFinite(amountNum) ? amountNum.toLocaleString() : postingFormState.salaryAmount;
  return `${symbol}${formattedAmount}/${postingFormState.salaryPeriod}`;
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
    salary: composeSalaryString(),
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
// Company: view applicants to one of their own postings
// ---------------------------------------------------------
let companyApplicants = []; // [{ id, status, applied_at, student: {...} }]
let applicantsForPostingId = null;

async function loadApplicantsForPosting(postingId) {
  applicantsForPostingId = postingId;
  const { data } = await sb
    .from("applications")
    .select("id, status, applied_at, resume_path, resume_filename, students(id, name, program, year_level, skills, interests, resume_path, resume_filename)")
    .eq("posting_id", postingId)
    .order("applied_at", { ascending: false });
  companyApplicants = (data || []).map((row) => {
    const s = row.students || {};
    return {
      id: row.id,
      status: row.status,
      appliedAt: row.applied_at,
      // Prefer a resume uploaded specifically for this application; fall back to the profile resume.
      student: {
        ...s,
        resume_path: row.resume_path || s.resume_path,
        resume_filename: row.resume_filename || s.resume_filename,
      },
    };
  });
}

// Opens a short-lived signed URL to an applicant's resume (private bucket).
async function viewResume(resumePath) {
  if (!resumePath) return;
  const { data, error } = await sb.storage.from("resumes").createSignedUrl(resumePath, 60);
  if (error || !data) {
    alert("Could not open resume: " + (error ? error.message : "unknown error"));
    return;
  }
  window.open(data.signedUrl, "_blank");
}

async function setApplicationStatus(applicationId, newStatus) {
  await sb.from("applications").update({ status: newStatus }).eq("id", applicationId);
  if (applicantsForPostingId) await loadApplicantsForPosting(applicantsForPostingId);
  if (state.session && state.session.role === "coordinator") await loadCoordinatorData();
  render();
}

// ---------------------------------------------------------
// Coordinator: read-only(ish) view across all applications
// ---------------------------------------------------------
let coordinatorApplications = []; // [{ id, status, appliedAt, student, posting }]

async function loadCoordinatorData() {
  const { data } = await sb
    .from("applications")
    .select("id, status, applied_at, resume_path, resume_filename, students(name, program, year_level, skills, resume_path, resume_filename), postings(role, company, location)")
    .order("applied_at", { ascending: false });
  coordinatorApplications = (data || []).map((row) => {
    const s = row.students || {};
    return {
      id: row.id,
      status: row.status,
      appliedAt: row.applied_at,
      student: {
        ...s,
        resume_path: row.resume_path || s.resume_path,
        resume_filename: row.resume_filename || s.resume_filename,
      },
      posting: row.postings || {},
    };
  });
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
  applicationStatus: {}, // { postingId: status } — real status from applications table
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

  if (state.session.role === "coordinator") {
    contentEl.appendChild(renderCoordinatorApp());
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

// Builds a logo box: a real uploaded image if logoUrl is set, otherwise
// the generated letter-avatar fallback. sizePx controls both dimensions
// and is used to scale the fallback letter's font size sensibly.
function logoElement(letter, logoUrl, sizePx, radiusPx) {
  const r = radiusPx || Math.round(sizePx * 0.28);
  const box = el("div", `width:${sizePx}px;height:${sizePx}px;border-radius:${r}px;background:#F4F4F4;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:${Math.round(sizePx * 0.4)}px;font-weight:700;color:#1B1B1B;overflow:hidden;`);
  if (logoUrl) {
    const img = el("img", "width:100%;height:100%;object-fit:cover;", { src: logoUrl, alt: "" });
    box.appendChild(img);
  } else {
    box.textContent = letter;
  }
  return box;
}

// Icon-only circular back/return arrow button (matches the one used
// on Posting Detail / Career Quiz), for consistent "return" affordance.
function backArrowButton(onClick) {
  const btn = el("button", "width:36px;height:36px;border-radius:10px;background:#F0F0F0;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#1B1B1B;flex-shrink:0;");
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6" /></svg>`;
  btn.addEventListener("click", onClick);
  return btn;
}

// Shimmering placeholder screen shown while the app/tab is loading real
// data, shaped like a feed of cards so it doesn't feel like a blank stall.
function skeletonFeedScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;padding:20px 24px;");
  const headerLine1 = el("div");
  headerLine1.className = "skeleton";
  headerLine1.style.cssText = "width:60%;height:14px;margin-bottom:10px;";
  const headerLine2 = el("div");
  headerLine2.className = "skeleton";
  headerLine2.style.cssText = "width:40%;height:20px;margin-bottom:24px;";
  root.appendChild(headerLine1);
  root.appendChild(headerLine2);

  for (let i = 0; i < 3; i++) {
    const card = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05);");
    const row = el("div", "display:flex;gap:12px;align-items:flex-start;");
    const avatar = el("div");
    avatar.className = "skeleton";
    avatar.style.cssText = "width:40px;height:40px;border-radius:10px;flex-shrink:0;";
    const lines = el("div", "flex:1;");
    const l1 = el("div"); l1.className = "skeleton"; l1.style.cssText = "width:50%;height:10px;margin-bottom:8px;";
    const l2 = el("div"); l2.className = "skeleton"; l2.style.cssText = "width:80%;height:14px;margin-bottom:8px;";
    const l3 = el("div"); l3.className = "skeleton"; l3.style.cssText = "width:65%;height:10px;";
    lines.appendChild(l1);
    lines.appendChild(l2);
    lines.appendChild(l3);
    row.appendChild(avatar);
    row.appendChild(lines);
    card.appendChild(row);
    root.appendChild(card);
  }
  return root;
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

const STOP_SHORT = new Set(["the", "and", "for", "are", "you", "your", "with", "our", "this", "that", "will"]);

// Explains *why* a posting scored the way it did: direct word overlaps
// (e.g. shared skill names) plus synonym-group matches (e.g. "IT" on
// the profile side matching "troubleshooting" on the posting side).
function getMatchBreakdown(posting) {
  const profileTokens = tokenize(profileText(profileState));
  const postingTokens = tokenize(postingText(posting));
  const profileSet = new Set(profileTokens);
  const postingSet = new Set(postingTokens);

  const directMatches = [...new Set(profileTokens.filter((t) =>
    t.length > 2 && !STOP_SHORT.has(t) && postingSet.has(t)
  ))].slice(0, 8);

  const profileGroups = new Set(expandWithSynonyms(profileTokens).filter((t) => t.startsWith("_group_")));
  const postingGroups = new Set(expandWithSynonyms(postingTokens).filter((t) => t.startsWith("_group_")));
  const sharedGroupCount = [...profileGroups].filter((g) => postingGroups.has(g)).length;

  return { directMatches, sharedGroupCount };
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
    [["student", "Student"], ["company", "Company"], ["coordinator", "Coordinator"]].forEach(([val, label]) => {
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
  "Healthcare", "Manufacturing", "Education", "Media & Entertainment",
];
const COMPANY_WORK_TYPES = ["On-site", "Hybrid", "Remote", "Flexible"];

function renderCompanyOnboardingScreen(isEdit) {
  const root = el("div", `flex:1;overflow-y:auto;background:#FAFAFA;display:flex;flex-direction:column;${isEdit ? "" : "padding:0 24px;"}`);
  const container = isEdit ? el("div", "padding:0 24px 24px;") : root;

  if (isEdit) {
    const backRow = el("div", "padding:16px 24px 0;");
    backRow.appendChild(backArrowButton(() => { state.companyView = "list"; render(); }));
    root.appendChild(backRow);
  }

  if (!isEdit) {
    const top = el("div", "padding:24px 0 0;");
    const backRow = el("div", "margin-bottom:16px;");
    backRow.appendChild(backArrowButton(signOut));
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

  // Company logo (public bucket — shows on postings/cards once uploaded)
  const logoField = el("div");
  logoField.appendChild(labelEl("Company Logo (optional)"));
  const logoRow = el("div", "display:flex;align-items:center;gap:12px;");
  const logoPreview = logoElement(companyProfileState.name.trim().charAt(0).toUpperCase() || "?", companyProfileState.logoUrl, 56, 14);
  logoRow.appendChild(logoPreview);

  if (companyProfileState.logoUploading) {
    const uploadingP = el("p", "font-size:12px;color:#8A8A8A;margin:0;");
    uploadingP.textContent = "Uploading\u2026";
    logoRow.appendChild(uploadingP);
  } else {
    const uploadLabel = el("label", "display:inline-flex;align-items:center;gap:6px;padding:9px 14px;background:#F0F0F0;border-radius:10px;cursor:pointer;color:#1B1B1B;font-size:12px;font-weight:600;");
    uploadLabel.textContent = companyProfileState.logoUrl ? "Replace Logo" : "Upload Logo";
    const logoInput = el("input", "display:none;", { type: "file", accept: "image/*" });
    logoInput.addEventListener("change", (e) => { if (e.target.files[0]) uploadCompanyLogo(e.target.files[0]); });
    uploadLabel.appendChild(logoInput);
    logoRow.appendChild(uploadLabel);
  }
  logoField.appendChild(logoRow);
  form.appendChild(logoField);

  // Industry (single select, with a manual type-in for anything not listed)
  const industryField = el("div");
  industryField.appendChild(labelEl("Industry"));
  const industryRow = el("div", "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;");
  const isCustomIndustry = companyProfileState.industry && !COMPANY_INDUSTRIES.includes(companyProfileState.industry);
  COMPANY_INDUSTRIES.forEach((ind) => {
    const active = companyProfileState.industry === ind;
    const btn = el("button", `padding:8px 14px;border-radius:20px;border:${active ? "none" : "1.5px solid #E8E8E8"};background:${active ? "#1D9E75" : "#FFFFFF"};color:${active ? "#FFFFFF" : "#1B1B1B"};font-size:12px;font-weight:${active ? 600 : 400};cursor:pointer;`);
    btn.textContent = ind;
    btn.addEventListener("click", () => { companyProfileState.industry = ind; render(); });
    industryRow.appendChild(btn);
  });
  if (isCustomIndustry) {
    const customChip = el("button", "padding:8px 14px;border-radius:20px;border:none;background:#1D9E75;color:#FFFFFF;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;");
    customChip.appendChild(document.createTextNode(companyProfileState.industry));
    const clearX = el("span", "font-size:14px;line-height:1;");
    clearX.textContent = "×";
    customChip.appendChild(clearX);
    customChip.addEventListener("click", () => { companyProfileState.industry = ""; render(); });
    industryRow.appendChild(customChip);
  }
  industryField.appendChild(industryRow);

  const customIndustryRow = el("div", "display:flex;align-items:center;gap:8px;");
  const customIndustryInput = el("input", inputStyleText() + "flex:1;");
  customIndustryInput.placeholder = "Not listed? Type your own industry...";
  customIndustryInput.value = companyProfileState.industryInput;
  customIndustryInput.id = "custom-industry-input";
  function addCustomIndustry(v) {
    const trimmed = (v || "").trim();
    if (trimmed) companyProfileState.industry = trimmed;
    companyProfileState.industryInput = "";
    render();
  }
  customIndustryInput.addEventListener("input", (e) => { companyProfileState.industryInput = e.target.value; });
  customIndustryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addCustomIndustry(customIndustryInput.value); }
  });
  const addIndustryBtn = el("button", "width:38px;height:38px;border-radius:10px;background:#1D9E75;border:none;cursor:pointer;color:#FFF;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;");
  addIndustryBtn.textContent = "+";
  addIndustryBtn.addEventListener("click", () => addCustomIndustry(customIndustryInput.value));
  customIndustryRow.appendChild(customIndustryInput);
  customIndustryRow.appendChild(addIndustryBtn);
  industryField.appendChild(customIndustryRow);

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
  const headLeft = el("div", "display:flex;align-items:center;gap:12px;");
  const headLogo = logoElement(companyName.trim().charAt(0).toUpperCase() || "?", companyLogoUrl, 44, 12);
  const headTextBlock = el("div");
  const nameH1 = el("h1", "font-size:20px;font-weight:700;color:#1B1B1B;margin:0;letter-spacing:-0.4px;");
  nameH1.textContent = companyName || "Company";
  const sub = el("p", "font-size:12px;color:#8A8A8A;margin:2px 0 0;");
  sub.textContent = `${companyProfileState.industry || "No industry set"} · ${companyListings.length} active listing${companyListings.length === 1 ? "" : "s"}`;
  headTextBlock.appendChild(nameH1);
  headTextBlock.appendChild(sub);
  headLeft.appendChild(headLogo);
  headLeft.appendChild(headTextBlock);
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

  if (state.companyView === "applicants") {
    root.appendChild(renderApplicantsScreen());
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
    const empty = el("div", "display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:50px;gap:10px;");
    const iconBox = el("div", "width:52px;height:52px;border-radius:16px;background:#F0F0F0;display:flex;align-items:center;justify-content:center;");
    iconBox.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ABABAB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`;
    const emptyText = el("p", "font-size:14px;color:#ABABAB;margin:0;text-align:center;");
    emptyText.textContent = "No listings yet. Students can't see you until you post one.";
    const postBtn = el("button", "margin-top:6px;padding:10px 20px;background:#1D9E75;border:none;border-radius:12px;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer;");
    postBtn.textContent = "+ Post Your First Listing";
    postBtn.addEventListener("click", () => {
      resetPostingForm(null);
      state.companyView = "form";
      render();
    });
    empty.appendChild(iconBox);
    empty.appendChild(emptyText);
    empty.appendChild(postBtn);
    content.appendChild(empty);
  }

  companyListings.forEach((p) => {
    const card = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");
    const roleH3 = el("h3", "font-size:15px;font-weight:600;color:#1B1B1B;margin:0 0 4px;letter-spacing:-0.2px;");
    roleH3.textContent = p.role;
    const locP = el("p", "font-size:12px;color:#8A8A8A;margin:0 0 12px;");
    locP.textContent = p.salary ? `${p.location} \u00b7 ${p.salary}` : p.location;

    const tagsRow = el("div", "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;");
    p.tags.forEach((t) => {
      const chip = el("span", "background:#F4F4F4;color:#1B1B1B;font-size:11px;padding:3px 9px;border-radius:20px;");
      chip.textContent = t;
      tagsRow.appendChild(chip);
    });

    const actionsRow = el("div", "display:flex;gap:8px;");
    const applicantsBtn = el("button", "flex:1;padding:9px 0;background:#E8F7F2;border:none;border-radius:10px;color:#1D9E75;font-size:12px;font-weight:600;cursor:pointer;");
    applicantsBtn.textContent = "Applicants";
    applicantsBtn.addEventListener("click", async () => {
      await loadApplicantsForPosting(p.id);
      state.companyView = "applicants";
      render();
    });
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
    actionsRow.appendChild(applicantsBtn);
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

  wrap.appendChild(backArrowButton(() => { state.companyView = "list"; render(); }));

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

  const salaryField = el("div");
  salaryField.appendChild(labelEl("Salary / Allowance (optional)"));

  const unpaidRow = el("label", "display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;font-size:13px;color:#1B1B1B;");
  const unpaidCheckbox = el("input", "", { type: "checkbox", checked: postingFormState.salaryUnpaid });
  unpaidCheckbox.addEventListener("change", (e) => { postingFormState.salaryUnpaid = e.target.checked; render(); });
  unpaidRow.appendChild(unpaidCheckbox);
  unpaidRow.appendChild(document.createTextNode("Unpaid / Volunteer"));
  salaryField.appendChild(unpaidRow);

  if (!postingFormState.salaryUnpaid) {
    const row = el("div", "display:flex;gap:8px;");

    const currencySelect = el("select", inputStyleText() + "flex:0 0 110px;");
    CURRENCY_OPTIONS.forEach((c) => {
      const opt = el("option", "", { value: c.code, textContent: c.label });
      if (c.code === postingFormState.salaryCurrency) opt.selected = true;
      currencySelect.appendChild(opt);
    });
    currencySelect.addEventListener("change", (e) => { postingFormState.salaryCurrency = e.target.value; render(); });
    row.appendChild(currencySelect);

    if (postingFormState.salaryCurrency === "OTHER") {
      const symbolInput = el("input", inputStyleText() + "flex:0 0 60px;");
      symbolInput.placeholder = "e.g. RM";
      symbolInput.value = postingFormState.salaryCustomSymbol;
      symbolInput.addEventListener("input", (e) => { postingFormState.salaryCustomSymbol = e.target.value; });
      row.appendChild(symbolInput);
    }

    const amountInput = el("input", inputStyleText() + "flex:1;");
    amountInput.type = "number";
    amountInput.placeholder = "e.g. 8000";
    amountInput.value = postingFormState.salaryAmount;
    amountInput.addEventListener("input", (e) => { postingFormState.salaryAmount = e.target.value; });
    row.appendChild(amountInput);

    const periodSelect = el("select", inputStyleText() + "flex:0 0 100px;");
    [["month", "/ month"], ["day", "/ day"], ["hour", "/ hour"]].forEach(([val, label]) => {
      const opt = el("option", "", { value: val, textContent: label });
      if (val === postingFormState.salaryPeriod) opt.selected = true;
      periodSelect.appendChild(opt);
    });
    periodSelect.addEventListener("change", (e) => { postingFormState.salaryPeriod = e.target.value; });
    row.appendChild(periodSelect);

    salaryField.appendChild(row);

    const preview = el("p", "font-size:12px;color:#8A8A8A;margin:8px 0 0;");
    preview.textContent = postingFormState.salaryAmount ? `Shown as: ${composeSalaryString()}` : "";
    salaryField.appendChild(preview);
  }

  wrap.appendChild(salaryField);

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

// ===========================================================
// Company: Applicants screen (per posting)
// ===========================================================
const APPLICANT_STATUS_STYLES = {
  "Pending": { bg: "#FFF8E6", color: "#D98A00" },
  "Under Review": { bg: "#EFF6FF", color: "#2563EB" },
  "Rejected": { bg: "#FFF0F0", color: "#DC2626" },
  "Approved by Coordinator": { bg: "#E8F7F2", color: "#1D9E75" },
};

function renderApplicantsScreen() {
  const wrap = el("div", "flex:1;overflow-y:auto;padding:0 24px 24px;display:flex;flex-direction:column;gap:12px;");

  const backRow = el("div", "padding-top:16px;margin-bottom:-4px;");
  backRow.appendChild(backArrowButton(() => { state.companyView = "list"; render(); }));
  wrap.appendChild(backRow);

  const title = el("h2", "font-size:18px;font-weight:700;color:#1B1B1B;margin:0;letter-spacing:-0.4px;");
  title.textContent = `Applicants (${companyApplicants.length})`;
  wrap.appendChild(title);

  if (companyApplicants.length === 0) {
    const empty = el("p", "text-align:center;color:#ABABAB;font-size:13px;margin-top:60px;");
    empty.textContent = "No one has applied to this posting yet.";
    wrap.appendChild(empty);
  }

  companyApplicants.forEach((app) => {
    const s = app.student || {};
    const style = APPLICANT_STATUS_STYLES[app.status] || APPLICANT_STATUS_STYLES["Pending"];
    const card = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");

    const topRow = el("div", "display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;");
    const nameH3 = el("h3", "font-size:14px;font-weight:600;color:#1B1B1B;margin:0;letter-spacing:-0.2px;");
    nameH3.textContent = s.name || "(no name set)";
    const statusChip = el("span", `font-size:10px;font-weight:600;color:${style.color};background:${style.bg};padding:3px 8px;border-radius:20px;flex-shrink:0;white-space:nowrap;`);
    statusChip.textContent = app.status;
    topRow.appendChild(nameH3);
    topRow.appendChild(statusChip);
    card.appendChild(topRow);

    const progP = el("p", "font-size:12px;color:#8A8A8A;margin:0 0 8px;");
    progP.textContent = `${s.program || "No program set"} · ${s.year_level || "—"} Year`;
    card.appendChild(progP);

    if (s.skills && s.skills.length > 0) {
      const skillsRow = el("div", "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;");
      s.skills.forEach((sk) => {
        const chip = el("span", "background:#F4F4F4;color:#1B1B1B;font-size:11px;padding:3px 9px;border-radius:20px;");
        chip.textContent = sk;
        skillsRow.appendChild(chip);
      });
      card.appendChild(skillsRow);
    }

    if (s.resume_path) {
      const resumeRow = el("button", "display:flex;align-items:center;gap:6px;background:#E8F7F2;border:none;border-radius:10px;padding:8px 12px;margin-bottom:12px;cursor:pointer;color:#1D9E75;font-size:12px;font-weight:600;width:100%;");
      resumeRow.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>View Resume${s.resume_filename ? " — " + s.resume_filename : ""}</span>`;
      resumeRow.addEventListener("click", () => viewResume(s.resume_path));
      card.appendChild(resumeRow);
    } else {
      const noResume = el("p", "font-size:11px;color:#ABABAB;margin:0 0 12px;");
      noResume.textContent = "No resume uploaded.";
      card.appendChild(noResume);
    }

    const actionsRow = el("div", "display:flex;gap:8px;");
    const reviewBtn = el("button", "flex:1;padding:9px 0;background:#EFF6FF;border:none;border-radius:10px;color:#2563EB;font-size:12px;font-weight:600;cursor:pointer;");
    reviewBtn.textContent = "Under Review";
    reviewBtn.addEventListener("click", () => setApplicationStatus(app.id, "Under Review"));
    const rejectBtn = el("button", "flex:1;padding:9px 0;background:#FFF0F0;border:none;border-radius:10px;color:#DC2626;font-size:12px;font-weight:600;cursor:pointer;");
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => setApplicationStatus(app.id, "Rejected"));
    actionsRow.appendChild(reviewBtn);
    actionsRow.appendChild(rejectBtn);
    card.appendChild(actionsRow);

    wrap.appendChild(card);
  });

  return wrap;
}

// ===========================================================
// Coordinator Dashboard — read across all applications, give
// final approval/rejection sign-off.
// ===========================================================
function renderCoordinatorApp() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  const header = el("div", "display:flex;align-items:center;justify-content:space-between;padding:20px 24px 12px;flex-shrink:0;");
  const headLeft = el("div");
  const h1 = el("h1", "font-size:20px;font-weight:700;color:#1B1B1B;margin:0;letter-spacing:-0.4px;");
  h1.textContent = "Coordinator Dashboard";
  const sub = el("p", "font-size:12px;color:#8A8A8A;margin:2px 0 0;");
  sub.textContent = `${coordinatorApplications.length} total application${coordinatorApplications.length === 1 ? "" : "s"}`;
  headLeft.appendChild(h1);
  headLeft.appendChild(sub);
  const signOutBtn = el("button", "background:none;border:none;color:#DC2626;font-size:12px;font-weight:600;cursor:pointer;padding:0;");
  signOutBtn.textContent = "Sign Out";
  signOutBtn.addEventListener("click", signOut);
  header.appendChild(headLeft);
  header.appendChild(signOutBtn);
  root.appendChild(header);

  const content = el("div", "flex:1;overflow-y:auto;padding:0 24px 20px;display:flex;flex-direction:column;gap:12px;");

  if (coordinatorApplications.length === 0) {
    const empty = el("p", "text-align:center;color:#ABABAB;font-size:13px;margin-top:60px;");
    empty.textContent = "No applications have come in yet.";
    content.appendChild(empty);
  }

  coordinatorApplications.forEach((app) => {
    const s = app.student || {};
    const p = app.posting || {};
    const style = APPLICANT_STATUS_STYLES[app.status] || APPLICANT_STATUS_STYLES["Pending"];
    const card = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");

    const topRow = el("div", "display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;");
    const nameH3 = el("h3", "font-size:14px;font-weight:600;color:#1B1B1B;margin:0;letter-spacing:-0.2px;");
    nameH3.textContent = s.name || "(no name set)";
    const statusChip = el("span", `font-size:10px;font-weight:600;color:${style.color};background:${style.bg};padding:3px 8px;border-radius:20px;flex-shrink:0;white-space:nowrap;`);
    statusChip.textContent = app.status;
    topRow.appendChild(nameH3);
    topRow.appendChild(statusChip);
    card.appendChild(topRow);

    const roleP = el("p", "font-size:12px;color:#1B1B1B;margin:0 0 2px;font-weight:500;");
    roleP.textContent = `${p.role || ""} · ${p.company || ""}`;
    const progP = el("p", "font-size:12px;color:#8A8A8A;margin:0 0 12px;");
    progP.textContent = `${s.program || "No program set"} · ${s.year_level || "—"} Year`;
    card.appendChild(roleP);
    card.appendChild(progP);

    if (s.resume_path) {
      const resumeRow = el("button", "display:flex;align-items:center;gap:6px;background:#E8F7F2;border:none;border-radius:10px;padding:8px 12px;margin-bottom:12px;cursor:pointer;color:#1D9E75;font-size:12px;font-weight:600;width:100%;");
      resumeRow.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>View Resume${s.resume_filename ? " — " + s.resume_filename : ""}</span>`;
      resumeRow.addEventListener("click", () => viewResume(s.resume_path));
      card.appendChild(resumeRow);
    }

    const actionsRow = el("div", "display:flex;gap:8px;");
    const approveBtn = el("button", "flex:1;padding:9px 0;background:#E8F7F2;border:none;border-radius:10px;color:#1D9E75;font-size:12px;font-weight:600;cursor:pointer;");
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => setApplicationStatus(app.id, "Approved by Coordinator"));
    const rejectBtn = el("button", "flex:1;padding:9px 0;background:#FFF0F0;border:none;border-radius:10px;color:#DC2626;font-size:12px;font-weight:600;cursor:pointer;");
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => setApplicationStatus(app.id, "Rejected"));
    actionsRow.appendChild(approveBtn);
    actionsRow.appendChild(rejectBtn);
    card.appendChild(actionsRow);

    content.appendChild(card);
  });

  root.appendChild(content);
  return root;
}

const SKILL_SUGGESTIONS = [
  "Web Development", "Python", "React", "SQL", "UI/UX Design",
  "Data Analysis", "Java", "Node.js", "Flutter", "Machine Learning",
  "Figma", "TypeScript", "REST APIs", "Tableau", "Git",
];

const onboardingState = {
  name: "",
  program: "",
  yearLevel: "",
  skills: ["Web Development", "Python"],
  skillInput: "",
  interests: "",
};

function renderOnboardingScreen() {
  const root = el("div", "flex:1;overflow-y:auto;background:#FAFAFA;display:flex;flex-direction:column;");

  const top = el("div", "padding:24px 24px 0;");

  const backRow = el("div", "margin-bottom:16px;");
  backRow.appendChild(backArrowButton(signOut));
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

  // Full name field
  const nameField = el("div");
  const nameLabel = labelEl("Full Name");
  const nameInput = el("input", inputStyleText());
  nameInput.placeholder = "e.g. Marco Reyes";
  nameInput.value = onboardingState.name;
  nameInput.addEventListener("input", (e) => { onboardingState.name = e.target.value; });
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);
  form.appendChild(nameField);

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
    profileState.name = onboardingState.name || profileState.name;
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
  card.className = "lift-card";
  card.addEventListener("click", () => {
    state.selectedPostingId = posting.id;
    resetApplyForm();
    render();
  });

  if (applied) {
    const badge = el("div", "position:absolute;top:12px;right:12px;background:#E8F7F2;color:#1D9E75;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;");
    badge.textContent = "Applied";
    card.appendChild(badge);
  }

  const row = el("div", "display:flex;align-items:flex-start;gap:12px;");
  const logo = logoElement(posting.logo, posting.logoUrl, 40, 10);

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
  if (posting.salary) {
    const salaryChip = el("p", "font-size:12px;color:#1D9E75;font-weight:600;margin:0 0 10px;");
    salaryChip.textContent = posting.salary;
    info.appendChild(salaryChip);
  }
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

// ---------------------------------------------------------
// Apply flow — lets the student choose their profile resume
// or upload one specifically for this application.
// ---------------------------------------------------------
const applyFormState = { useProfileResume: true, file: null, uploading: false };

function resetApplyForm() {
  applyFormState.useProfileResume = !!profileState.resumeFilename;
  applyFormState.file = null;
  applyFormState.uploading = false;
}

async function submitApplication(postingId) {
  let resumePath = null;
  let resumeFilename = null;

  if (!applyFormState.useProfileResume && applyFormState.file) {
    applyFormState.uploading = true;
    render();
    const path = `${studentId}/applications/${postingId}-${applyFormState.file.name}`;
    const { error } = await sb.storage
      .from("resumes")
      .upload(path, applyFormState.file, { upsert: true, contentType: "application/pdf" });
    if (error) {
      applyFormState.uploading = false;
      alert("Resume upload failed: " + error.message);
      render();
      return;
    }
    resumePath = path;
    resumeFilename = applyFormState.file.name;
  }

  state.appliedIds.add(postingId);
  state.selectedPostingId = null;
  applyFormState.uploading = false;
  render();

  if (!studentId) return;
  const payload = { student_id: studentId, posting_id: postingId };
  if (resumePath) {
    payload.resume_path = resumePath;
    payload.resume_filename = resumeFilename;
  }
  await sb.from("applications").upsert(payload, { onConflict: "student_id,posting_id" });
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
  const logo = logoElement(posting.logo, posting.logoUrl, 52, 14);
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
  if (posting.salary) {
    const salaryBadge = el("span", "font-size:11px;color:#1D9E75;font-weight:600;background:#E8F7F2;padding:5px 10px;border-radius:20px;");
    salaryBadge.textContent = posting.salary;
    row2.appendChild(salaryBadge);
  }
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

  // Why this match — visual breakdown behind the fit %
  const breakdown = getMatchBreakdown(posting);
  if (breakdown.directMatches.length > 0 || breakdown.sharedGroupCount > 0) {
    const card2b = el("div", "background:#FFFFFF;border-radius:16px;padding:18px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");
    const h3why = el("h3", "margin:0 0 12px;font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;");
    h3why.textContent = "Why This Match";
    card2b.appendChild(h3why);

    if (breakdown.directMatches.length > 0) {
      const label = el("p", "margin:0 0 8px;font-size:12px;color:#6A6A6A;");
      label.textContent = "Matched directly from your profile:";
      const chipRow = el("div", "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;");
      breakdown.directMatches.forEach((word) => {
        const chip = el("span", "display:inline-flex;align-items:center;gap:4px;background:#E8F7F2;color:#1D9E75;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;");
        chip.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>${word}`;
        chipRow.appendChild(chip);
      });
      card2b.appendChild(label);
      card2b.appendChild(chipRow);
    }

    if (breakdown.sharedGroupCount > 0) {
      const relatedNote = el("p", "margin:0;font-size:12px;color:#6A6A6A;display:flex;align-items:center;gap:6px;");
      relatedNote.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#D98A00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>+ ${breakdown.sharedGroupCount} related-skill match${breakdown.sharedGroupCount === 1 ? "" : "es"} (e.g. related tools/terms in the same field)`;
      card2b.appendChild(relatedNote);
    }

    content.appendChild(card2b);
  }

  // Description
  const card3 = el("div", "background:#FFFFFF;border-radius:16px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");
  const h3b = el("h3", "margin:0 0 10px;font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;");
  h3b.textContent = "About the Role";
  const descP = el("p", "margin:0;font-size:14px;color:#3A3A3A;line-height:1.65;");
  descP.textContent = posting.description;
  card3.appendChild(h3b);
  card3.appendChild(descP);
  content.appendChild(card3);

  // Resume for this application (only relevant before applying)
  if (!applied) {
    const resumeCard = el("div", "background:#FFFFFF;border-radius:16px;padding:18px 20px;margin-top:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);");
    const h3c = el("h3", "margin:0 0 10px;font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;");
    h3c.textContent = "Resume for This Application";
    resumeCard.appendChild(h3c);

    if (profileState.resumeFilename) {
      const optA = el("label", "display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:#F9F9F9;margin-bottom:8px;cursor:pointer;");
      const radioA = el("input", "", { type: "radio", name: "resumeChoice", checked: applyFormState.useProfileResume });
      radioA.addEventListener("change", () => { applyFormState.useProfileResume = true; render(); });
      const labelA = el("span", "font-size:13px;color:#1B1B1B;");
      labelA.textContent = `Use my profile resume (${profileState.resumeFilename})`;
      optA.appendChild(radioA);
      optA.appendChild(labelA);
      resumeCard.appendChild(optA);

      const optB = el("label", "display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:#F9F9F9;cursor:pointer;");
      const radioB = el("input", "", { type: "radio", name: "resumeChoice", checked: !applyFormState.useProfileResume });
      radioB.addEventListener("change", () => { applyFormState.useProfileResume = false; render(); });
      const labelB = el("span", "font-size:13px;color:#1B1B1B;");
      labelB.textContent = "Upload a different resume for this role";
      optB.appendChild(radioB);
      optB.appendChild(labelB);
      resumeCard.appendChild(optB);
    }

    if (!profileState.resumeFilename || !applyFormState.useProfileResume) {
      const uploadWrap = el("div", "margin-top:10px;");
      if (applyFormState.file) {
        const fileRow = el("div", "display:flex;align-items:center;gap:8px;background:#E8F7F2;border-radius:10px;padding:10px 12px;");
        fileRow.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        const fname = el("span", "font-size:13px;color:#1B1B1B;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
        fname.textContent = applyFormState.file.name;
        fileRow.appendChild(fname);
        uploadWrap.appendChild(fileRow);
      } else {
        const uploadLabel = el("label", "display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px;border:1.5px dashed #D9D9D9;border-radius:10px;cursor:pointer;color:#8A8A8A;");
        uploadLabel.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A8A8A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span style="font-size:12px;">Tap to upload a resume (PDF)</span>`;
        const fileInput = el("input", "display:none;", { type: "file", accept: "application/pdf" });
        fileInput.addEventListener("change", (e) => {
          if (e.target.files[0]) { applyFormState.file = e.target.files[0]; render(); }
        });
        uploadLabel.appendChild(fileInput);
        uploadWrap.appendChild(uploadLabel);
      }
      resumeCard.appendChild(uploadWrap);
    }

    content.appendChild(resumeCard);
  }

  root.appendChild(content);

  // Apply CTA
  const ctaWrap = el("div", "padding:12px 24px 20px;background:#FAFAFA;border-top:1px solid #EFEFEF;flex-shrink:0;");
  const canApply = applied || applyFormState.useProfileResume || !!applyFormState.file;
  const applyBtn = el("button", `width:100%;padding:15px;background:${applied ? "#E8F7F2" : "#1D9E75"};border:none;border-radius:14px;color:${applied ? "#1D9E75" : "#FFFFFF"};font-size:15px;font-weight:600;cursor:${applied || !canApply ? "default" : "pointer"};letter-spacing:-0.2px;transition:background 0.2s ease;opacity:${!applied && !canApply ? 0.5 : 1};`);
  if (applied) applyBtn.className = "pop-in";
  applyBtn.textContent = applied
    ? "\u2713 Application Submitted"
    : applyFormState.uploading
      ? "Uploading Resume\u2026"
      : "Apply Now";
  applyBtn.disabled = applied || !canApply || applyFormState.uploading;
  applyBtn.addEventListener("click", () => {
    if (!applied && canApply) submitApplication(posting.id);
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
  "Rejected": { bg: "#FFF0F0", color: "#DC2626" },
  "Saved": { bg: "#F4F4F4", color: "#8A8A8A" },
};

function renderMatchesScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  const appliedPostings = POSTINGS.filter((p) => state.appliedIds.has(p.id)).map((p) => ({
    ...p,
    status: state.applicationStatus[p.id] || "Pending",
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
    emptyText.innerHTML = "No applications yet.<br />Apply to postings that fit your skills.";
    const browseBtn = el("button", "margin-top:6px;padding:10px 20px;background:#1D9E75;border:none;border-radius:12px;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer;");
    browseBtn.textContent = "Browse Postings \u2192";
    browseBtn.addEventListener("click", () => { state.activeTab = "home"; render(); });
    empty.appendChild(iconBox);
    empty.appendChild(emptyText);
    empty.appendChild(browseBtn);
    list.appendChild(empty);
  } else {
    allMatches.forEach((match) => {
      const cfg = STATUS_CONFIG[match.status];
      const row = el("div", "background:#FFFFFF;border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);cursor:pointer;display:flex;align-items:center;gap:12px;");
      row.addEventListener("click", () => {
        state.selectedPostingId = match.id;
        resetApplyForm();
        render();
      });

      const logo = logoElement(match.logo, match.logoUrl, 40, 10);

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
  name: "",
  skills: [],
  skillInput: "",
  interests: "",
  program: "",
  yearLevel: "",
  saved: false,
  resumeFilename: "",
  resumeUploading: false,
};

function renderProfileScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");

  // Header
  const header = el("div", "padding:20px 24px 16px;flex-shrink:0;");
  const headRow = el("div", "display:flex;align-items:center;gap:14px;margin-bottom:20px;");
  const avatar = el("div", "width:52px;height:52px;border-radius:16px;background:#1D9E75;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#FFFFFF;");
  const avatarSource = profileState.name || (state.session && state.session.email) || "S";
  avatar.textContent = avatarSource.charAt(0).toUpperCase();
  const nameBlock = el("div");
  const nameH2 = el("h2", "margin:0;font-size:18px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;");
  nameH2.textContent = profileState.name || (state.session && state.session.email) || "My Profile";
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

  // Full name (editable — fills in "(no name set)" gap on the company side)
  const nameCard = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);");
  const nameFieldLabel = el("label", "display:block;font-size:11px;font-weight:600;color:#8A8A8A;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:10px;");
  nameFieldLabel.textContent = "Full Name";
  const nameFieldInput = el("input", "width:100%;border:1.5px solid #EFEFEF;border-radius:10px;padding:10px 12px;font-size:13px;color:#1B1B1B;outline:none;background:#FAFAFA;box-sizing:border-box;");
  nameFieldInput.placeholder = "e.g. Marco Reyes";
  nameFieldInput.value = profileState.name;
  nameFieldInput.addEventListener("input", (e) => {
    profileState.name = e.target.value;
    profileState.saved = false;
  });
  nameCard.appendChild(nameFieldLabel);
  nameCard.appendChild(nameFieldInput);
  content.appendChild(nameCard);

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

  // Resume upload
  const resumeCard = el("div", "background:#FFFFFF;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);");
  const resumeLabel = el("label", "display:block;font-size:11px;font-weight:600;color:#8A8A8A;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:10px;");
  resumeLabel.textContent = "Resume (PDF)";
  resumeCard.appendChild(resumeLabel);

  if (profileState.resumeUploading) {
    const uploadingP = el("p", "font-size:13px;color:#8A8A8A;margin:0;");
    uploadingP.textContent = "Uploading\u2026";
    resumeCard.appendChild(uploadingP);
  } else if (profileState.resumeFilename) {
    const fileRow = el("div", "display:flex;align-items:center;justify-content:space-between;background:#F9F9F9;border-radius:10px;padding:10px 12px;border:1.5px solid #EFEFEF;");
    const fileInfo = el("div", "display:flex;align-items:center;gap:8px;min-width:0;");
    fileInfo.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const fileName = el("span", "font-size:13px;color:#1B1B1B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
    fileName.textContent = profileState.resumeFilename;
    fileInfo.appendChild(fileName);
    const removeBtn = el("button", "background:none;border:none;cursor:pointer;color:#DC2626;font-size:12px;font-weight:600;flex-shrink:0;");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", removeResume);
    fileRow.appendChild(fileInfo);
    fileRow.appendChild(removeBtn);
    resumeCard.appendChild(fileRow);

    const replaceLabel = el("label", "display:inline-block;margin-top:10px;font-size:12px;color:#1D9E75;font-weight:600;cursor:pointer;");
    replaceLabel.textContent = "Replace resume";
    const replaceInput = el("input", "display:none;", { type: "file", accept: "application/pdf" });
    replaceInput.addEventListener("change", (e) => { if (e.target.files[0]) uploadResume(e.target.files[0]); });
    replaceLabel.appendChild(replaceInput);
    resumeCard.appendChild(replaceLabel);
  } else {
    const uploadLabel = el("label", "display:flex;flex-direction:column;align-items:center;gap:6px;padding:20px;border:1.5px dashed #D9D9D9;border-radius:10px;cursor:pointer;color:#8A8A8A;");
    uploadLabel.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A8A8A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span style="font-size:12px;">Tap to upload your resume (PDF)</span>`;
    const uploadInput = el("input", "display:none;", { type: "file", accept: "application/pdf" });
    uploadInput.addEventListener("change", (e) => { if (e.target.files[0]) uploadResume(e.target.files[0]); });
    uploadLabel.appendChild(uploadInput);
    resumeCard.appendChild(uploadLabel);
  }
  content.appendChild(resumeCard);

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
// ---------------------------------------------------------
// Real notifications (fetched from the DB, generated by
// triggers on application-status changes and new postings)
// ---------------------------------------------------------
let notifications = [];

async function loadNotifications() {
  if (!studentId) return;
  const { data } = await sb
    .from("notifications")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(50);
  notifications = data || [];
}

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

async function markNotificationRead(id) {
  const notif = notifications.find((n) => n.id === id);
  if (!notif || notif.read) return;
  notif.read = true; // optimistic
  render();
  await sb.from("notifications").update({ read: true }).eq("id", id);
}

function renderNotificationsScreen() {
  const root = el("div", "display:flex;flex-direction:column;height:100%;background:#FAFAFA;");
  const unread = notifications.filter((n) => !n.read).length;

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

  if (notifications.length === 0) {
    const empty = el("p", "text-align:center;color:#ABABAB;font-size:13px;margin-top:60px;");
    empty.textContent = "No notifications yet.";
    list.appendChild(empty);
  }

  notifications.forEach((notif) => {
    const card = el("div", `background:${notif.read ? "#FFFFFF" : "#FAFFF9"};border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);display:flex;gap:12px;align-items:flex-start;border-left:${notif.read ? "none" : "3px solid #1D9E75"};cursor:pointer;`);
    card.addEventListener("click", () => markNotificationRead(notif.id));

    const iconBox = el("div", `width:36px;height:36px;border-radius:10px;background:${notif.icon_bg};display:flex;align-items:center;justify-content:center;font-size:14px;color:${notif.icon_color};font-weight:700;flex-shrink:0;`);
    iconBox.textContent = notif.icon;

    const info = el("div", "flex:1;min-width:0;");
    const topRow = el("div", "display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px;");
    const titleSpan = el("span", `font-size:13px;font-weight:${notif.read ? 500 : 600};color:#1B1B1B;letter-spacing:-0.1px;`);
    titleSpan.textContent = notif.title;
    topRow.appendChild(titleSpan);
    if (!notif.read) {
      const dot = el("div", "width:6px;height:6px;border-radius:50%;background:#1D9E75;flex-shrink:0;margin-top:4px;margin-left:6px;");
      dot.className = "pulse-dot";
      topRow.appendChild(dot);
    }
    const bodyP = el("p", "margin:0 0 6px;font-size:12px;color:#6A6A6A;line-height:1.5;");
    bodyP.textContent = notif.body;
    const timeSpan = el("span", "font-size:11px;color:#ABABAB;");
    timeSpan.textContent = timeAgo(notif.created_at);

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
// Career Quiz — MBTI-style forced-choice ("would you rather")
// pairing every combination of the 4 work styles (Engineering,
// Data, Design, Business), so each style appears in exactly 3
// of the 6 questions — a clean round-robin tally instead of a
// single 4-option pick. The final analysis is AI-generated (via
// the "career-ai" Supabase Edge Function, proxying to Groq) when
// available, falling back to the raw tally + FIELD_INFO if the
// AI call fails or isn't deployed yet.
// ===========================================================
const STATIC_QUIZ_QUESTIONS = [
  { q: "Would you rather...", options: [
    { text: "Build the system that processes information", field: "Engineering" },
    { text: "Uncover the patterns hidden inside it", field: "Data" },
  ] },
  { q: "Would you rather...", options: [
    { text: "Make something work perfectly under the hood", field: "Engineering" },
    { text: "Make something look and feel intuitive to use", field: "Design" },
  ] },
  { q: "Would you rather...", options: [
    { text: "Write the code that automates a process", field: "Engineering" },
    { text: "Manage the people and plan behind that process", field: "Business" },
  ] },
  { q: "Would you rather...", options: [
    { text: "Explain a trend using numbers", field: "Data" },
    { text: "Explain it using a visual you designed", field: "Design" },
  ] },
  { q: "Would you rather...", options: [
    { text: "Dig into a spreadsheet to find the answer", field: "Data" },
    { text: "Coordinate the team that acts on the answer", field: "Business" },
  ] },
  { q: "Would you rather...", options: [
    { text: "Craft how something looks and feels", field: "Design" },
    { text: "Organize how a project gets delivered", field: "Business" },
  ] },
  { q: "Would you rather...", options: [
    { text: "Fix a bug in the codebase", field: "Engineering" },
    { text: "Find the reason a metric suddenly dropped", field: "Data" },
  ] },
  { q: "Would you rather...", options: [
    { text: "Perfect the visual details of a screen", field: "Design" },
    { text: "Plan out the milestones for shipping it", field: "Business" },
  ] },
];

const FIELD_INFO = {
  Engineering: { label: "Software Engineering / IT", office: "Engineering / IT Support office", desc: "You lean toward building, fixing, and supporting technical systems. Look at software, mobile, or IT/helpdesk roles." },
  Data: { label: "Data & Analytics", office: "Data / Analytics office", desc: "You lean toward numbers and patterns. Look at data analyst, BI, or ML-adjacent roles." },
  Design: { label: "UI/UX Design", office: "Design / Product team", desc: "You lean toward how things look and feel. Look at product or UI/UX design roles." },
  Business: { label: "Business Operations", office: "Business/Ops or PM office", desc: "You lean toward organizing people and process. Look at ops, PM, or coordinator roles." },
};

// When questions come from AI, the "field" names are whatever specific
// paths it invented from the student's skills (not necessarily one of
// the 4 static keys above) — build a sensible generic description on
// the fly if we don't have a canned one.
function getFieldInfo(fieldName) {
  if (FIELD_INFO[fieldName]) return FIELD_INFO[fieldName];
  return {
    label: fieldName,
    office: "Related department/office",
    desc: `Your answers leaned most toward ${fieldName}. Look for postings and offices related to this path.`,
  };
}

const quizState = {
  index: 0,
  questions: STATIC_QUIZ_QUESTIONS, // replaced with AI-tailored questions when available
  picks: [],           // { text, field } per question, for the AI prompt / profile enrichment
  tallies: {},         // { [field]: n } — built dynamically from whatever fields appear
  done: false,
  resultField: null,   // fallback (tally-based) result
  aiAnalysis: null,    // { recommended_path, confidence, reasoning, alternative_paths, skills_to_develop }
  loadingQuestions: false,
  analyzing: false,
};

// Calls the career-ai edge function. Returns null on any failure so
// callers can fall back to the tally-based behavior.
async function callCareerAI(action, extra) {
  try {
    const { data, error } = await sb.functions.invoke("career-ai", {
      body: {
        action,
        profile: {
          program: profileState.program,
          yearLevel: profileState.yearLevel,
          skills: profileState.skills,
          interests: profileState.interests,
        },
        ...extra,
      },
    });
    if (error) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Basic sanity check on AI-generated questions before trusting them.
function isValidAIQuestionSet(questions) {
  return Array.isArray(questions) && questions.length >= 4 && questions.every((q) =>
    q && typeof q.q === "string" &&
    Array.isArray(q.options) && q.options.length === 2 &&
    q.options.every((o) => o && typeof o.text === "string" && typeof o.field === "string")
  );
}

async function startQuiz() {
  quizState.index = 0;
  quizState.questions = STATIC_QUIZ_QUESTIONS;
  quizState.picks = [];
  quizState.tallies = {};
  quizState.done = false;
  quizState.resultField = null;
  quizState.aiAnalysis = null;
  quizState.analyzing = false;
  quizState.loadingQuestions = true;
  state.showQuiz = true;
  render();

  // Ask the AI to tailor the "would you rather" pairs to the student's
  // own skills/program, so the paths being compared are specific to
  // them instead of always the same 4 generic buckets.
  const ai = await callCareerAI("generate_questions");
  if (ai && isValidAIQuestionSet(ai.questions)) {
    quizState.questions = ai.questions;
  }
  quizState.loadingQuestions = false;
  render();
}

async function pickQuizOption(option) {
  quizState.tallies[option.field] = (quizState.tallies[option.field] || 0) + 1;
  quizState.picks.push({ text: option.text, field: option.field });

  if (quizState.index < quizState.questions.length - 1) {
    quizState.index += 1;
    render();
    return;
  }

  quizState.analyzing = true;
  render();

  // Dominant field from the round-robin tally (ties broken by first-seen order).
  const sorted = Object.entries(quizState.tallies).sort((a, b) => b[1] - a[1]);
  quizState.resultField = sorted[0][0];

  const ai = await callCareerAI("analyze", { traits: quizState.tallies, picks: quizState.picks });
  if (ai && ai.analysis && ai.analysis.recommended_path) {
    quizState.aiAnalysis = ai.analysis;
  }

  // Fold the picked statements into the student's profile so the main
  // TF-IDF matching engine (postings feed, fit %) reflects it too.
  const combined = quizState.picks.map((p) => p.text).join(". ");
  const existing = profileState.interests || "";
  profileState.interests = existing ? `${existing} ${combined}` : combined;
  recomputeMatches();
  persistProfile();

  quizState.done = true;
  quizState.analyzing = false;
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
      const undone = quizState.picks.pop(); // undo that question's tally
      if (undone) quizState.tallies[undone.field] -= 1;
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

  if (quizState.loadingQuestions) {
    const loadingP = el("p", "text-align:center;color:#ABABAB;font-size:13px;margin-top:80px;");
    loadingP.textContent = "Tailoring questions to your skills\u2026";
    content.appendChild(loadingP);
  } else if (!quizState.done) {
    const q = quizState.questions[quizState.index];

    const barTrack = el("div", "width:100%;height:6px;background:#EFEFEF;border-radius:3px;margin-bottom:10px;overflow:hidden;");
    const barFill = el("div", `height:100%;background:#1D9E75;border-radius:3px;width:${((quizState.index) / quizState.questions.length) * 100}%;transition:width 0.2s ease;`);
    barTrack.appendChild(barFill);
    content.appendChild(barTrack);

    const progress = el("p", "font-size:12px;color:#8A8A8A;margin:0 0 8px;");
    progress.textContent = `Question ${quizState.index + 1} of ${quizState.questions.length}`;
    const qTitle = el("h2", "font-size:19px;font-weight:700;color:#1B1B1B;letter-spacing:-0.4px;margin:0 0 20px;");
    qTitle.textContent = quizState.analyzing ? "Analyzing your results\u2026" : q.q;
    content.appendChild(progress);
    content.appendChild(qTitle);

    if (!quizState.analyzing) {
      const optWrap = el("div", "display:flex;flex-direction:column;gap:12px;");
      q.options.forEach((opt) => {
        const btn = el("button", "text-align:left;padding:18px 16px;background:#FFFFFF;border:1.5px solid #E8E8E8;border-radius:14px;font-size:14px;color:#1B1B1B;cursor:pointer;line-height:1.4;");
        btn.textContent = opt.text;
        btn.addEventListener("mouseenter", () => { btn.style.borderColor = "#1D9E75"; });
        btn.addEventListener("mouseleave", () => { btn.style.borderColor = "#E8E8E8"; });
        btn.addEventListener("click", () => pickQuizOption(opt));
        optWrap.appendChild(btn);
      });
      content.appendChild(optWrap);
    }
  } else {
    const badge = el("div", "width:56px;height:56px;border-radius:16px;background:#E8F7F2;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:16px;");
    badge.textContent = "\u2726";
    content.appendChild(badge);

    if (quizState.aiAnalysis) {
      const a = quizState.aiAnalysis;
      const resultLabel = el("p", "font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 6px;");
      resultLabel.textContent = `Your best fit \u00b7 ${(a.confidence || "medium").toUpperCase()} confidence`;
      const resultTitle = el("h2", "font-size:22px;font-weight:700;color:#1B1B1B;letter-spacing:-0.5px;margin:0 0 10px;");
      resultTitle.textContent = a.recommended_path;
      const descP = el("p", "font-size:14px;color:#3A3A3A;line-height:1.6;margin:0 0 16px;");
      descP.textContent = a.reasoning || "";
      content.appendChild(resultLabel);
      content.appendChild(resultTitle);
      content.appendChild(descP);

      if (Array.isArray(a.alternative_paths) && a.alternative_paths.length > 0) {
        const altLabel = el("p", "font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;");
        altLabel.textContent = "Also worth considering";
        const altRow = el("div", "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;");
        a.alternative_paths.forEach((alt) => {
          const chip = el("span", "background:#F4F4F4;color:#1B1B1B;font-size:12px;padding:5px 12px;border-radius:20px;");
          chip.textContent = alt;
          altRow.appendChild(chip);
        });
        content.appendChild(altLabel);
        content.appendChild(altRow);
      }

      if (Array.isArray(a.skills_to_develop) && a.skills_to_develop.length > 0) {
        const skillLabel = el("p", "font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;");
        skillLabel.textContent = "Skills to develop";
        const skillRow = el("div", "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px;");
        a.skills_to_develop.forEach((sk) => {
          const chip = el("span", "background:#E8F7F2;color:#1D9E75;font-size:12px;font-weight:500;padding:5px 12px;border-radius:20px;");
          chip.textContent = sk;
          skillRow.appendChild(chip);
        });
        content.appendChild(skillLabel);
        content.appendChild(skillRow);
      }
    } else {
      const top = quizState.resultField;
      const info = getFieldInfo(top);
      const resultLabel = el("p", "font-size:12px;font-weight:600;color:#8A8A8A;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 6px;");
      resultLabel.textContent = "Your best fit";
      const resultTitle = el("h2", "font-size:22px;font-weight:700;color:#1B1B1B;letter-spacing:-0.5px;margin:0 0 10px;");
      resultTitle.textContent = info.label;
      const officeP = el("p", "font-size:13px;color:#1D9E75;font-weight:600;margin:0 0 12px;");
      officeP.textContent = `Go to: ${info.office}`;
      const descP = el("p", "font-size:14px;color:#3A3A3A;line-height:1.6;margin:0 0 24px;");
      descP.textContent = info.desc;
      content.appendChild(resultLabel);
      content.appendChild(resultTitle);
      content.appendChild(officeP);
      content.appendChild(descP);
    }

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
    btn.addEventListener("click", async () => {
      state.activeTab = tab.id;
      if (tab.id === "notifications") {
        await loadNotifications();
      }
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
contentEl.innerHTML = "";
contentEl.appendChild(skeletonFeedScreen());
sb.auth.signOut().finally(() => {
  studentId = null;
  companyId = null;
  state.session = null;
  render();
});