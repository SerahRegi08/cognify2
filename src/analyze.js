// Cognify paper-analysis engine.
// Classification is PERFORMANCE based (what the paper shows), never marks.

const RUBRIC = `
You are Cognify, an AI that evaluates a student's answer paper from its photo or PDF.
Classify the student into exactly one level using ONLY these conditions:

- BELOW AVERAGE when the student struggles remembering definitions,
  no numericals are done correctly, no formulas are written,
  and paper presentation is bad.
- AVERAGE when the student knows basic definitions, knows how to do
  numericals but misses several points in between, can't answer
  higher-order questions, but knows the basics of the subject.
- ABOVE AVERAGE when the student knows everything thoroughly and
  struggles only with certain topics and careless mistakes.

Return ONLY valid JSON with this exact shape:
{
  "isPaper": true or false (false if the image is NOT a student answer paper at all),
  "performanceLevel": "below" | "average" | "above",
  "insights": "2-3 sentence summary of where the student needs help",
  "supportNeeds": ["short support area 1", "short support area 2"],
  "specialCare": true or false (true mainly for below average),
  "numericalsNeedSupport": true or false,
  "weakTopics": ["topic names the student struggles with"],
  "strengths": ["what the student does well"],
  "recommendations": ["concrete next step 1", "concrete next step 2"],
  "evidence": ["exact short line you read from the paper", "another exact line"]
}

HONESTY RULES — follow strictly:
1. If the image is not a student answer paper (wrong photo, blank, unreadable),
   set isPaper to false and say so plainly. Never invent an assessment.
2. Quote at least 2 exact short lines you actually read, copied character-for-character
   including spelling mistakes. If handwriting is unreadable, quote fewer and say
   which parts you could not read.
3. Every claim in insights must trace to something visible: definitions seen,
   numericals seen, formulas seen, or their visible absence in an attempted answer.

IMPORTANT: base the level verdict ONLY on the evidence visible in THIS paper.
A first-time student with strong work is ABOVE AVERAGE; a long-known student
with weak work is BELOW AVERAGE. Past records (if any) are only for a short
progress comment — never for the verdict.}`.trim();

function fallbackStudent(studentName, classId, progressLine, subject = '') {
  const insights = progressLine
    ? `${progressLine} AI key not configured. Add MISTRAL_API_KEY in backend/.env for full paper reading — student added for manual review.`
    : 'AI key not configured. Add MISTRAL_API_KEY in backend/.env for full paper reading — student added for manual review.';
  return {
    id: `${classId}-${Date.now()}`,
    name: studentName,
    subject,
    lastScan: Date.now(),
    score: 0,
    performanceLevel: 'average',
    insights,
    supportNeeds: ['Manual review'],
    specialCare: false,
    numericalSkills: 'secure',
    weakTopics: [],
    strengths: [],
    recommendations: ['Connect the AI key, then re-upload this paper for a full read.'],
  };
}

function toStudent(classId, studentName, a, subject = '') {
  const evidence = Array.isArray(a.evidence) ? a.evidence.map(String).filter(Boolean) : [];

  // Guardrail: not a paper at all — refuse to assess, never invent a level.
  if (a.isPaper === false) {
    return {
      id: `${classId}-${Date.now()}`,
      name: studentName,
      subject,
      lastScan: Date.now(),
      score: 0,
      performanceLevel: 'average',
      insights: String(a.insights || 'This image does not look like a student answer paper — no assessment made. Please re-upload a clear photo of the paper.'),
      supportNeeds: ['Manual review'],
      specialCare: false,
      numericalSkills: 'secure',
      weakTopics: [],
      strengths: [],
      recommendations: ['Re-upload a clear photo of the answer paper.'],
      evidence,
      unverified: true,
    };
  }

  const level = ['below', 'average', 'above'].includes(a.performanceLevel)
    ? a.performanceLevel
    : 'average';
  const unverified = evidence.length === 0;
  return {
    id: `${classId}-${Date.now()}`,
    name: studentName,
    subject,
    lastScan: Date.now(),
    score: 0,
    performanceLevel: level,
    insights: unverified
      ? `${String(a.insights || 'Paper analysed.')} ⚠ No readable quotes returned — treat as unverified, check the paper manually.`
      : String(a.insights || 'Paper analysed.'),
    supportNeeds: Array.isArray(a.supportNeeds) && a.supportNeeds.length
      ? a.supportNeeds.map(String)
      : ['General review'],
    specialCare: Boolean(a.specialCare ?? level === 'below'),
    numericalSkills: a.numericalsNeedSupport ? 'needs-support' : 'secure',
    weakTopics: Array.isArray(a.weakTopics) ? a.weakTopics.map(String) : [],
    strengths: Array.isArray(a.strengths) ? a.strengths.map(String) : [],
    recommendations: Array.isArray(a.recommendations) ? a.recommendations.map(String) : [],
    evidence,
    unverified,
  };
}

