import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeSchedule, runTime } from '../src/ui/schedule.ts';

test('the common cron shapes read as words and the rest stay as written', () => {
  assert.equal(describeSchedule('once'), 'Once');
  assert.equal(describeSchedule('0 9 * * *'), 'Daily at 09:00');
  assert.equal(describeSchedule('30 18 * * 1-5'), 'Weekdays at 18:30');
  assert.equal(describeSchedule('0 10 * * 0,6'), 'Weekends at 10:00');
  assert.equal(describeSchedule('5 7 * * 1'), 'Mondays at 07:05');
  assert.equal(describeSchedule('0 8 * * 7'), 'Sundays at 08:00');
  assert.equal(describeSchedule('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(describeSchedule('0 */6 * * *'), 'Every 6 hours');
  assert.equal(describeSchedule('0 9 1 * *'), 'Monthly on the 1st at 09:00');
  assert.equal(describeSchedule('0 9 22 * *'), 'Monthly on the 22nd at 09:00');
  assert.equal(describeSchedule('0 9 11 * *'), 'Monthly on the 11th at 09:00');
  assert.equal(describeSchedule('0 9 * 6 *'), '0 9 * 6 *');
  assert.equal(describeSchedule('0 9,17 * * *'), '0 9,17 * * *');
  assert.equal(describeSchedule('15 9 * * 1,3,5'), 'Mon, Wed, Fri at 09:15');
  assert.equal(describeSchedule('30 * * * *'), 'Hourly at :30');
  assert.equal(describeSchedule('0 9 * * 1-3'), '0 9 * * 1-3');
  assert.equal(describeSchedule('weird'), 'weird');
});

test('a run time is relative to today', () => {
  const now = new Date(2026, 10, 3, 12, 0).getTime();
  const at = (days: number, hour: number) => new Date(2026, 10, 3 + days, hour, 15).getTime();
  const time = (hour: number) => new Date(2026, 10, 3, hour, 15).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  assert.equal(runTime(at(0, 9), now), `today at ${time(9)}`);
  assert.equal(runTime(at(1, 9), now), `tomorrow at ${time(9)}`);
  assert.equal(runTime(at(-1, 18), now), `yesterday at ${time(18)}`);
  const later = new Date(2026, 10, 10, 9, 15);
  assert.equal(
    runTime(later.getTime(), now),
    `${later.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time(9)}`,
  );
});
