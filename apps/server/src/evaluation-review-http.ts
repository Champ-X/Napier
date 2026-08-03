import type { Context, Hono } from "hono";

import { createId, type LocalStore } from "@napier/runtime";

import {
  setEvaluationAdjudicationHeaders,
  setEvaluationConsensusReportHeaders,
  setEvaluationConsensusResolutionListHeaders,
  setEvaluationConsensusResolutionResultHeaders,
  setEvaluationReviewerBallotHeaders,
  setEvaluationReviewerBallotListHeaders,
} from "./evaluation-review-http-response.js";
import {
  parseResolveEvaluationConsensusRequest,
  parseReviewRunEvaluationRequest,
  parseSubmitEvaluationReviewerBallotRequest,
} from "./evaluation-review-http-validation.js";

export type EvaluationReviewStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getEvaluationConsensusReport"
  | "listEvaluationAdjudications"
  | "listEvaluationConsensusResolutions"
  | "listEvaluationReviewerBallots"
  | "listRunEvaluations"
  | "resolveEvaluationConsensus"
  | "reviewRunEvaluation"
  | "submitEvaluationReviewerBallot"
>;

export interface EvaluationReviewHttpAdapter {
  readRequest(request: Request, label: string): Promise<unknown>;
  requestBodyTooLarge(error: unknown): boolean;
  errorMessage(error: unknown): string;
  jsonError(
    context: Context,
    message: string,
    status: 400 | 404 | 409 | 413,
  ): Response;
}

export function registerEvaluationReviewHttp(
  app: Hono,
  store: EvaluationReviewStore,
  adapter: EvaluationReviewHttpAdapter,
): void {
  registerAdjudicationHttp(app, store, adapter);
  registerBallotHttp(app, store, adapter);
  registerConsensusHttp(app, store, adapter);
}

function registerAdjudicationHttp(
  app: Hono,
  store: EvaluationReviewStore,
  adapter: EvaluationReviewHttpAdapter,
): void {
  app.post(
    "/api/threads/:threadId/evaluations/:evaluationId/adjudication",
    async (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      const body = await readBody(
        context,
        "Evaluation adjudication request",
        parseReviewRunEvaluationRequest,
        "Evaluation adjudication request is invalid",
        adapter,
      );
      if (body instanceof Response) return body;
      const evaluation = store
        .listRunEvaluations(threadId)
        .find((candidate) => candidate.id === evaluationId);
      if (!evaluation) {
        return adapter.jsonError(
          context,
          `Run evaluation not found: ${evaluationId}`,
          404,
        );
      }
      const current = store
        .listEvaluationAdjudications(threadId)
        .find((candidate) => candidate.evaluationId === evaluationId);
      const adjudication = await store.reviewRunEvaluation(
        threadId,
        evaluationId,
        body,
      );
      if (adjudication.currentRevision !== current?.currentRevision) {
        const revision = adjudication.revisions.at(-1)!;
        await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "evaluation.adjudication.reviewed",
          category: "evaluation",
          visibility: "user",
          payload: {
            evaluationId,
            adjudicationId: adjudication.id,
            revision: revision.revision,
            modelVerdict: evaluation.verdict,
            expectedVerdict: revision.expectedVerdict,
            agreement: evaluation.verdict === revision.expectedVerdict,
            evaluationSha256: revision.evaluationSha256,
            adjudicationSha256: revision.contentSha256,
          },
        });
      }
      setEvaluationAdjudicationHeaders(context, adjudication);
      return context.json(adjudication, current ? 200 : 201);
    },
  );
}

