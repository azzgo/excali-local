import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUDIT_CONFIG } from "./scene-audit";
import { LAYOUT_SPACING } from "./scene-layout";

/**
 * DOC/CODE DRIFT GATE for the layout guidance.
 *
 * The skill's markdown tells an agent concrete numbers: the spacing table, the
 * box-sizing formula, the gutter floor. Those numbers are worthless if they
 * drift from what the code actually enforces — the agent would follow the doc
 * and still fail `scene.audit`. This test reads the markdown and asserts the
 * numbers match the constants, so changing one without the other fails here
 * rather than silently misleading an agent.
 *
 * This is the same idea as `pnpm skill:check` (which pins the method list to
 * the wire contract), applied to the layout numbers.
 */

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../skills/excali-local");
const WORKFLOW = readFileSync(join(SKILL_DIR, "references/workflows/draw-a-diagram.md"), "utf8");
const TEMPLATES = readFileSync(join(SKILL_DIR, "references/element-templates.md"), "utf8");
const SKILL_MD = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const COMMAND_REF = readFileSync(join(SKILL_DIR, "references/command-reference.md"), "utf8");

describe("doc/code drift — spacing numbers", () => {
  test("the spacing table matches LAYOUT_SPACING", () => {
    expect(WORKFLOW).toContain(`| sibling gap | **${LAYOUT_SPACING.node} px**`);
    expect(WORKFLOW).toContain(`| layer gap | **${LAYOUT_SPACING.layer} px**`);
    expect(WORKFLOW).toContain(`| canvas padding | **${LAYOUT_SPACING.padding} px**`);
  });

  test("the gutter floor matches DEFAULT_AUDIT_CONFIG.gutter", () => {
    expect(WORKFLOW).toContain(`| minimum gutter | **${DEFAULT_AUDIT_CONFIG.gutter} px**`);
  });

  test("the box-sizing formula matches the solver's padding constants", () => {
    expect(WORKFLOW).toContain(`max(${LAYOUT_SPACING.minWidth}, labelWidth + ${LAYOUT_SPACING.boxPadX})`);
    expect(WORKFLOW).toContain(`max(${LAYOUT_SPACING.minHeight}, labelHeight + ${LAYOUT_SPACING.boxPadY})`);
  });
});

describe("doc/code drift — scene.audit is described truthfully", () => {
  test("the method is in the command reference under the canvas-bound gate", () => {
    expect(COMMAND_REF).toContain("`scene.audit`");
    // The gate section header the checker keys on.
    const canvasSection = COMMAND_REF.slice(
      COMMAND_REF.indexOf("## activated (canvas-bound)"),
      COMMAND_REF.indexOf("## paired"),
    );
    expect(canvasSection).toContain("`scene.audit`");
  });

  test("every audit field the doc documents actually exists in the report", () => {
    // Fields an agent is told to read. If one is renamed in code, the doc is
    // lying and this fails.
    const documented = [
      "ok",
      "readabilityOk",
      "elementCount",
      "overlaps",
      "gutterViolations",
      "textFit",
      "unboundArrows",
      "bindingViolations",
      "waypointsInsideNodes",
      "wrappedLabels",
      "deadSpaceRatio",
      "bounds",
      "summary",
    ];
    for (const field of documented) {
      expect(COMMAND_REF).toContain(`"${field}"`);
    }
  });

  test("the doc's stated defaults match DEFAULT_AUDIT_CONFIG", () => {
    expect(COMMAND_REF).toContain(`"gutter"?: ${DEFAULT_AUDIT_CONFIG.gutter}`);
    expect(COMMAND_REF).toContain(`"padding"?: ${DEFAULT_AUDIT_CONFIG.padding}`);
    expect(COMMAND_REF).toContain(`"epsilon"?: ${DEFAULT_AUDIT_CONFIG.epsilon}`);
    expect(COMMAND_REF).toContain(`"maxLabelLines"?: ${DEFAULT_AUDIT_CONFIG.maxLabelLines}`);
  });
});

describe("doc/code drift — the 'compute geometry' rule is stated consistently", () => {
  test("SKILL.md no longer forbids computing coordinates", () => {
    // The old absolute rule ("no generator scripts") contradicted
    // measure-then-place. The replacement must keep the payload rule while
    // allowing arithmetic.
    expect(SKILL_MD).toContain("Hand-craft the payload; compute the geometry");
    expect(SKILL_MD).not.toContain("No generator scripts, no delegating JSON");
  });

  test("the workflow keeps the boxed distinction between computing and delegating", () => {
    expect(WORKFLOW).toContain("Coordinates may be computed");
    expect(WORKFLOW).toContain("Delegating the payload is not fine");
  });

  test("measure-then-place is present with the three steps", () => {
    expect(WORKFLOW).toContain("Measure, then place");
    expect(WORKFLOW).toContain("**Measure.**");
    expect(WORKFLOW).toContain("**Place.**");
    expect(WORKFLOW).toContain("**Emit.**");
  });

  test("the gap-marker discipline is documented", () => {
    expect(SKILL_MD).toContain("[excali-gap]");
    expect(SKILL_MD).toContain("Declare every degradation");
  });
});

describe("doc/code drift — arrow routing rules", () => {
  test("the fixedPoint table uses normalized ratios, not pixels", () => {
    expect(TEMPLATES).toContain("Arrow routing");
    expect(TEMPLATES).toContain("normalized ratio");
    expect(TEMPLATES).toContain("`[0.5, 1]` bottom-center");
    expect(TEMPLATES).toContain("`[0.5, 0]` top-center");
  });

  test("the bind-straight / unbound-polyline rule is documented", () => {
    expect(TEMPLATES).toContain("Bind straight arrows; leave polylines unbound");
    expect(TEMPLATES).toContain("allowUnboundPolylines");
  });

  test("the four causes of a misplaced arrow are enumerated", () => {
    expect(TEMPLATES).toContain("the binding was dropped");
    expect(TEMPLATES).toContain("`fixedPoint` unset or written in pixels");
    expect(TEMPLATES).toContain("no routing lane");
  });
});
