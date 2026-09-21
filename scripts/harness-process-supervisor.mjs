/** Supervise only the child this caller spawned. A stable completed report
 * bounds post-terminal lingering; original exit status and report proof remain
 * visible. This does not settle provider usage or make an observation eligible. */
export function superviseCampaignProcess(child, {
  readTerminalReport, signal, terminalGraceMs = 10000, killGraceMs = 5000,
  pollMs = 250, maxProcessMs = 1020000,
} = {}) {
  for (const value of [terminalGraceMs, killGraceMs, pollMs, maxProcessMs])
    if (!Number.isSafeInteger(value) || value < 1) throw Error("Invalid process supervision limit");
  if (typeof readTerminalReport !== "function") throw Error("Terminal report reader required");
  return new Promise((resolve, reject) => {
    let closed = false, timer, killTimer, deadlineTimer, proof, proofSince,
      cleanup, reportReadError;
    const clear = () => {
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(deadlineTimer);
      signal?.removeEventListener("abort", abort);
    };
    const terminate = (reason) => {
      if (closed || cleanup) return;
      cleanup = { pid: child.pid, reason, requestedAt: new Date().toISOString(), signal: "SIGTERM",
        ...(reason === "post_terminal_linger" ? { terminalReport: proof } : {}) };
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!closed) { cleanup.escalatedTo = "SIGKILL"; child.kill("SIGKILL"); }
      }, killGraceMs);
    };
    const abort = () => terminate("cancelled");
    child.once("error", error => { closed = true; clear(); reject(error); });
    child.once("close", (exitCode, exitSignal) => {
      if (closed) return;
      closed = true; clear();
      resolve({ exitCode, exitSignal, ...(cleanup ? { cleanup } : {}),
        ...(reportReadError ? { reportReadError } : {}) });
    });
    const poll = async () => {
      if (closed || cleanup) return;
      try {
        const next = await readTerminalReport();
        if (closed || cleanup) return;
        if (!next) { proof = undefined; proofSince = undefined; }
        else if (!proof || next.reportSha256 !== proof.reportSha256) {
          proof = next; proofSince = Date.now();
        } else if (Date.now() - proofSince >= terminalGraceMs) terminate("post_terminal_linger");
      } catch (error) {
        reportReadError = String(error.message ?? error);
        proof = undefined; proofSince = undefined;
      }
      if (!closed && !cleanup) timer = setTimeout(poll, pollMs);
    };
    signal?.addEventListener("abort", abort, { once: true });
    deadlineTimer = setTimeout(() => terminate("process_timeout"), maxProcessMs);
    if (signal?.aborted) abort();
    else void poll();
  });
}

/** The scheduler's exitCode means collection may proceed, not that the OS
 * process succeeded. Never normalize an active cancellation or missing proof.
 * readReport and the unchanged quality/usage gates still decide acceptance. */
export function campaignCollectionResult(processResult) {
  return processResult.cleanup?.reason === "post_terminal_linger" &&
    processResult.cleanup.terminalReport
    ? { exitCode: 0, reason: "terminal_report_available_after_cleanup", processResult }
    : { ...processResult, processResult };
}
