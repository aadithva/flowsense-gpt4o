# FlowSense Presentation for Deepak Menon
## PowerPoint Content & Speaker Notes

---

# SLIDE 1: TITLE

## Title
**FlowSense: From Screen to Flow**

## Subtitle
Video-Based UX Evaluation for Interaction Quality

## Your Name / Date
Aadith | February 2026

## Speaker Notes
> "You're familiar with our UX eval work on Copilot - we analyze individual screens to find usability issues. FlowSense is the next step: instead of evaluating static screens, we evaluate entire interaction flows from video recordings. Today I'll walk you through how I built it, the rubric design, and what I learned about whether vision models can handle this kind of evaluation."

---

# SLIDE 2: THE EVOLUTION

## Title
From Screen-Level to Flow-Level Analysis

## Content (Two Columns)

| Screen Eval (Current) | Flow Eval (FlowSense) |
|----------------------|----------------------|
| Single screenshot | Video of user journey |
| Static UI issues | Temporal interaction patterns |
| "Is this button visible?" | "Did the click produce feedback?" |
| Point-in-time analysis | Cause → Effect relationships |
| Manual frame selection | Automatic keyframe detection |

## Visual
Arrow showing progression: [Screenshot] → [Video Timeline]

## Speaker Notes
> "Screen-level evaluation catches visual issues - alignment, contrast, component states. But it misses a crucial dimension: interaction quality over time. Users don't experience screens, they experience flows. FlowSense captures what happens between clicks, during loading, across navigation. It's the temporal dimension of UX."

---

# SLIDE 3: THE CORE QUESTION

## Title
What Changes When We Evaluate Flows?

## Content

**Key Insight: The rubric fundamentally changes**

Screen-level questions:
- "Are elements properly aligned?"
- "Is contrast sufficient?"
- "Is the error message visible?"

Flow-level questions:
- "Did the user's click get acknowledged?"
- "Was there feedback during the wait?"
- "Could the user recover from the error?"

**New evaluation dimensions emerge:**
1. Action → Response integrity
2. System status visibility
3. Flow continuity
4. Error recovery paths

## Speaker Notes
> "This is the crux of the project. When you shift from screens to flows, you're asking fundamentally different questions. It's not about whether elements exist - it's about whether interactions work. This led me to design a completely new rubric from scratch, grounded in interaction quality rather than visual compliance."

---

# SLIDE 4: THE PIPELINE

## Title
FlowSense Analysis Pipeline

## Content (Vertical Flow Diagram)

```
┌─────────────────┐
│  Video Upload   │
└────────┬────────┘
         ↓
┌─────────────────┐
│Frame Extraction │ ← 2 FPS, keyframe detection (15% pixel diff)
└────────┬────────┘
         ↓
┌─────────────────┐
│Change Detection │ ← 4x4 grid analysis, classify change type
└────────┬────────┘
         ↓
┌─────────────────┐
│ Preprocessing   │ ← Temporal windows, SSIM, diff heatmaps
└────────┬────────┘
         ↓
┌─────────────────┐
│Two-Pass Inference│
│  Pass A: Facts  │ ← "What happened?"
│  Pass B: Score  │ ← "How well?"
└────────┬────────┘
         ↓
┌─────────────────┐
│ Summary & Gate  │ ← Weighted score, pass/warn/block
└─────────────────┘
```

## Speaker Notes
> "Here's the pipeline. Video comes in, we extract frames at 2 FPS. Keyframes are automatically detected when pixel difference exceeds 15% - meaning something meaningful changed. Change detection classifies what type of change occurred. Preprocessing builds temporal context. Then two-pass inference - which I'll explain - analyzes each keyframe. Finally, we aggregate into a summary with a quality gate."

---

# SLIDE 5: THE RUBRIC

## Title
Video UX Evaluation Rubric

## Content (Table)

| Category | Weight | What It Measures |
|----------|--------|-----------------|
| **Action → Response** | 20% | Every click produces immediate feedback |
| **Feedback & Status** | 15% | Loading states, progress indicators visible |
| **Predictability** | 15% | Interactive elements look interactive |
| **Flow Continuity** | 15% | Smooth progression, no forced backtracking |
| **Error Handling** | 20% | Clear errors with actionable recovery |
| **Micro-interactions** | 5% | Smooth transitions, proper focus management |
| **Efficiency** | 10% | Minimal steps, smart defaults |

**Scoring: 0 (Poor) / 1 (Fair) / 2 (Good)**

## Visual
Pie chart showing weight distribution

