# FlowSense

**AI-powered UX interaction quality analyzer**

---

## What is FlowSense?

FlowSense is an internal tool that automatically evaluates the quality of user interactions in any product experience. You upload a screen recording of a task flow, and FlowSense uses AI to score and identify UX issues.

Think of it as an **automated UX heuristic review** that catches interaction problems humans might miss.

---

## The Problem It Solves

| Traditional Approach | With FlowSense |
|---------------------|----------------|
| Manual heuristic reviews take hours | Analysis complete in minutes |
| Subjective, varies by reviewer | Consistent scoring rubric |
| Hard to track improvements over time | Quantified metrics + regression tracking |
| Easy to miss subtle interaction issues | AI catches micro-interaction problems |
| Difficult to scale across features | Run unlimited analyses |

---

## How It Works

```
1. Record → Capture a screen recording of any task flow
2. Upload → Drop the video into FlowSense
3. Analyze → AI extracts keyframes and evaluates each moment
4. Report → Get scored results with specific issues and suggestions
```

---

## What It Evaluates

FlowSense scores interactions across **7 UX quality categories**:

| Category | What It Measures |
|----------|------------------|
| **Action → Response** | Does clicking produce immediate, clear feedback? |
| **System Status** | Are loading states, progress, and system state visible? |
| **Predictability** | Do interactive elements look and behave as expected? |
| **Flow Continuity** | Is the experience smooth without backtracking or friction? |
| **Error Handling** | Are errors shown clearly with recovery paths? |
| **Interactions** | Are transitions smooth and focus states clear? |
| **Efficiency** | Is the task achievable with minimal steps? |

Each category is scored **0 / 1 / 2** (Poor / Fair / Good).

---

## Sample Issues It Catches

- **Dead clicks** — button pressed but nothing happened
- **Missing spinners** — no loading indicator during wait
- **Unclear disabled states** — can't tell if element is interactive
- **Surprise navigation** — unexpected page change
- **Silent errors** — operation failed with no feedback
- **Too many steps** — task requires excessive clicks
- **Jarring transitions** — abrupt state changes

---

## Output Report

Every analysis produces:

| Metric | Description |
|--------|-------------|
| **Weighted Score (0-100)** | Overall interaction quality score |
| **Quality Gate** | `Pass` / `Warn` / `Block` status |
| **Critical Issues** | Count of high-severity problems |
| **Category Breakdown** | Score per rubric category |
| **Issue Tags** | Specific problems detected |
| **Suggestions** | Prioritized improvements (high/med/low) |
| **Regression Delta** | Comparison vs previous runs |

---

## Use Cases

### For Designers
- Validate interaction quality before handoff
- Catch micro-interaction issues in prototypes
- Get objective feedback on flow designs
- Track UX quality improvements over iterations

### For Design Reviews
- Bring data to design critiques
- Identify specific moments that need work
- Standardize quality bar across features

### For PMs & Leadership
- Quantify UX quality across features
- Track quality trends over time
- Identify areas needing design investment

---

## Example Workflow

**Scenario**: You're shipping a new Copilot feature and want to validate the interaction quality.

1. Record yourself completing the main task flow (2-3 minutes)
2. Upload to FlowSense
3. Review the report — see you scored 72/100 with 2 critical issues
4. Issues flagged: `missing_spinner` on submit, `dead_click` on filter button
5. Fix those issues, re-record, re-analyze
6. New score: 89/100, quality gate passes
7. Ship with confidence

---

## Quick Stats

- **Analysis time**: ~2-5 minutes per recording
- **Supported formats**: MP4, MOV, WebM
- **Rubric categories**: 7
- **Issue types detected**: 22+

---

## Access

FlowSense is currently in internal beta. Contact Aadith for access or demo.

---

*Built by Aadith V A | Microsoft Design*
