import { CalendarClock, Pause, Play, Plus, ShieldCheck } from "lucide-react";

import type { AutomationSchedule } from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";
import { formatAutomationDateTime } from "./automation-panel-helpers";
import type { AutomationScheduleController } from "./use-automation-schedule-controller";

export interface AutomationScheduleSectionProps {
  schedules: AutomationSchedule[];
  busyId: string | undefined;
  controller: AutomationScheduleController;
}

export function AutomationScheduleSection({
  schedules,
  busyId,
  controller,
}: AutomationScheduleSectionProps) {
  return (
    <section className="automation-register" aria-labelledby="schedules-title">
      <header className="automation-section-heading">
        <span className="automation-glyph" aria-hidden="true">
          <CalendarClock size={14} />
        </span>
        <div>
          <span>{copy.scheduleEyebrow}</span>
          <h3 id="schedules-title">{copy.schedules}</h3>
        </div>
      </header>
      <ScheduleComposer busyId={busyId} controller={controller} />
      {schedules.length === 0 ? (
        <p className="empty-panel">{copy.noSchedules}</p>
      ) : (
        <div className="automation-card-list">
          {schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              busy={busyId === schedule.id}
              onToggle={() => void controller.toggle(schedule)}
            />
          ))}
        </div>
      )}
      <p className="automation-safety">
        <ShieldCheck size={12} aria-hidden="true" />
        {copy.scheduleSafety}
      </p>
    </section>
  );
}

interface ScheduleComposerProps {
  busyId: string | undefined;
  controller: AutomationScheduleController;
}

function ScheduleComposer({ busyId, controller }: ScheduleComposerProps) {
  return (
    <form
      className="automation-compose"
      onSubmit={(event) => {
        event.preventDefault();
        void controller.add();
      }}
    >
      <label className="automation-field">
        <span>{copy.scheduleName}</span>
        <input
          required
          maxLength={100}
          value={controller.scheduleName}
          placeholder={copy.scheduleNamePlaceholder}
          onChange={(event) => controller.setScheduleName(event.target.value)}
        />
      </label>
      <label className="automation-field">
        <span>{copy.prompt}</span>
        <textarea
          required
          rows={4}
          maxLength={20_000}
          value={controller.prompt}
          placeholder={copy.promptPlaceholder}
          onChange={(event) => controller.setPrompt(event.target.value)}
        />
      </label>
      <div className="automation-field-grid">
        <label className="automation-field">
          <span>{copy.triggerType}</span>
          <select
            value={controller.triggerType}
            onChange={(event) =>
              controller.setTriggerType(
                event.target.value as typeof controller.triggerType,
              )
            }
          >
            <option value="interval">{copy.interval}</option>
            <option value="cron">{copy.cron}</option>
          </select>
        </label>
        <TriggerValueField controller={controller} />
      </div>
      <button
        className="automation-primary"
        type="submit"
        disabled={!controller.canCreate || Boolean(busyId)}
        aria-busy={busyId === "new-schedule"}
      >
        <Plus size={12} aria-hidden="true" />
        {busyId === "new-schedule" ? copy.creating : copy.createSchedule}
      </button>
    </form>
  );
}

function TriggerValueField({
  controller,
}: {
  controller: AutomationScheduleController;
}) {
  return controller.triggerType === "interval" ? (
    <label className="automation-field">
      <span>{copy.intervalMinutes}</span>
      <input
        type="number"
        min={1}
        max={43_200}
        value={controller.intervalMinutes}
        onChange={(event) => {
          if (Number.isFinite(event.target.valueAsNumber)) {
            controller.setIntervalMinutes(event.target.valueAsNumber);
          }
        }}
      />
    </label>
  ) : (
    <label className="automation-field">
      <span>{copy.cronExpression}</span>
      <input
        value={controller.cronExpression}
        placeholder={copy.cronPlaceholder}
        onChange={(event) => controller.setCronExpression(event.target.value)}
      />
    </label>
  );
}

interface ScheduleCardProps {
  schedule: AutomationSchedule;
  busy: boolean;
  onToggle: () => void;
}

function ScheduleCard({ schedule, busy, onToggle }: ScheduleCardProps) {
  const active = schedule.status === "active";
  return (
    <article className="schedule-card">
      <header>
        <div>
          <span>{schedule.trigger.type}</span>
          <strong>{schedule.name}</strong>
        </div>
        <span className={`automation-state state-${schedule.status}`}>
          {active ? copy.active : copy.paused}
        </span>
      </header>
      <p>{schedule.prompt}</p>
      <dl>
        <div>
          <dt>{copy.nextRun}</dt>
          <dd>{formatAutomationDateTime(schedule.nextRunAt)}</dd>
        </div>
        <div>
          <dt>{copy.lastRun}</dt>
          <dd>
            {schedule.lastRunAt
              ? formatAutomationDateTime(schedule.lastRunAt)
              : copy.never}
          </dd>
        </div>
      </dl>
      <footer>
        <span>
          {schedule.claim
            ? `${copy.claim} · ${schedule.claim.ownerId}`
            : `${copy.revision} ${schedule.revision}`}
        </span>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={onToggle}
        >
          {active ? (
            <Pause size={10} aria-hidden="true" />
          ) : (
            <Play size={10} aria-hidden="true" />
          )}
          {active ? copy.pause : copy.resume}
        </button>
      </footer>
    </article>
  );
}
