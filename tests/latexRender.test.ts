import { afterAll, describe, expect, it } from "vitest";
import { buildCardHtml, closeRenderer, messageToHtml, renderMessageImage } from "../src/services/latexRender.js";

describe("messageToHtml", () => {
  it("maps inline and display math to MathJax delimiters", () => {
    const html = messageToHtml("An $n \\times n$ grid. Prove $$A - B = 1.$$");
    expect(html).toContain("\\(n \\times n\\)");
    expect(html).toContain("\\[A - B = 1.\\]");
    expect(html).not.toContain("$");
  });

  it("escapes prose but keeps math verbatim", () => {
    const html = messageToHtml("a < b & c with $x < y$");
    expect(html).toContain("a &lt; b &amp; c");
    // Math entities are escaped in source; the browser decodes them back
    // before MathJax reads the TeX, so rendering is unaffected.
    expect(html).toContain("\\(x &lt; y\\)");
  });

  it("splits paragraphs", () => {
    const html = messageToHtml("First.\n\nSecond.");
    expect(html).toBe("<p>First.</p><p>Second.</p>");
  });
});

describe("buildCardHtml", () => {
  it("wraps body with header and footer", () => {
    const html = buildCardHtml("<p>Hi</p>", { title: "Daily Problem — Sep 10", footer: "IMO • CC-BY-4.0" });
    expect(html).toContain("card-head");
    expect(html).toContain("Daily Problem — Sep 10");
    expect(html).toContain("card-foot");
    expect(html).toContain("IMO • CC-BY-4.0");
  });

  it("omits header/footer when not given", () => {
    const html = buildCardHtml("<p>Hi</p>");
    expect(html).toBe('<div class="card-body"><p>Hi</p></div>');
  });
});

describe("renderMessageImage", () => {
  it("renders a whole message to one non-empty PNG", async () => {
    const png = await renderMessageImage("Let $M$ and $N$ be integers with $$M \\mid N.$$");
    expect(png.length).toBeGreaterThan(5000);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
  }, 60000);

  afterAll(async () => {
    await closeRenderer();
  });
});
