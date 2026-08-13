import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export async function verifyBrowserInspector(page) {
  await openBrowserInspector(page);
  const localProductDefault = await readLocalProductDefault(page);
  const retryRecovery = await verifyLocalRetry(page, localProductDefault);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openBrowserInspector(page);
  const restoredHistory = await readRestoredHistory(page);
  const backend = page.locator('select[name="backend"]');
  assert.equal(await backend.inputValue(), "browser_use_local");
  const localDisclosure =
    (await page.locator(".browser-task-local-disclosure").textContent()) ?? "";
  await backend.selectOption("browser_use_cloud");
  const disclosure = page.locator(".browser-task-cloud-disclosure");
  await disclosure.waitFor({ state: "visible" });
  const receipt = await page.evaluate(
    ({
      localDisclosure,
      localProductDefault,
      retryRecovery,
      restoredHistory,
    }) => {
      const selectedBackend = document.querySelector('select[name="backend"]');
      const provider = document.querySelector('select[name="provider"]');
      const consent = document.querySelector('input[name="cloudConsent"]');
      const rect = document
        .querySelector(".browser-inspector-card")
        ?.getBoundingClientRect();
      return {
        tabSelected:
          document
            .getElementById("inspector-tab-browser")
            ?.getAttribute("aria-selected") === "true",
        panelLabelledBy:
          document
            .getElementById("inspector-active-panel")
            ?.getAttribute("aria-labelledby") ?? "",
        title:
          document
            .getElementById("browser-inspector-title")
            ?.textContent?.trim() ?? "",
        actionDisabled:
          document.querySelector(".browser-inspector-card button") instanceof
          HTMLButtonElement
            ? document.querySelector(".browser-inspector-card button").disabled
            : false,
        layoutRect: rect
          ? {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          : null,
        selectedBackend:
          selectedBackend instanceof HTMLSelectElement
            ? selectedBackend.value
            : "",
        localDisclosure,
        localProductDefault,
        cloudDisclosure:
          document.querySelector(".browser-task-cloud-disclosure")
            ?.textContent ?? "",
        consentRequired:
          consent instanceof HTMLInputElement ? consent.required : false,
        consentChecked:
          consent instanceof HTMLInputElement ? consent.checked : true,
        provider: provider instanceof HTMLSelectElement ? provider.value : "",
        modelId:
          document.querySelector('input[name="modelId"]') instanceof
          HTMLInputElement
            ? document.querySelector('input[name="modelId"]').value
            : "",
        credentialEnv:
          document.querySelector('input[name="credentialEnv"]') instanceof
          HTMLInputElement
            ? document.querySelector('input[name="credentialEnv"]').value
            : "",
        maxCostUsd:
          document.querySelector('input[name="maxCostUsd"]') instanceof
          HTMLInputElement
            ? document.querySelector('input[name="maxCostUsd"]').value
            : "",
        retryRecovery,
        restoredHistory,
      };
    },
    { localDisclosure, localProductDefault, retryRecovery, restoredHistory },
  );
  const recoveryResponse = await page.request.post(
    new URL("/api/browser-tasks", page.url()).href,
    {
      data: {
        backend: "browser_use_cloud",
        task: "Summarize the public Example Domain page",
        startUrl: "https://example.com/",
        model: { provider: "browser-use", id: "browser-use-2.0" },
        credentialEnv: "BROWSER_USE_API_KEY",
        allowedDomains: ["example.com"],
        maxSteps: 5,
        maxCostUsd: 1,
      },
    },
  );
  assert.equal(recoveryResponse.status(), 409);
  const recovery = await recoveryResponse.json();
  receipt.credentialRecovery = `${recovery.error}. ${recovery.recovery}`;
  receipt.credentialRecoveryCode = recovery.code;
  await page.locator("#inspector-group-activity").click();
  return receipt;
}

async function readRestoredHistory(page) {
  await page.waitForFunction(
    () =>
      document
        .querySelector(".browser-task-actions [role=status]")
        ?.textContent?.includes("restored history · terminal") === true,
    undefined,
    { timeout: 10_000 },
  );
  return page.evaluate(() => ({
    status:
      document.querySelector(".browser-task-actions [role=status]")
        ?.textContent ?? "",
    retryVisible: [...document.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Retry same task"),
    ),
    steps: document.querySelector(".browser-task-steps")?.textContent ?? "",
    recovery:
      document.querySelector(".browser-task-terminal")?.textContent ?? "",
  }));
}

async function openBrowserInspector(page) {
  const group = page.locator("#inspector-group-inspect");
  await group.waitFor({ state: "attached", timeout: 10_000 });
  if (!(await group.isVisible())) {
    await page.locator(".inspector-drawer-trigger").click();
  }
  await group.click();
  await page.locator("#inspector-tab-browser").click();
  await page
    .locator("#browser-inspector-title")
    .waitFor({ state: "visible", timeout: 10_000 });
}

async function readLocalProductDefault(page) {
  return page.evaluate(() => {
    const provider = document.querySelector('select[name="provider"]');
    const model = document.querySelector('input[name="modelId"]');
    const credentialEnv = document.querySelector('input[name="credentialEnv"]');
    return {
      provider: provider instanceof HTMLSelectElement ? provider.value : "",
      modelId: model instanceof HTMLInputElement ? model.value : "",
      credentialEnv:
        credentialEnv instanceof HTMLInputElement ? credentialEnv.value : "",
      credentialBinding:
        document.querySelector(".browser-task-credential > p")?.textContent ??
        "",
    };
  });
}

async function verifyLocalRetry(page, localProductDefault) {
  const task = "Summarize the public Example Domain page";
  const startUrl = "https://example.com/";
  const domain = "example.com";
  const credentialEnv = "";
  const taskId = "browser_task_web_ui_retry";
  const created = {
    taskId,
    backend: "browser_use_local",
    status: "running",
    streamUrl: `/api/browser-tasks/${taskId}/stream`,
    stopUrl: `/api/browser-tasks/${taskId}/stop`,
    pauseUrl: `/api/browser-tasks/${taskId}/pause`,
    resumeUrl: `/api/browser-tasks/${taskId}/resume`,
    takeoverUrl: `/api/browser-tasks/${taskId}/takeover`,
  };
  const createPattern = "**/api/browser-tasks";
  const streamPattern = `**${created.streamUrl}`;
  await page.route(createPattern, async (route) => {
    const request = route.request().postDataJSON();
    assert.equal(request.credentialEnv, "");
    assert.deepEqual(request.model, {
      provider: localProductDefault.provider,
      id: localProductDefault.modelId,
    });
    assert.equal(
      JSON.stringify(request).includes("e2e-placeholder-key"),
      false,
    );
    const body = JSON.stringify(created);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: verifiedTaskHeaders(taskId, body),
      body,
    });
  });
  await page.route(streamPattern, async (route) => {
    const event = {
      type: "error",
      backend: "browser_use_local",
      code: "browser_process_exited",
      message: "The browser process exited",
      diagnosticSha256: "a".repeat(64),
      recovery: "Retry the task with the same settings",
    };
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: verifiedTaskHeaders(taskId),
      body: `event: error\nid: 1\ndata: ${JSON.stringify(event)}\n\n`,
    });
  });
  await page.locator('textarea[name="task"]').fill(task);
  await page.locator('input[name="startUrl"]').fill(startUrl);
  await page.locator('input[name="allowedDomains"]').fill(domain);
  await page.getByRole("button", { name: "Start local task" }).click();
  const retry = page.getByRole("button", { name: "Retry same task" });
  await retry.waitFor({ state: "visible", timeout: 10_000 });
  const recovery =
    (await page.locator(".browser-task-terminal").textContent()) ?? "";
  const settingsPreserved = await page.evaluate(
    ({ task, startUrl, domain, credentialEnv }) =>
      document.querySelector('textarea[name="task"]')?.value === task &&
      document.querySelector('input[name="startUrl"]')?.value === startUrl &&
      document.querySelector('input[name="allowedDomains"]')?.value ===
        domain &&
      document.querySelector('input[name="credentialEnv"]')?.value ===
        credentialEnv,
    { task, startUrl, domain, credentialEnv },
  );
  await page.unroute(createPattern);
  await page.unroute(streamPattern);
  return {
    actionVisible: await retry.isVisible(),
    settingsPreserved,
    recovery,
  };
}

function verifiedTaskHeaders(taskId, body) {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Napier-Browser-Task-Id": taskId,
    "X-Napier-Browser-Backend": "browser_use_local",
    ...(body
      ? {
          "X-Napier-Content-SHA256": createHash("sha256")
            .update(body)
            .digest("hex"),
          "X-Napier-Content-SHA256-Mode": "body",
        }
      : {}),
  };
}
