import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function edit(page: import("@playwright/test").Page, source: string) {
  await page.locator(".monaco-editor textarea").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
}
test("archive, editing, syntax failure and group view survive restart", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".svg-position svg")).toBeVisible();
  await page
    .getByRole("button", { name: "− PAS System", exact: true })
    .click();
  await expect(page.locator(".svg-position svg")).not.toContainText("PAS API");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "＋ PAS System", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".svg-position svg")).toBeVisible();
  await page
    .getByRole("button", { name: "＋ PAS System", exact: true })
    .click();
  await expect(page.locator(".svg-position svg")).toContainText("PAS API");
  await edit(page, "flowchart TB\n A[Invalid");
  await expect(page.locator(".error[role=alert]")).toBeVisible();
  await expect(page.locator(".svg-position svg")).toContainText("PAS API");
  await expect(page.locator(".stale")).toBeVisible();
  await edit(page, "flowchart LR\n A[Saved idea] --> B[Done]");
  await expect(page.locator(".svg-position svg")).toContainText("Saved idea");
  await expect(page.locator(".document-title small")).toContainText("Saved");
  await page.reload();
  await expect(page.locator(".svg-position svg")).toContainText("Saved idea");
});
test("frontmatter, offline rendering and three export formats", async ({
  page,
  context,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:1420") &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await expect(page.locator(".svg-position svg")).toBeVisible();
  await edit(
    page,
    '---\nconfig:\n  theme: forest\n  fontFamily: Inter\n---\nflowchart LR\n A["<b>Hello</b><br/><i>Line 2</i>"] --> B[("World\\nDB")]',
  );
  await expect(page.locator(".svg-position svg")).toContainText("Hello");
  await page.keyboard.press("ControlOrMeta+e");
  for (const format of ["SVG", "PNG", "PDF"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename().toLowerCase()).toContain(
      "." + format.toLowerCase(),
    );
    expect(await file.failure()).toBeNull();
    const bytes = await readFile((await file.path())!);
    if (format === "PNG")
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    if (format === "PDF") expect(bytes.toString("ascii", 0, 5)).toBe("%PDF-");
    if (format === "SVG") {
      expect(bytes.toString()).toContain("Hello");
      expect(bytes.toString()).toContain("@font-face");
    }
  }
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await context.setOffline(true);
  await edit(page, "flowchart LR\n Offline --> Ready");
  await expect(page.locator(".svg-position svg")).toContainText("Offline");
  expect(external).toEqual([]);
});
test("Markdown selection and explicit save/discard/cancel", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".svg-position svg")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+,");
  await page
    .getByLabel("Automatically save workspace diagrams")
    .uncheck();
  await page.getByRole("button", { name: "Done" }).click();
  await edit(page, "flowchart LR\n Dirty --> Draft");
  await page.locator("input[type=file]").setInputFiles({
    name: "blocks.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "```mermaid\nflowchart TB\n A --> B\n```\n```mermaid\nflowchart TB\n C --> D\n```",
    ),
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".document-title strong")).toHaveText(
    "My First Diagram",
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "blocks.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "```mermaid\nflowchart TB\n A --> B\n```\n```mermaid\nflowchart TB\n C --> D\n```",
    ),
  });
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("button", { name: "Block 2", exact: true }).click();
  await expect(page.locator(".document-title strong")).toHaveText(
    "blocks.md · block 2",
  );
  await expect(page.locator(".svg-position svg")).toContainText("C");
});

