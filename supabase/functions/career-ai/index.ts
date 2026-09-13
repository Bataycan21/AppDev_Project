import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Set this in Supabase: Project Settings → Edge Functions → Secrets → GROQ_API_KEY
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const GROQ_MODEL = "llama-3.3-70b-versatile"; // adjust to whichever Groq model you prefer

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callGroq(messages: unknown[]) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.4 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Groq sometimes wraps JSON in ```json fences — strip them before parsing.
function extractJson(text: string) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GROQ_API_KEY is not configured on the server." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { action, profile, traits, picks } = await req.json();

    if (action === "generate_questions") {
      const content = await callGroq([
        {
          role: "system",
          content:
            "You are a career counselor for college students choosing an OJT/internship path. " +
            "Given the student's profile (program, skills, interests), invent 3-5 specific, relevant " +
            "professional paths for someone with THIS skillset (e.g. if they list React/CSS, use paths " +
            "like \"Frontend Development\" vs \"Backend Development\", not generic categories). " +
            "Then generate exactly 8 forced-choice \"would you rather\" question pairs comparing those " +
            "paths against each other (round-robin style, covering as many distinct pairs as possible, " +
            "repeating a pair with a different scenario if needed to reach 8). " +
            "Each option must be a short, concrete statement of a task (not a job title) representing " +
            "one of the paths. If the student's skills are empty or too generic to specialize, fall back " +
            "to broad paths: Engineering, Data, Design, Business. " +
            'Respond with ONLY a JSON array like: [{"q": "Would you rather...", "options": ' +
            '[{"text": "statement", "field": "Path Name"}, {"text": "statement", "field": "Path Name"}]}]. ' +
            "Exactly 8 items, exactly 2 options per item. No prose, no markdown fences, no extra keys.",
        },
        { role: "user", content: `Student profile: ${JSON.stringify(profile)}` },
      ]);
      const questions = extractJson(content);
      return new Response(JSON.stringify({ questions }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "analyze") {
      const content = await callGroq([
        {
          role: "system",
          content:
            "You are a career counselor analyzing a college student's OJT/internship direction. " +
            "The student answered 8 forced-choice \"would you rather\" questions comparing several " +
            "possible professional paths (these may be broad categories or specific paths tailored to " +
            "their own skills). You are given their tally per path (higher = stronger lean) and the " +
            "exact statements they picked. " +
            "Given their profile, tallies, and picks, respond with ONLY a JSON object like: " +
            '{"recommended_path": "specific job title", "confidence": "low|medium|high", ' +
            '"reasoning": "2-3 sentences", "alternative_paths": ["title1","title2"], ' +
            '"skills_to_develop": ["skill1","skill2"]}. ' +
            "recommended_path must be a specific role (e.g. \"Backend Developer\", \"Data Analyst\", " +
            "\"QA Engineer\"), not a broad category. Use the tallies as the primary signal, and the " +
            "picked statements plus profile (skills/interests/program) to sharpen it into a specific " +
            "role rather than just the broad category. No prose, no markdown fences, no extra keys.",
        },
        {
          role: "user",
          content: `Profile: ${JSON.stringify(profile)}\n\nTallies: ${JSON.stringify(traits)}\n\nPicked statements: ${JSON.stringify(picks)}`,
        },
      ]);
      const analysis = extractJson(content);
      return new Response(JSON.stringify({ analysis }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});