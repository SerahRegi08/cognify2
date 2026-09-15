# Cognify Backend (paper analysis API)

Serves the teacher app at `http://localhost:3000`.
Do NOT start another frontend — this runs on port **5000**.

## Setup
1. Copy `.env.example` to `.env`.
2. Optional (for real paper reading): paste a Mistral key from console.mistral.ai as `MISTRAL_API_KEY`.
   Without it the API still works but marks results for manual review.

## Run
```bash
npm install
npm run dev    # or: npm start
```

## Endpoints
- `GET /health` → `{ ok: true }`
- `POST /api/classes/:id/analyze` — form fields: `paper` (image/PDF, max 10MB), `studentName` (text).
  Returns `{ student }` with `performanceLevel` (below/average/above), `insights`,
  `supportNeeds`, `specialCare`, `numericalSkills` — exactly what the
  student table's Performance / Support / AI insights columns need.
- `GET /api/classes/names` — class id + name list (no student data)
- `GET /api/classes`, `PUT /api/classes` — whole-list class sync
- `GET /api/assignments`, `PUT /api/assignments` — whole-list assignment sync
- `GET /api/worksheets`, `PUT /api/worksheets` — worksheet metadata sync
- `POST /api/worksheets/upload` (fields: file, title, className) — teacher upload
- `GET /api/worksheets/file/:fileId` — download an upload
- `DELETE /api/worksheets/:id` — delete metadata (+ file for uploads)
- `POST /api/worksheet` { studentName, performanceLevel, weakTopics[], weakAreas[] }
- `GET /api/students/lookup?name=` — scan records + worksheets for one student
- `GET /api/students/classes?name=` — classes containing a same-named student
- `POST /api/submissions` (fields: file, assignmentId, studentName)
- `GET /api/submissions?assignmentId=&student=` — list submissions
- `GET /api/submissions/file/:fileId` — download submitted work
