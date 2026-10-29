import { useState } from 'react';
import { Button, Text, XStack, YStack } from 'tamagui';
import type { ApprovalDecision } from '../protocol/index.ts';
import { store } from '../store/index.ts';
import type { OpenApproval, OpenQuestion } from '../store/types.ts';
import { useDeadline } from './deadline.ts';
import { shortTime } from './time.ts';

const DECISION: Record<ApprovalDecision, string> = { allow: 'Allow', deny: 'Deny', allow_always: 'Always allow' };

// A question buffered while wizzle was away can arrive spent, and an open one can run out.
export function QuestionCard({ open, conv }: { open: OpenQuestion; conv: string }) {
  const { question } = open;
  const [picked, setPicked] = useState<string[]>([]);
  const multi = question.multi === true;
  const expired = useDeadline(question.expiresAt);

  function toggle(value: string): void {
    setPicked((current) => (current.includes(value) ? current.filter((one) => one !== value) : [...current, value]));
  }

  return (
    <Card>
      {question.title ? <Text fontWeight="700">{question.title}</Text> : null}
      <Text>{question.question}</Text>
      {question.expiresAt ? (
        <Text fontSize="$1" color="$color10">
          {`${expired ? 'Expired' : 'Expires'} ${shortTime(question.expiresAt)}`}
        </Text>
      ) : null}
      {open.answered !== undefined ? (
        <Text fontSize="$2" color="$color11">
          {`Answered: ${[open.answered].flat().join(', ')}`}
        </Text>
      ) : expired ? (
        <Text fontSize="$2" color="$color11">
          This expired before an answer reached the agent, which went on with its default.
        </Text>
      ) : (
        <YStack gap="$2">
          <XStack gap="$2" flexWrap="wrap">
            {question.options.map((option) => (
              <Button
                key={option.value}
                size="$3"
                theme={option.style === 'danger' ? 'red' : option.style === 'primary' ? 'accent' : undefined}
                bg={multi && picked.includes(option.value) ? '$color6' : undefined}
                onPress={() => (multi ? toggle(option.value) : store.answer(conv, question.questionId, option.value))}
              >
                {option.label}
              </Button>
            ))}
          </XStack>
          {multi ? (
            <Button theme="accent" disabled={picked.length === 0} onPress={() => store.answer(conv, question.questionId, picked)}>
              {picked.length === 0 ? 'Pick one or more' : `Send ${picked.length}`}
            </Button>
          ) : null}
        </YStack>
      )}
    </Card>
  );
}

export function ApprovalCard({ open, conv }: { open: OpenApproval; conv: string }) {
  const { approval } = open;
  return (
    <Card>
      <Text fontWeight="700">{approval.title}</Text>
      {approval.description ? <Text>{approval.description}</Text> : null}
      {approval.command ? (
        <YStack p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$2">{approval.command}</Text>
        </YStack>
      ) : null}
      {approval.expiresAt ? (
        <Text fontSize="$1" color="$color10">
          {`Expires ${shortTime(approval.expiresAt)}`}
        </Text>
      ) : null}
      {open.decided ? (
        <Text fontSize="$2" color="$color11">
          {`Answered: ${DECISION[open.decided]}`}
        </Text>
      ) : (
        <XStack gap="$2" flexWrap="wrap">
          {approval.decisions.map((decision) => (
            <Button
              key={decision}
              size="$3"
              theme={decision === 'deny' ? 'red' : decision === 'allow' ? 'accent' : undefined}
              onPress={() => store.decide(conv, approval.approvalId, decision)}
            >
              {DECISION[decision]}
            </Button>
          ))}
        </XStack>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <YStack gap="$2" mx="$3" mb="$2" p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color1">
      {children}
    </YStack>
  );
}
