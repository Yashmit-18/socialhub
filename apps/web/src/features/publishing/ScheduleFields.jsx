import { CalendarClock, Send } from 'lucide-react';
import { useId, useMemo } from 'react';
import { Input, Select } from '../../components/ui/Field.jsx';
import { browserTimeZone, cn, timeZones } from '../../lib/utils.js';
import { dateBounds, formatInZone, resolveSchedule } from './schedule.js';

/**
 * Date, time and time zone of a scheduled post. `value` is `{ date, time, timeZone }`
 * (YYYY-MM-DD, HH:mm, IANA zone); the parent validates it with `resolveSchedule`.
 * When the chosen zone is not this browser's, the same moment is shown in local time too,
 * so nobody has to convert time zones in their head.
 */
export function ScheduleFields({
  value,
  onChange,
  error,
  now,
  disabled = false,
  workspaceTimeZone,
}) {
  const local = browserTimeZone();
  const zones = useMemo(() => {
    const list = new Set(timeZones());
    for (const zone of [value.timeZone, workspaceTimeZone, local, 'UTC']) {
      if (zone) list.add(zone);
    }
    return [...list].sort((a, b) => a.localeCompare(b));
  }, [value.timeZone, workspaceTimeZone, local]);
  const bounds = dateBounds(value.timeZone || local, now);
  const resolved = resolveSchedule(value, now);
  const chosenText = resolved.instant ? formatInZone(resolved.instant, value.timeZone) : null;
  const localText = resolved.instant ? formatInZone(resolved.instant, local) : null;
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Date"
          type="date"
          required
          disabled={disabled}
          min={bounds.min}
          max={bounds.max}
          value={value.date}
          onChange={(e) => set({ date: e.target.value })}
        />
        <Input
          label="Time"
          type="time"
          required
          disabled={disabled}
          value={value.time}
          onChange={(e) => set({ time: e.target.value })}
        />
      </div>
      <Select
        label="Time zone"
        disabled={disabled}
        value={value.timeZone}
        onChange={(e) => set({ timeZone: e.target.value })}
        hint={
          workspaceTimeZone && value.timeZone === workspaceTimeZone
            ? 'The workspace time zone (Settings).'
            : undefined
        }
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replaceAll('_', ' ')}
            {zone === workspaceTimeZone ? ' (workspace)' : zone === local ? ' (this device)' : ''}
          </option>
        ))}
      </Select>
      {error || resolved.error ? (
        <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-400">
          {error || resolved.error}
        </p>
      ) : (
        <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 dark:bg-white/5 dark:text-slate-200">
          Goes out on <span className="font-semibold">{chosenText}</span>
          {/* Compared as shown, not by name: zones such as Asia/Calcutta and Asia/Kolkata are one. */}
          {localText !== chosenText && (
            <span className="block text-xs text-muted">That is {localText} on this device.</span>
          )}
        </p>
      )}
    </div>
  );
}

/** "Now" or "Schedule for later", as two large radio options, then the schedule fields. */
export function WhenPicker({
  mode,
  onModeChange,
  schedule,
  onScheduleChange,
  scheduleError,
  now,
  disabled,
  workspaceTimeZone,
  simulated,
}) {
  const name = useId();
  const options = [
    {
      key: 'now',
      icon: Send,
      label: simulated ? 'Simulate now' : 'Publish now',
      text: 'Sent to the publishing queue straight away.',
    },
    {
      key: 'schedule',
      icon: CalendarClock,
      label: 'Schedule',
      text: 'Choose the date and time it goes out.',
    },
  ];
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">When</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;
          const checked = mode === option.key;
          return (
            <label
              key={option.key}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
                checked
                  ? 'border-brand-500 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-500/10'
                  : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.key}
                checked={checked}
                onChange={() => onModeChange(option.key)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{option.text}</span>
              </span>
            </label>
          );
        })}
      </div>
      {mode === 'schedule' && (
        <ScheduleFields
          value={schedule}
          onChange={onScheduleChange}
          error={scheduleError}
          now={now}
          disabled={disabled}
          workspaceTimeZone={workspaceTimeZone}
        />
      )}
    </fieldset>
  );
}
