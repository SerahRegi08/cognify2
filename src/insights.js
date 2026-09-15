// Teacher briefing engine: improvement, focus students and per-class notes,
// all computed from real scan data (classes + per-student history).
const { read } = require('./store');

const LEVEL_ORDER = { below: 0, average: 1, above: 2 };
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function trendOf(entries) {
  const levels = entries
    .filter((e) => e.performanceLevel in LEVEL_ORDER)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .map((e) => e.performanceLevel);
  if (levels.length < 2) return 'new';
  const last = levels[levels.length - 1];
  const prev = levels[levels.length - 2];
  if (LEVEL_ORDER[last] > LEVEL_ORDER[prev]) return 'improving';
  if (LEVEL_ORDER[last] < LEVEL_ORDER[prev]) return 'declining';
  return 'stable';
}

function buildSnapshot() {
  const classes = read('classes.json', []);
  const historyAll = read('students.json', {});
  return classes
    .map((c) => {
      const students = (c.studentsList || [])
        .filter((s) => s.performanceLevel || s.insights)
        .map((s) => {
          const prefix = `${c.id}|||${norm(s.name)}|||`;
          const legacy = `${c.id}|||${norm(s.name)}`;
          let entries = [];
          Object.entries(historyAll).forEach(([key, list]) => {
            if (key === legacy || key.startsWith(prefix)) {
              entries = entries.concat(Array.isArray(list) ? list : []);
            }
          });
          entries.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
          const weak = [...new Set([...(s.weakTopics || []), ...entries.flatMap((e) => e.weakTopics || [])])].slice(0, 6);
          return {
            name: s.name,
            level: s.performanceLevel || 'average',
            trend: trendOf(entries),
            papers: entries.length,
            specialCare: Boolean(s.specialCare),
            weakTopics: weak,
          };
        });
      return { classId: c.id, className: c.name, students };
    })
    .filter((c) => c.students.length > 0);
}

function templateBriefing(snapshot) {
  if (snapshot.length === 0) {
    return {
      summary: 'No scanned papers yet. Scan student work and this briefing will track improvement, focus students and class patterns automatically.',
      focusStudents: [],
      classNotes: [],
      recommendations: ['Scan a first round of papers to establish baselines.'],
      aiGenerated: false,
    };
  }
  const focusStudents = [];
  const classNotes = [];
  snapshot.forEach((c) => {
    const declining = c.students.filter((s) => s.trend === 'declining');
    const below = c.students.filter((s) => s.level === 'below');
    const improving = c.students.filter((s) => s.trend === 'improving');
    declining.forEach((s) =>
      focusStudents.push({ name: s.name, className: c.className, level: s.level, trend: s.trend, reason: 'Declining across recent papers — needs immediate focus' })
    );
    below
      .filter((s) => s.trend !== 'declining')
      .forEach((s) =>
        focusStudents.push({ name: s.name, className: c.className, level: s.level, trend: s.trend, reason: 'Below average — needs focused support' })
      );
    const freq = {};
    c.students.forEach((s) => s.weakTopics.forEach((t) => { freq[t] = (freq[t] || 0) + 1; }));
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    classNotes.push({
      className: c.className,
      note:
        `${c.students.length} scanned student${c.students.length > 1 ? 's' : ''}` +
        (improving.length > 0 ? `, ${improving.length} improving` : '') +
        (declining.length > 0 ? `, ${declining.length} declining` : '') +
        (top ? `. Most shared weakness: ${top[0]} (${top[1]} student${top[1] > 1 ? 's' : ''}).` : '.'),
    });
  });
  const total = snapshot.reduce((n, c) => n + c.students.length, 0);
  const decliningTotal = snapshot.reduce((n, c) => n + c.students.filter((s) => s.trend === 'declining').length, 0);
  return {
    summary: `${total} scanned students across ${snapshot.length} class${snapshot.length > 1 ? 'es' : ''}.` +
      (decliningTotal > 0 ? ` ${decliningTotal} declining — see focus list.` : ' No declining trends right now.'),
    focusStudents: focusStudents.slice(0, 12),
    classNotes,
    recommendations: [
      'Give targeted worksheets to the focus list first.',
      'Re-scan after two weeks to confirm movement.',
    ],
    aiGenerated: false,
  };
}

async function generateWithMistral(snapshot) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  const model = process.env.MISTRAL_TEXT_MODEL || 'mistral-small-latest';

  const brief = snapshot
    .map((c) =>
      `Class ${c.className}:\n` +
      c.students
        .map((s) => `- ${s.name}: level=${s.level}, trend=${s.trend}, specialCare=${s.specialCare}, weak=[${s.weakTopics.join('; ') || 'none listed'}]`)
        .join('\n')
    )
    .join('\n\n');

  const prompt = `You are Cognify, an AI assistant for a school teacher. Below is real assessment data from scanned student papers.

${brief}

Write a teacher briefing note. Be concrete: name names, name classes, name topics.
Return ONLY valid JSON: { "summary": "2-3 sentence overall verdict on improvement across classes", "focusStudents": [{ "name": string, "className": string, "level": string, "trend": string, "reason": string }], "classNotes": [{ "className": string, "note": string }], "recommendations": ["concrete next step 1", "concrete next step 2"] }
Rules: focus list = declining students first, then below-average; max 12. Every claim must trace to the data above — never invent students, classes or topics.`;

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI service error (${res.status})`);
  const data = await res.json();
  const out = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  if (!out.summary || !Array.isArray(out.focusStudents)) throw new Error('Bad briefing shape');
  return { ...out, aiGenerated: true };
}

async function generateInsights() {
  const snapshot = buildSnapshot();
  if (snapshot.length === 0) return { ...templateBriefing(snapshot), generatedAt: Date.now() };
  try {
    const ai = await generateWithMistral(snapshot);
    if (ai) return { ...ai, generatedAt: Date.now() };
  } catch (err) {
    console.error('Insights AI failed, using template:', err.message);
  }
  return { ...templateBriefing(snapshot), generatedAt: Date.now() };
}

module.exports = { generateInsights };
