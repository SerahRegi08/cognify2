// Daily study plan: sums up a student's assignments, worksheets and
// to-dos into one ordered day plan. Mistral when a key is set,
// otherwise a deterministic plan built from the same real data.
function templatePlan({ level, assignments, worksheets, todos, weakTopics }) {
  const tasks = []
  const push = (text, reason) => {
    if (tasks.length < 7) tasks.push({ text, reason })
  }

  ;(assignments || []).slice(0, 3).forEach((a) => {
    push(`Complete "${a.title}"${a.className ? ` (${a.className})` : ''}`, 'Pending assignment from your teacher')
  })

  const open = (todos || []).filter((t) => !t.done)
  const high = open.filter((t) => t.priority === 'high')
  ;(high.length > 0 ? high : open).slice(0, 2).forEach((t) => {
    push(t.text, 'From your to-do list')
  })

  ;(weakTopics || []).slice(0, 2).forEach((t) => {
    push(`Revise ${t} — 20 min recall, then 3 practice questions`, 'Targets your weak area')
  })

  if ((worksheets || []).length > 0) {
    push(`Work through "${worksheets[0].title}"`, 'Your latest practice material')
  }

  if (tasks.length === 0) {
    push('Revise today\u2019s class notes for 20 minutes', 'Keep the habit on quiet days')
  }

  const focus =
    level === 'below'
      ? 'Today is about basics: definitions and formulas first.'
      : level === 'above'
        ? 'Today is about precision: finish strong, zero careless errors.'
        : 'Today is about completeness: full steps, then one stretch question.'

  return { tasks, focus, aiGenerated: false }
}

async function generateWithMistral({ studentName, level, assignments, worksheets, todos, weakTopics }) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  const model = process.env.MISTRAL_MODEL || 'pixtral-12b-2409';

  const fmtList = (items, fmt) =>
    items.length > 0 ? items.map(fmt).join('\n') : '(none)';

  const prompt = `You are Cognify, an AI study coach. Build TODAY's study plan for ${studentName || 'a student'} (performance level: ${level || 'average'}).

Pending assignments:
${fmtList(assignments || [], (a) => `- ${a.title}${a.className ? ` (${a.className})` : ''}`)}

Worksheets available:
${fmtList(worksheets || [], (w) => `- ${w.title}`)}

Open to-dos (priority in brackets):
${fmtList((todos || []).filter((t) => !t.done), (t) => `- [${t.priority || 'medium'}] ${t.text}`)}

Weak topics: ${(weakTopics || []).join(', ') || 'none specified'}

Rules: 5-7 concrete tasks, most urgent first. Reference their real assignments and worksheets by title. Every task doable today. Keep language simple for school students.
Return ONLY valid JSON: { "tasks": [{ "text": string, "reason": string }], "focus": "one motivating line for the day" }`;

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI service error (${res.status})`);
  const data = await res.json();
  const plan = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new Error('Bad plan shape');
  return {
    tasks: plan.tasks.slice(0, 7).map((t) => ({
      text: String(t.text || '').slice(0, 200),
      reason: String(t.reason || '').slice(0, 200),
    })),
    focus: String(plan.focus || '').slice(0, 200),
    aiGenerated: true,
  };
}

async function generateDailyPlan(input) {
  const shaped = {
    studentName: String(input.studentName || 'Student'),
    level: ['below', 'average', 'above'].includes(input.level) ? input.level : 'average',
    assignments: Array.isArray(input.assignments) ? input.assignments.slice(0, 10) : [],
    worksheets: Array.isArray(input.worksheets) ? input.worksheets.slice(0, 10) : [],
    todos: Array.isArray(input.todos) ? input.todos.slice(0, 20) : [],
    weakTopics: Array.isArray(input.weakTopics) ? input.weakTopics.slice(0, 10) : [],
  };
  try {
    const ai = await generateWithMistral(shaped);
    if (ai) return ai;
  } catch (err) {
    console.error('Daily plan AI failed, using template:', err.message);
  }
  return templatePlan(shaped);
}

module.exports = { generateDailyPlan };