## Speaker Notes
> "Seven categories, each with a weight. Action Response and Error Handling are weighted highest at 20% each because they most directly impact user trust. If I click and nothing happens, I lose confidence. If an error gives me no way forward, I'm stuck. The rubric is designed to be model-agnostic - these are UX principles, not AI constraints. Each category has specific observable signals."

---

# SLIDE 6: RUBRIC DESIGN PHILOSOPHY

## Title
Designing Model-Agnostic Rubrics

## Content

**Four design principles:**

1. **Observable** - Based on visible state changes, not inferred intent
2. **Binary-ish** - Clear criteria (feedback exists or doesn't)
3. **Temporal** - Requires comparing frames, not single-frame judgment
4. **Actionable** - Each score maps to specific issue tags

**Example: Action → Response Integrity**

| Score | Criteria |
|-------|----------|
| 2 (Good) | Click → immediate visual change (button press, spinner) |
| 1 (Fair) | Click → delayed response (100-200ms) but visible |
| 0 (Poor) | Click → no visible response ("dead click") |

## Speaker Notes
> "This answers the question of how I structured rubrics irrespective of model. The key insight: make criteria as objective as possible. The model doesn't need to understand 'good UX' - it just needs to observe state changes. Did something visible happen after the click? Yes or no. The rubric does the UX reasoning, the model does the observation. This structure works regardless of which vision model you use."

---

# SLIDE 7: THE ITERATION (V2 → V3)

## Title
Learning from V2 → Building V3

## Content (Two Columns)

| V2 Challenge | V3 Solution |
|--------------|-------------|
| Single-pass struggled with complex frames | **Two-pass inference**: Extract facts first, then score |
| Model confused by what changed | **Change detection**: Pre-classify regions |
| No temporal context | **Temporal windows**: 5-frame sequences |
| Inconsistent scoring | **Self-consistency reruns**: Re-score if confidence low |

**Results:**
- Accuracy: +15-25% improvement
- Cost: ~60% higher per analysis

## Speaker Notes
> "V2 was single-pass: 'Here are the frames, score everything.' Problem: the model would miss subtle changes or misattribute issues. V3's key insight was to separate 'what happened' from 'was it good.' Pass A extracts facts: click detected, spinner appeared, modal closed. Pass B then scores using that extraction as context. This separation dramatically improved accuracy. We also added self-consistency - if the model's confidence is low, we rerun the analysis."

---

# SLIDE 8: MODEL CAPABILITY

## Title
Can Vision Models Handle This?

## Content

**Short answer: Yes, with structure**

**What works well:**
- Detecting visible state changes (buttons, spinners, modals)
- Identifying cause-effect in short sequences
- Recognizing common UI patterns
- Platform-specific recognition (Copilot, ChatGPT, etc.)

**What needs scaffolding:**
- Long temporal dependencies → Context trail
- Subtle micro-interactions → Diff heatmaps
- Confidence calibration → Reruns

**Quality Gate:**
| Status | Criteria |
|--------|----------|
| Pass | Score >80, no critical issues |
| Warn | Score 65-80 |
| Block | Score <65 OR any critical issue |

## Speaker Notes
> "Can models handle this rubric? Yes, but don't ask the model to be a UX expert - ask it to be an observer. The rubric plus scaffolding does the UX expertise. GPT-4o Vision works well for detecting state changes, cause-effect relationships, and common patterns. For longer dependencies, we pass a context trail of previous frames. For subtle changes, we generate diff heatmaps. The quality gate makes results actionable - pass, warn, or block."

---

# SLIDE 9: DEMO SETUP

## Title
Live Demo

## Content

**What you'll see:**

1. Upload a Copilot interaction video (~30 seconds)
2. Watch the analysis pipeline process frames
3. Review rubric scores per keyframe
4. See the aggregated summary with quality gate
5. Explore issue tags and recommendations

**Things to notice:**
- Automatic keyframe selection (where changes happened)
- Per-frame justifications citing specific observations
- How scores aggregate to overall quality gate

## Speaker Notes
> "Let me show you how this works in practice. I'll upload a short Copilot interaction video - about 30 seconds. You'll see the pipeline extract keyframes, run analysis, and generate a report. Pay attention to the justifications - the model cites specific things it observed. And notice how individual frame scores aggregate into an overall quality gate."

---

# SLIDE 10: KEY LEARNINGS

## Title
What I Learned Building This

## Content

**5 Key Learnings:**

1. **Rubric design > Model capability**
   Structure the problem well, models follow

2. **Two-pass is powerful**
   Extraction then scoring reduces hallucination

3. **Temporal context is essential**
   Single frames lose interaction meaning

4. **Confidence-based reruns help**
   Let the model try again when uncertain

5. **Quality gates make it actionable**
   Pass/Warn/Block > just scores

**Potential next steps:**
- Longer videos (currently ~30s optimal)
- A/B comparison (version A vs B)
- CI/CD integration for automated UX gates

## Speaker Notes
> "Main takeaway: video-based UX evaluation is feasible with the right scaffolding. The rubric design matters more than model capability - structure the problem as observation tasks, not judgment tasks. Two-pass inference was a breakthrough. And quality gates make results actionable for teams. This extends our screen-level work into the temporal dimension and opens up automated interaction quality testing."

---

# APPENDIX: DETAILED RUBRIC REFERENCE

## For Q&A or follow-up

### Category 1: Action → Response Integrity (20%)
**Issue tags:** `dead_click`, `delayed_response`, `ambiguous_response`

| Score | Description |
|-------|-------------|
| 2 | Every action → immediate visual feedback (pressed state, color change, spinner) |
| 1 | Most actions have feedback, minor delays (100-200ms) acceptable |
| 0 | Dead clicks, >500ms delays without feedback, ambiguous responses |

### Category 2: Feedback & System Status (15%)
**Issue tags:** `missing_spinner`, `unclear_disabled_state`, `no_progress_feedback`

| Score | Description |
|-------|-------------|
| 2 | System state always visible, loading states clear, streaming text counts as feedback |
| 1 | Some status indicators present but incomplete |
| 0 | Silent operations, missing loading indicators |

### Category 3: Interaction Predictability (15%)
**Issue tags:** `misleading_affordance`, `surprise_navigation`, `mode_switch_surprise`

| Score | Description |
|-------|-------------|
| 2 | Interactive elements look interactive, behavior matches appearance |
| 1 | Most affordances clear with minor confusion possible |
| 0 | Misleading cues, unexpected behavior |

### Category 4: Flow Continuity (15%)
**Issue tags:** `backtracking`, `repeated_actions`, `context_loss`

| Score | Description |
|-------|-------------|
| 2 | Smooth progression, context preserved, logical flow |
| 1 | Minor friction but generally smooth |
| 0 | Forced backtracking, repeated steps, disjointed flow |

### Category 5: Error Handling (20%)
**Issue tags:** `silent_error`, `blocking_error`, `recovery_unclear`

| Score | Description |
|-------|-------------|
| 2 | Errors clearly shown with specific messages and recovery steps |
| 1 | Errors shown but recovery path unclear |
| 0 | Silent errors, blocking errors with no solution |

### Category 6: Micro-interactions (5%)
**Issue tags:** `jarring_transition`, `distracting_animation`, `focus_confusion`

| Score | Description |
|-------|-------------|
| 2 | Smooth transitions, good focus management |
| 1 | Functional but could be smoother |
| 0 | Jarring transitions, confusing focus |

### Category 7: Efficiency (10%)
**Issue tags:** `too_many_steps`, `over_clicking`, `excessive_cursor_travel`, `redundant_confirmations`

| Score | Description |
|-------|-------------|
| 2 | Minimal steps, smart defaults, shortcuts available |
| 1 | Reasonable steps, could be more efficient |
| 0 | Too many steps, poor defaults |

---

# BACKUP SLIDES

## If asked about specific implementation details

### Two-Pass Inference Detail

**Pass A (Extraction):**
- Temperature: 0.2 (consistent)
- Outputs: command type, target widget, state changes, response latency
- Focus: "What happened?" - factual observation

**Pass B (Scoring):**
- Temperature: 0.3 (slight variation)
- Inputs: Pass A context + prior frame context + change detection
- Outputs: rubric scores + justifications + issue tags
- Focus: "How well?" - quality assessment

**Self-Consistency:**
- Rerun if confidence < 0.6
- Rerun if schema coercion > 30%
- Max 2 reruns per frame

### Change Detection Detail

**4x4 Grid Analysis:**
- Frame divided into 16 regions
- Each region analyzed for pixel intensity change
- Position-based classification:
  - Top rows = navigation changes
  - Center = modal/content changes
  - Bottom = status bar changes

**Change Types:**
- `interaction_feedback` - Button press, hover
- `navigation` - Page transition
- `content_update` - Text/data change
- `modal_overlay` - Modal, dialog
- `loading_indicator` - Spinner, progress
- `error_state` - Error message

---

# PRESENTATION TIPS

1. **Slide 2-3**: Establish the "why" - this is the bridge from current work
2. **Slide 5-6**: Spend time here - this answers Deepak's main question about rubric design
3. **Slide 7**: Show you iterated - V2→V3 demonstrates learning
4. **Demo**: Have a good 30-second video ready that shows clear interaction patterns
5. **Slide 10**: Land the key insight: rubric design > model capability