const LEVEL_ORDER = { below: 0, average: 1, above: 2 };

function trendOf(history, currentLevel) {
  if (!history.length) return 'new';
  const last = history[history.length - 1].performanceLevel;
  if (!(last in LEVEL_ORDER) || !(currentLevel in LEVEL_ORDER)) return 'stable';
  if (LEVEL_ORDER[currentLevel] > LEVEL_ORDER[last]) return 'improving';
  if (LEVEL_ORDER[currentLevel] < LEVEL_ORDER[last]) return 'declining';
  return 'stable';
}

function historyBlock(history, subject) {
  const scope = subject ? ` in ${subject}` : '';
  if (!history.length) return `No past papers for this student${scope}. Assess this paper fully on its own evidence — do not assume weakness or strength from the lack of history.`;
  const lines = history.slice(-5).map((h, i) => {
    const date = String(h.date || '').slice(0, 10);
    const weak = (h.weakTopics || []).join(', ') || '—';
    return `${i + 1}. [${date}] level=${h.performanceLevel} | weak topics: ${weak} | note: ${h.insights || '—'}`;
  });
  return `Past${scope} papers for THIS SAME student (oldest first):\n${lines.join('\n')}\nUse these ONLY for a short progress comment (improving/declining/stable, repeating weak areas). The level verdict must come from THIS paper alone.`;
}

async function analyzeWithMistral({ buffer, mimetype, studentName, subject, historyText }) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const model = process.env.MISTRAL_MODEL || 'pixtral-12b-2409';
  if (!apiKey) return null;

  const base64 = buffer.toString('base64');
  const isPdf = mimetype === 'application/pdf';
  const mediaPart = isPdf
    ? { type: 'document_url', document_url: `data:application/pdf;base64,${base64}` }
    : { type: 'image_url', image_url: `data:${mimetype};base64,${base64}` };

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1100,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${RUBRIC}\n\nStudent name: ${studentName}\nSubject: ${subject || 'general'}\n\n${historyText}` },
            mediaPart,
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI service error (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return JSON.parse(content);
}

async function analyzePaper({ buffer, mimetype, studentName, classId, history = [], subject = '' }) {
  const isNewStudent = history.length === 0;
  const historyText = historyBlock(history, subject);
  try {
    const ai = await analyzeWithMistral({ buffer, mimetype, studentName, subject, historyText });
    if (!ai) {
      const s = fallbackStudent(studentName, classId, progressLine(history, null, isNewStudent), subject);
      s.isNewStudent = isNewStudent;
      s.papersCount = history.length + 1;
      s.trend = 'unknown';
      return s;
    }
    const student = toStudent(classId, studentName, ai, subject);
    student.isNewStudent = isNewStudent;
    student.papersCount = history.length + 1;
    student.trend = trendOf(history, student.performanceLevel);
    return student;
  } catch (err) {
    console.error('Paper analysis failed, using fallback:', err.message);
    const s = fallbackStudent(studentName, classId, progressLine(history, null, isNewStudent), subject);
    s.isNewStudent = isNewStudent;
    s.papersCount = history.length + 1;
    s.trend = trendOf(history, 'average');
    return s;
  }
}

function progressLine(history, _level, isNewStudent) {
  if (isNewStudent) return 'First paper on record for this student. ';
  const last = history[history.length - 1];
  const date = String(last.date || '').slice(0, 10);
  return `Paper ${history.length + 1} for this student (last: ${last.performanceLevel} on ${date}). `;
}

module.exports = { analyzePaper };