function registerBallotHttp(
  app: Hono,
  store: EvaluationReviewStore,
  adapter: EvaluationReviewHttpAdapter,
): void {
  app.get(
    "/api/threads/:threadId/evaluations/:evaluationId/reviewer-ballots",
    (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      const ballots = store.listEvaluationReviewerBallots(
        threadId,
        evaluationId,
      );
      setEvaluationReviewerBallotListHeaders(
        context,
        threadId,
        evaluationId,
        ballots,
      );
      return context.json(ballots);
    },
  );

  app.post(
    "/api/threads/:threadId/evaluations/:evaluationId/reviewer-ballots",
    async (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      const body = await readBody(
        context,
        "Evaluation reviewer ballot request",
        parseSubmitEvaluationReviewerBallotRequest,
        "Evaluation reviewer ballot is invalid",
        adapter,
      );
      if (body instanceof Response) return body;
      const current = store
        .listEvaluationReviewerBallots(threadId, evaluationId)
        .find(
          (ballot) =>
            ballot.reviewerId === body.reviewerId.trim().toLowerCase(),
        );
      const ballot = await store.submitEvaluationReviewerBallot(
        threadId,
        evaluationId,
        body,
      );
      if (ballot.currentRevision !== current?.currentRevision) {
        const revision = ballot.revisions.at(-1)!;
        await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "evaluation.reviewer_ballot.recorded",
          category: "evaluation",
          visibility: "user",
          payload: {
            evaluationId,
            ballotId: ballot.id,
            reviewerId: ballot.reviewerId,
            revision: revision.revision,
            expectedVerdict: revision.expectedVerdict,
            evaluationSha256: revision.evaluationSha256,
            ballotSha256: revision.contentSha256,
          },
        });
      }
      setEvaluationReviewerBallotHeaders(context, ballot);
      return context.json(ballot, current ? 200 : 201);
    },
  );
}

function registerConsensusHttp(
  app: Hono,
  store: EvaluationReviewStore,
  adapter: EvaluationReviewHttpAdapter,
): void {
  app.post(
    "/api/threads/:threadId/evaluations/:evaluationId/consensus/preview",
    async (context) => {
      const body = await readBody(
        context,
        "Evaluation consensus preview request",
        parseResolveEvaluationConsensusRequest,
        "Evaluation consensus gate is invalid",
        adapter,
      );
      if (body instanceof Response) return body;
      const report = store.getEvaluationConsensusReport(
        context.req.param("threadId"),
        context.req.param("evaluationId"),
        body.gate,
      );
      setEvaluationConsensusReportHeaders(context, report);
      return context.json(report);
    },
  );

  app.post(
    "/api/threads/:threadId/evaluations/:evaluationId/consensus/resolve",
    async (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      const body = await readBody(
        context,
        "Evaluation consensus resolution request",
        parseResolveEvaluationConsensusRequest,
        "Evaluation consensus gate is invalid",
        adapter,
      );
      if (body instanceof Response) return body;
      let result;
      try {
        result = await store.resolveEvaluationConsensus(
          threadId,
          evaluationId,
          body,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("not ready for resolution")
        ) {
          return adapter.jsonError(context, error.message, 409);
        }
        throw error;
      }
      if (result.created) {
        await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "evaluation.consensus.resolved",
          category: "evaluation",
          visibility: "user",
          payload: {
            evaluationId,
            resolutionId: result.resolution.id,
            reviewerCount: result.report.reviewerCount,
            consensusVerdict: result.report.consensusVerdict ?? "",
            agreementRate: result.report.agreementRate,
            reportSha256: result.report.contentSha256,
            adjudicationId: result.adjudication.id,
            adjudicationRevision:
              result.resolution.adjudicationRevision.revision,
            adjudicationSha256:
              result.resolution.adjudicationRevision.contentSha256,
            resolutionSha256: result.resolution.contentSha256,
          },
        });
      }
      setEvaluationConsensusResolutionResultHeaders(context, result);
      return context.json(result, result.created ? 201 : 200);
    },
  );

  app.get(
    "/api/threads/:threadId/evaluations/:evaluationId/consensus-resolutions",
    (context) => {
      const threadId = context.req.param("threadId");
      const evaluationId = context.req.param("evaluationId");
      const resolutions = store.listEvaluationConsensusResolutions(
        threadId,
        evaluationId,
      );
      setEvaluationConsensusResolutionListHeaders(
        context,
        threadId,
        evaluationId,
        resolutions,
      );
      return context.json(resolutions);
    },
  );
}

async function readBody<T>(
  context: Context,
  label: string,
  parse: (input: unknown) => T | undefined,
  invalidMessage: string,
  adapter: EvaluationReviewHttpAdapter,
): Promise<T | Response> {
  let input: unknown;
  try {
    input = await adapter.readRequest(context.req.raw, label);
  } catch (error) {
    return adapter.jsonError(
      context,
      adapter.errorMessage(error),
      adapter.requestBodyTooLarge(error) ? 413 : 400,
    );
  }
  return parse(input) ?? adapter.jsonError(context, invalidMessage, 400);
}
