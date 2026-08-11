# Local Annotation Tool Design

## Goal

Provide a no-cost local browser tool that lets reviewers complete the existing
1,000-row annotation benchmark without sending article data or labels to a
third party.

## Decisions

- Keep the production dashboard unchanged. The annotation tool is a separate
  static page under `tools/annotation-app/`, so it is not published to GitHub
  Pages or exposed through the Worker.
- The reviewer selects local JSONL files with the browser file picker. State is
  stored only in the browser and the completed data is downloaded as JSONL.
- The candidate JSONL remains the source of truth. Machine suggestions can be
  displayed as a visual reference, but never populate `annotations` until the
  reviewer deliberately copies or changes a value.
- The page supports three write targets: consensus, annotator 1, and annotator
  2. Annotator 1 and 2 are enabled only for rows with `doubleAnnotation=true`.
- The core parser, label updater, validation, and exporter are dependency-free
  JavaScript functions with Node tests. The browser page only renders and wires
  those functions to form controls.

## Reviewer Workflow

1. Start a local static server and open the tool in a browser.
2. Load `annotation-candidates.jsonl`; optionally load
   `annotation-machine-draft.jsonl` for suggestions.
3. Review title and excerpt, select the required labels, and save the current
   row. Suggestions are visible but are not labels until saved by a reviewer.
4. For each of the 100 double-annotation rows, have two people export their
   independently completed copies, then use the tool's consensus mode to record
   the adjudicated canonical labels.
5. Download the completed candidate JSONL and run the repository evaluator.

## Boundaries

The tool cannot prove a person made a judgement. It therefore preserves the
existing distinction between machine suggestions and human labels and does not
claim Cohen's kappa or macro-F1 until completed reviewer data is exported.
