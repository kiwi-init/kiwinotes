import { expect, test } from "bun:test";
import { moveSection } from "./section-move.ts";

test("moves sibling sections with their descendants in either direction", () => {
  const source = "Intro\n# One\nbody\n## Child\nchild\n# Two\nmore\n## Other\nend\n# Three\n";
  const expected = "Intro\n# Two\nmore\n## Other\nend\n# One\nbody\n## Child\nchild\n# Three\n";
  expect(moveSection(source, source.indexOf("# One"), "down")).toBe(expected);
  expect(moveSection(source, source.indexOf("# Two"), "up")).toBe(expected);
});

test("does not cross a parent or move beyond sibling boundaries", () => {
  const source = "# Parent\n## First\n### Nested\n## Last\n# Next\n## Alone\n";
  expect(moveSection(source, source.indexOf("## First"), "up")).toBe(source);
  expect(moveSection(source, source.indexOf("## Last"), "down")).toBe(source);
  expect(moveSection(source, source.indexOf("## Alone"), "up")).toBe(source);
  expect(moveSection(source, source.indexOf("### Nested"), "down")).toBe(source);
  expect(moveSection(source, 2, "up")).toBe(source);
});

test("preserves the final newline state and line endings", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const final of ["", newline]) {
      const source = `# A${newline}alpha${newline}# B${newline}beta${final}`;
      const expected = `# B${newline}beta${newline}# A${newline}alpha${final}`;
      expect(moveSection(source, 0, "down")).toBe(expected);
      expect(moveSection(expected, expected.indexOf("# A"), "up")).toBe(source);
    }
  }
});

test("uses parsed headings rather than headings in frontmatter, fences or comments", () => {
  const source = "---\ntitle: '# Fake'\n---\n# A\n```md\n# Fake\n```\n%%\n# Hidden\n%%\n# B\n";
  const expected = "---\ntitle: '# Fake'\n---\n# B\n# A\n```md\n# Fake\n```\n%%\n# Hidden\n%%\n";
  expect(moveSection(source, source.indexOf("# A"), "down")).toBe(expected);
  expect(moveSection(source, source.indexOf("# Fake\n```"), "up")).toBe(source);
});

test("keeps quoted headings inside their enclosing section", () => {
  const source = "# A\n> # Quoted\n> text\n# B\n";
  expect(moveSection(source, source.indexOf("# Quoted"), "down")).toBe(source);
  expect(moveSection(source, 0, "down")).toBe("# B\n# A\n> # Quoted\n> text\n");
});

test("moves setext headings and preserves blank lines", () => {
  const source = "Title\n=====\n\nfirst\n\nSecond\n======\n\nlast";
  expect(moveSection(source, 0, "down")).toBe("Second\n======\n\nlast\n\nTitle\n=====\n\nfirst");
});
