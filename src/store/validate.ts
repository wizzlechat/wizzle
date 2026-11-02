import { MAX_FILE_BYTES, ROOM_LIMITS } from '../protocol/index.ts';
import type { Accessory, Attachment, EyeStyle, ListStyle, SendFailure } from './types.ts';

// Limits wizzle checks before anything goes to the bridge, and the choices a profile may hold.
export const MAX_TITLE_CHARS = 60;
export const MAX_NAME_CHARS = 60;
export const MAX_PURPOSE_CHARS = 2000;
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_TOTAL = 32 * 1024 * 1024;
export const EYE_STYLES: EyeStyle[] = ['pill', 'dot', 'wide', 'visor'];
export const ACCESSORIES: Accessory[] = ['antenna', 'sprout', 'bow', 'crown', 'halo'];
export const LIST_STYLES: ListStyle[] = ['compact', 'large'];

function mib(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

// Why one more file cannot join a message, checked when it is picked and again on send.
export function attachmentFailure(current: Attachment[], next: Attachment): SendFailure | null {
  if (current.length >= MAX_ATTACHMENTS) return { code: 'too_many', message: `At most ${MAX_ATTACHMENTS} files per message.` };
  if (next.size > MAX_FILE_BYTES) return { code: 'too_large', message: `${next.name} is over ${mib(MAX_FILE_BYTES)}, the most one file can be.` };
  const total = current.reduce((sum, file) => sum + file.size, 0) + next.size;
  if (total > MAX_ATTACHMENT_TOTAL) return { code: 'too_large', message: `Files in one message add up to at most ${mib(MAX_ATTACHMENT_TOTAL)}.` };
  return null;
}

export function attachmentsFailure(attachments: Attachment[]): SendFailure | null {
  for (let i = 0; i < attachments.length; i += 1) {
    const failure = attachmentFailure(attachments.slice(0, i), attachments[i] as Attachment);
    if (failure) return failure;
  }
  return null;
}

// The host slugs a title to lowercase letters and digits; one with none of them has no id.
export function titleFailure(title: string): SendFailure | null {
  const name = title.trim();
  if (name.length === 0 || !/[a-z0-9]/i.test(name)) return { code: 'bad_request', message: 'A topic title needs a letter or a digit.' };
  if (name.length > MAX_TITLE_CHARS) return { code: 'bad_request', message: `A topic title is at most ${MAX_TITLE_CHARS} characters.` };
  return null;
}

// Mirrors the host's slug so the form can show the folder before the host makes it.
export function agentFolder(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 63)
    .replace(/[-_]+$/, '');
}

export function nameFailure(name: string): SendFailure | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { code: 'bad_request', message: 'An agent needs a name.' };
  if (trimmed.length > MAX_NAME_CHARS) return { code: 'bad_request', message: `An agent name is at most ${MAX_NAME_CHARS} characters.` };
  if (agentFolder(trimmed).length === 0) return { code: 'bad_request', message: 'An agent name needs a letter or a digit.' };
  if (trimmed.toLowerCase() === 'system') return { code: 'bad_request', message: 'System is a reserved name.' };
  return null;
}

export function roomTitleFailure(title: string): SendFailure | null {
  const trimmed = title.trim();
  if (trimmed.length === 0) return { code: 'bad_request', message: 'A room needs a name.' };
  if (trimmed.length > ROOM_LIMITS.title) return { code: 'bad_request', message: `A room name is at most ${ROOM_LIMITS.title} characters.` };
  return null;
}

export function roomMembersFailure(members: string[]): SendFailure | null {
  const { minMembers, maxMembers } = ROOM_LIMITS;
  if (new Set(members).size < minMembers) return { code: 'bad_request', message: `A room needs at least ${minMembers} agents.` };
  if (new Set(members).size > maxMembers) return { code: 'bad_request', message: `A room holds at most ${maxMembers} agents.` };
  return null;
}

export function purposeFailure(purpose: string): SendFailure | null {
  if (purpose.trim().length > MAX_PURPOSE_CHARS) {
    return { code: 'too_long', message: `A purpose is at most ${MAX_PURPOSE_CHARS} characters.` };
  }
  return null;
}

// The host stamps the new agent's container clock from this, and refuses anything that is not an IANA id.
export function deviceTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone !== 'string') return undefined;
    return zone === 'UTC' || /^[A-Za-z][A-Za-z_+-]*\/[A-Za-z0-9_+\-/]+$/.test(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}
