// Targeted worksheet generator: builds practice work from the student's
// weak areas (never from marks).
function templateWorksheet({ studentName, performanceLevel, weakTopics, weakAreas }) {
  const topics = weakTopics && weakTopics.length ? weakTopics.join(', ') : 'the topics flagged in the paper';
  const questions = [];
  const has = (word) => (weakAreas || []).join(' ').toLowerCase().includes(word);

  questions.push({
    topic: 'Definitions',
    q: `Write the definitions of the key terms in ${topics} from memory, then check them against the textbook.`,
    hint: 'One mark per correct definition — say it aloud first, then write.',
  });
  if (has('numeric') || has('formula') || performanceLevel !== 'above') {
    questions.push({
      topic: 'Formulas',
      q: `List every formula used in ${topics} on a blank page without looking, then verify.`,
      hint: 'No formula, no numerical — memorise first.',
    });
    questions.push({
      topic: 'Numericals',
      q: 'Solve 3 numericals showing all 3 steps every time: formula → substitution → answer with units.',
      hint: 'Underline the final answer. Missing steps lose marks even when the answer is right.',
    });
  }
  if (performanceLevel === 'average' || performanceLevel === 'below') {
    questions.push({
      topic: 'Step completion',
      q: 'Re-attempt one question from the paper, writing every intermediate step you skipped last time.',
      hint: 'Use a stepwise template and tick each step off.',
    });
  }
  if (performanceLevel === 'average') {
    questions.push({
      topic: 'Higher-order thinking',
      q: 'Answer one "why" / "what if" question on this chapter in 4–5 lines, then compare with the model answer.',
      hint: 'Start with one HOTS question per day.',
    });
  }
  if (performanceLevel === 'above') {
    questions.push({
      topic: 'Precision',
      q: 'Redo the section where careless mistakes happened, slowly, then recheck each line backwards.',
      hint: 'Re-read the question, verify units, recheck the final step.',
    });
  }

  return {
    title: `Practice Worksheet — ${studentName || 'Student'}`,
    instructions: `Targeted at: ${topics}. Do it in one sitting, then self-check with the hints.`,
    questions,
    checklist: ['Formulas written before solving', 'All steps shown', 'Units on every answer', 'Final answers underlined'],
    aiGenerated: false,
  };
}

async function generateWithMistral({ studentName, performanceLevel, weakTopics, weakAreas }) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  const model = process.env.MISTRAL_MODEL || 'pixtral-12b-2409';

  const prompt = `You are Cognify, an AI tutor. Create a short practice worksheet for a student.
Student: ${studentName}
Performance level: ${performanceLevel} (below = weak basics/definitions/numericals/formulas/presentation; average = basics ok but misses steps and higher-order questions; above = thorough, only weak topics + careless mistakes)
Struggling with: ${(weakAreas || []).join('; ') || 'general review'}
Weak topics: ${(weakTopics || []).join(', ') || 'none specified'}

Rules: target ONLY the weak areas above, never generic revision. 5-7 questions mixing definitions, formula drills, stepwise numericals, and (for average and above) one higher-order question. Keep language simple for school students.
Return ONLY valid JSON: { "title": string, "instructions": string, "questions": [{ "topic": string, "q": string, "hint": string }], "checklist": [string] }`;

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI service error (${res.status})`);
  const data = await res.json();
  const ws = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  if (!Array.isArray(ws.questions)) throw new Error('Bad worksheet shape');
  return { ...ws, aiGenerated: true };
}

async function generateWorksheet(input) {
  try {
    const ai = await generateWithMistral(input);
    if (ai) return ai;
  } catch (err) {
    console.error('Worksheet AI failed, using template:', err.message);
  }
  return templateWorksheet(input);
}

module.exports = { generateWorksheet };