test("all bundled examples render, and app theme does not change diagram colors", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".svg-position svg")).toBeVisible();
  for (const name of [
    "Sequence",
    "Class",
    "State",
    "Entity Relationship",
    "Gantt",
    "Mindmap",
    "Pie",
    "Theme & Frontmatter",
  ]) {
    await page.keyboard.press("ControlOrMeta+Shift+N");
    await page.getByLabel("Template", { exact: true }).selectOption(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".svg-position svg")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(".error")).toHaveCount(0);
  }
  const before = await page.locator(".svg-position svg").innerHTML();
  await page.keyboard.press("ControlOrMeta+,");
  await page.getByLabel("Appearance", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "Done" }).click();
  expect(await page.locator(".svg-position svg").innerHTML()).toBe(before);
});
test("pending journal restores unsaved source and warns on stale export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const d = {
      id: "recovery",
      name: "Recovered Draft",
      code: "flowchart LR\n Draft --> Recovered",
      savedCode: "flowchart LR\n Saved --> Before",
      collapsed: [],
      modified: Date.now(),
      opened: Date.now(),
    };
    localStorage.setItem(
      "mermaid-recovery",
      JSON.stringify({
        version: 1,
        documents: [d],
        active: d.id,
        theme: "light",
        mermaidTheme: "default",
        debounce: 100,
        autosave: false,
      }),
    );
  });
  await page.goto("/");
  await expect(page.locator(".notice")).toContainText("recovered");
  await expect(page.locator(".svg-position svg")).toContainText("Recovered");
  await expect(page.locator(".document-title small")).toContainText(
    "Unsaved changes",
  );
  await edit(page, "flowchart LR\n A[broken");
  await expect(page.locator(".error")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+e");
  await page.getByRole("button", { name: "SVG", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Preview is Out of Date" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("undo history survives hiding the editor and untrusted links stay disabled", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".svg-position svg")).toBeVisible();
  await edit(page, "flowchart LR\n Edited --> View");
  await expect(page.locator(".svg-position svg")).toContainText("Edited");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await page.locator(".monaco-editor textarea").focus();
  await page.keyboard.press("ControlOrMeta+Z");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("mermaid-archive")!).documents[0]
            .code,
      ),
    )
    .not.toBe("flowchart LR\n Edited --> View");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("mermaid-archive")!).documents[0]
            .code,
      ),
    )
    .toBe("flowchart LR\n Edited --> View");
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await edit(
    page,
    'flowchart LR\n A["Safe label"] --> B\n click A "javascript:alert(1)"',
  );
  await expect(page.locator(".svg-position svg")).toContainText("Safe label");
  await expect(
    page.locator(".svg-position a,.svg-position script,.svg-position iframe"),
  ).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test("preserves preview zoom/pan on edit, persists split width, and supports fullscreen & tab actions", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".svg-position svg")).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  await expect(page.locator(".offline")).toHaveCount(0);

  // Zoom in twice and pan the preview
  await page.getByRole("button", { name: "+" }).click();
  await page.getByRole("button", { name: "+" }).click();
  const zoomBefore = await page
    .locator(".zoom-controls button")
    .nth(1)
    .textContent();
  const transformBefore = await page
    .locator(".svg-position > div")
    .getAttribute("style");

  // Edit code in editor and verify zoom and centering are preserved
  await edit(page, "flowchart LR\n A[First] --> B[Second] --> C[Third]");
  await expect(page.locator(".svg-position svg")).toContainText("Third");
  await expect(page.locator(".zoom-controls button").nth(1)).toHaveText(
    zoomBefore!,
  );
  await expect(page.locator(".svg-position > div")).toHaveAttribute(
    "style",
    transformBefore!,
  );

  // Resize splitter with keyboard and verify split ratio persists after reload
  const splitter = page.getByRole("separator", { name: "Resize panels" });
  await splitter.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(splitter).toHaveAttribute("aria-valuenow", "44");
  await page.waitForTimeout(300);
  await page.reload();
  await expect(
    page.getByRole("separator", { name: "Resize panels" }),
  ).toHaveAttribute("aria-valuenow", "44");

  // Enter fullscreen preview mode and exit with Escape
  await page.getByRole("button", { name: /Full Screen/ }).click();
  await expect(page.locator(".preview-panel.fullscreen")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".preview-panel.fullscreen")).toHaveCount(0);

  // Context menu on sidebar item and stable ordering on click
  await page.locator(".document-card").first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Remove from Workspace" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.locator(".document-card")).toHaveCount(2);
  await expect(page.locator(".tab-item")).toHaveCount(2);
  const beforeOrder = await page
    .locator(".document-card strong")
    .allTextContents();
  await page.locator(".document-card").nth(1).click();
  const afterOrder = await page
    .locator(".document-card strong")
    .allTextContents();
  expect(afterOrder).toEqual(beforeOrder);

  // Tab context menu supports Rename and Close Tab
  await page.locator(".tab-item.active").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Close Tab" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Close Tab" }).click();
  await expect(page.locator(".tab-item")).toHaveCount(1);
  await expect(page.locator(".document-card")).toHaveCount(2);
});

test("splitter drag, cursor-anchored wheel zoom and tab reordering", async ({
  page,
}) => {
  await page.goto("/");
  const svg = page.locator(".svg-position svg");
  await expect(svg).toBeVisible();

  const splitter = page.getByRole("separator", { name: "Resize panels" });
  const panels = (await page.locator(".panels").boundingBox())!;
  const s = (await splitter.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(panels.x + panels.width * 0.3, s.y + s.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(splitter).toHaveAttribute("aria-valuenow", /^(29|30|31)/);

  const label = page.locator(".zoom-controls button").nth(1);
  const labelBefore = (await label.textContent())!;
  const before = (await svg.boundingBox())!;
  const cx = before.x + before.width * 0.25,
    cy = before.y + before.height * 0.25;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -200);
  await expect(label).not.toHaveText(labelBefore);
  const after = (await svg.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width);
  expect(Math.abs((cx - after.x) / after.width - 0.25)).toBeLessThan(0.02);
  expect(Math.abs((cy - after.y) / after.height - 0.25)).toBeLessThan(0.02);

  await page.locator(".document-card").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  const labels = page.locator(".tab-item .tab-label");
  await expect(labels).toHaveCount(2);
  const [first, second] = await labels.allTextContents();
  await page
    .locator(".tab-item")
    .nth(1)
    .dragTo(page.locator(".tab-item").nth(0), {
      targetPosition: { x: 4, y: 4 },
    });
  await expect(labels).toHaveText([second, first]);
});
