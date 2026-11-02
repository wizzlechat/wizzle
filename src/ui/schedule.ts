const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clock(hour: string, minute: string): string {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function ordinal(day: string): string {
  const n = Number(day);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

// The common cron shapes in words, in the host's own time; anything else is shown as it is.
export function describeSchedule(schedule: string): string {
  if (schedule === 'once') return 'Once';
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return schedule;
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const plain = /^\d{1,2}$/;
  const every = /^\*\/(\d{1,2})$/;
  const minutes = every.exec(minute);
  if (minutes && hour === '*' && dom === '*' && month === '*' && dow === '*') return `Every ${minutes[1]} minutes`;
  const hours = every.exec(hour);
  if (hours && plain.test(minute) && dom === '*' && month === '*' && dow === '*') return `Every ${hours[1]} hours`;
  if (plain.test(minute) && hour === '*' && dom === '*' && month === '*' && dow === '*') return `Hourly at :${minute.padStart(2, '0')}`;
  if (!plain.test(minute) || !plain.test(hour) || month !== '*') return schedule;
  const at = clock(hour, minute);
  if (dom === '*') {
    if (dow === '*') return `Daily at ${at}`;
    if (dow === '1-5') return `Weekdays at ${at}`;
    if (dow === '0,6' || dow === '6,0') return `Weekends at ${at}`;
    if (/^[0-7]$/.test(dow)) return `${DAYS[Number(dow) % 7]} at ${at}`;
    if (/^[0-7](,[0-7])+$/.test(dow)) return `${dow.split(',').map((day) => SHORT_DAYS[Number(day) % 7]).join(', ')} at ${at}`;
    return schedule;
  }
  if (dow === '*' && plain.test(dom)) return `Monthly on the ${ordinal(dom)} at ${at}`;
  return schedule;
}

// A run time relative to today, with the clock time in the phone's zone.
export function runTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = date.toDateString();
  if (day === new Date(now).toDateString()) return `today at ${time}`;
  if (day === new Date(now + 86_400_000).toDateString()) return `tomorrow at ${time}`;
  if (day === new Date(now - 86_400_000).toDateString()) return `yesterday at ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}
