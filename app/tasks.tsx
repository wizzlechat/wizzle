import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch } from 'react-native';
import { Paragraph, ScrollView, Spinner, Text, YStack } from 'tamagui';
import type { Task } from '../src/protocol/index';
import { useConnection } from '../src/relay/connection';
import { store, useStore } from '../src/store';
import type { SendFailure } from '../src/store/types';
import { Play } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';
import { describeSchedule, runTime } from '../src/ui/schedule';
import { ConnectionBanner } from '../src/ui/status';
import { Menu } from '../src/ui/topics';

// One agent's scheduled tasks as the host lists them: a switch pauses or resumes one, a tap shows it and runs it now.
export default function Tasks() {
  const { agent: agentId = '' } = useLocalSearchParams<{ agent?: string }>();
  const conn = useConnection();
  const snapshot = useStore();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<SendFailure | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const agent = snapshot.agents.find((one) => one.id === agentId);
  const name = agent?.name ?? 'This agent';
  const can = snapshot.capabilities?.tasks === true;
  const tasks = snapshot.tasks?.filter((task) => task.agentId === agentId) ?? null;
  const open = openId === null ? null : (tasks?.find((task) => task.id === openId) ?? null);

  // Listed again on every connection, since agents schedule and cancel tasks on the host.
  useEffect(() => {
    if (can && conn.phase === 'connected') store.loadTasks();
  }, [can, conn.phase]);

  function change(task: Task, run: Promise<string>): void {
    setBusy((current) => new Set([...current, task.id]));
    setError(null);
    run
      .catch((failure: SendFailure) => setError(failure))
      .finally(() => setBusy((current) => new Set([...current].filter((one) => one !== task.id))));
  }

  function toggle(task: Task, on: boolean): void {
    if (busy.has(task.id)) return;
    change(task, on ? store.resumeTask(task.id) : store.pauseTask(task.id));
  }

  return (
    <>
      <Stack.Screen options={{ title: `${name} tasks` }} />
      <YStack flex={1}>
        <ConnectionBanner phase={conn.phase} error={conn.error} />
        <ScrollView>
          <YStack p="$4" gap="$3">
            {!can ? (
              <Paragraph p="$2" color="$color11" text="center">
                This bridge does not list scheduled tasks.
              </Paragraph>
            ) : tasks === null && snapshot.tasksError === null ? (
              <YStack p="$6" items="center">
                <Spinner />
              </YStack>
            ) : tasks === null || tasks.length === 0 ? (
              <Paragraph p="$2" color="$color11" text="center">
                {snapshot.tasksError ? snapshot.tasksError.message : `${name} has no scheduled tasks. Ask it to schedule one.`}
              </Paragraph>
            ) : (
              <ListSection title="Scheduled">
                {tasks.map((task) => (
                  <ListRow
                    key={task.id}
                    label={task.name}
                    detail={summary(task)}
                    trailing={<Switch value={task.enabled} disabled={busy.has(task.id)} onValueChange={(on) => toggle(task, on)} />}
                    onPress={() => setOpenId(task.id)}
                  />
                ))}
              </ListSection>
            )}
            {error ? (
              <Text px="$4" fontSize="$2" color="$red10">
                {error.message}
              </Text>
            ) : null}
            {tasks && tasks.length > 0 ? (
              <Text px="$4" fontSize="$2" color="$color11">
                Schedules are in the host's time zone. A paused task keeps its place and runs again once resumed.
              </Text>
            ) : null}
          </YStack>
        </ScrollView>
        {open ? (
          <TaskMenu task={open} busy={busy.has(open.id)} error={error} onRun={() => change(open, store.runTask(open.id))} onClose={() => setOpenId(null)} />
        ) : null}
      </YStack>
    </>
  );
}

function summary(task: Task): string {
  const schedule = describeSchedule(task.schedule);
  if (!task.enabled) return `${schedule}, paused`;
  return task.nextRunAt ? `${schedule}, next ${runTime(task.nextRunAt)}` : schedule;
}

// The task in full: its prompt and run history, and a run now that queues one run without touching the schedule.
function TaskMenu({
  task,
  busy,
  error,
  onRun,
  onClose,
}: {
  task: Task;
  busy: boolean;
  error: SendFailure | null;
  onRun: () => void;
  onClose: () => void;
}) {
  const [queued, setQueued] = useState(false);
  const done = queued && !busy && !error;
  const runs = task.runs ?? 0;
  const failed = task.failedRuns ?? 0;
  const history = runs === 0 && failed === 0 ? 'Not run yet' : `${runs} ${runs === 1 ? 'run' : 'runs'}${failed > 0 ? `, ${failed} failed` : ''}`;
  return (
    <Menu title={task.name} onClose={onClose}>
      <YStack px="$4" py="$3" gap="$2">
        {task.prompt ? (
          <Text fontSize="$3" lineHeight={22} numberOfLines={8}>
            {task.prompt}
          </Text>
        ) : null}
        <Text fontSize="$2" color="$color10">
          {describeSchedule(task.schedule)}
        </Text>
        {task.enabled && task.nextRunAt ? (
          <Text fontSize="$2" color="$color10">
            {`Next ${runTime(task.nextRunAt)}`}
          </Text>
        ) : null}
        <Text fontSize="$2" color="$color10">
          {task.lastRunAt ? `${history}, last ${runTime(task.lastRunAt)}` : history}
        </Text>
      </YStack>
      <ListRow
        icon={Play}
        label={done ? 'Queued, it runs within a minute' : 'Run now'}
        busy={busy}
        disabled={done}
        onPress={() => {
          setQueued(true);
          onRun();
        }}
      />
      {error ? (
        <Text px="$4" py="$2" fontSize="$2" color="$red10">
          {error.message}
        </Text>
      ) : null}
    </Menu>
  );
}
