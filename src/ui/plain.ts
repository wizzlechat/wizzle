import { lexer, type Token, type Tokens } from 'marked';
import type { ChatEntry } from '../store/types.ts';

const PREVIEW_CHARS = 140;
// Only this much of a message is lexed for its preview; the markup never stretches 140 words past it.
const PREVIEW_SOURCE_CHARS = 600;

// Entries are replaced rather than changed, so each one's preview is computed once.
const previews = new WeakMap<ChatEntry, string>();

// The list's one line for a conversation: its last entry's words, without the markup the chat renders.
export function previewOf(entry: ChatEntry | null | undefined): string {
  if (!entry) return '';
  const cached = previews.get(entry);
  if (cached !== undefined) return cached;
  const raw = entry.kind === 'file' ? entry.text || (entry.file?.name ?? 'File') : entry.text || (entry.attachments?.[0]?.name ?? '');
  const source = raw.slice(0, PREVIEW_SOURCE_CHARS);
  const text = entry.format === 'markdown' && entry.role !== 'user' ? plainText(lexer(source), ' ') : source;
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
  previews.set(entry, preview);
  return preview;
}

// Block tokens join with `gap`; inline tokens inside them run together.
function plainText(tokens: Token[], gap: string): string {
  return tokens.map(plainToken).join(gap);
}

function plainToken(token: Token): string {
  switch (token.type) {
    case 'space':
    case 'hr':
    case 'br':
      return ' ';
    case 'html':
    case 'checkbox':
    case 'def':
      return '';
    case 'code':
    case 'codespan':
    case 'escape':
    case 'image':
      return token.text;
    case 'blockquote':
    case 'list_item':
      return plainText(token.tokens ?? [], ' ');
    case 'list':
      return plainText(token.items, ' ');
    case 'table':
      return [...token.header, ...token.rows.flat()].map((cell) => plainText(cell.tokens, '')).join(' ');
  }
  const rest = token as Tokens.Generic;
  if (rest.tokens) return plainText(rest.tokens, '');
  return typeof rest.text === 'string' ? rest.text : '';
}

// A message as it reads without its markdown, for copying: blocks a blank line apart, list items one per line.
export function plainMessage(markdown: string): string {
  return lexer(markdown)
    .map(copyBlock)
    .filter((block) => block.length > 0)
    .join('\n\n');
}

function copyBlock(token: Token): string {
  switch (token.type) {
    case 'space':
    case 'hr':
    case 'html':
    case 'def':
      return '';
    case 'code':
      return token.text;
    case 'blockquote':
      return (token.tokens ?? [])
        .map(copyBlock)
        .filter((block) => block.length > 0)
        .join('\n\n');
    case 'list': {
      const list = token as Tokens.List;
      const start = typeof list.start === 'number' ? list.start : 1;
      return list.items
        .map((item, i) => `${list.ordered ? `${start + i}.` : '•'} ${item.tokens.map(copyBlock).join('\n').trim()}`)
        .join('\n');
    }
    case 'table': {
      const table = token as Tokens.Table;
      return [table.header, ...table.rows].map((row) => row.map((cell) => copyInline(cell.tokens)).join('\t')).join('\n');
    }
  }
  const rest = token as Tokens.Generic;
  if (rest.tokens) return copyInline(rest.tokens).trim();
  return typeof rest.text === 'string' ? rest.text.trim() : '';
}

// A link keeps its address beside its words, since plain text cannot hold it any other way.
function copyInline(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'link') {
        const label = copyInline(token.tokens ?? []);
        return label === token.href ? label : `${label} (${token.href})`;
      }
      if (token.type === 'br') return '\n';
      if (token.type === 'html' || token.type === 'checkbox') return '';
      const rest = token as Tokens.Generic;
      if (rest.tokens) return copyInline(rest.tokens);
      return typeof rest.text === 'string' ? rest.text : '';
    })
    .join('');
}
