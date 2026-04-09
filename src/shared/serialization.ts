import { NOTE_LINK_LABEL, NOTE_LINK_SCHEME, NOTE_META_SEPARATOR } from "./constants";
import type {
  NoteKind,
  NoteEntity,
  WebAnnotationEntity,
  PageDescriptor,
  PageDocumentEntity,
  PageKey,
  SerializedSelector
} from "./types";

const buildTimestamp = (): string => new Date().toISOString();

const normalizeUrl = (rawUrl: string): string => new URL(rawUrl).toString();
const normalizeStableUrl = (rawUrl: string): string => {
  const nextUrl = new URL(rawUrl);
  nextUrl.hash = "";
  return nextUrl.toString();
};

export const buildLegacyPageKey = (rawUrl: string): PageKey => normalizeUrl(rawUrl);
export const buildPageKey = (rawUrl: string): PageKey => normalizeStableUrl(rawUrl);

export const createPageDescriptor = (rawUrl: string, title: string): PageDescriptor => ({
  key: buildPageKey(rawUrl),
  url: normalizeStableUrl(rawUrl),
  sourceUrl: normalizeUrl(rawUrl),
  title: title.trim() || new URL(rawUrl).hostname,
  lastSeenAt: buildTimestamp()
});

const normalizeQuoteText = (quoteText: string): string => quoteText.replace(/\s+/g, " ").trim();

const escapeMarkdownLine = (line: string): string => line.replace(/([\\`*_[\]()#+\-!])/g, "\\$1");

export const buildNoteLink = (noteId: string): string => `${NOTE_LINK_SCHEME}${noteId}`;

export const parseNoteLink = (href: string): string | null => {
  if (!href.startsWith(NOTE_LINK_SCHEME)) {
    return null;
  }

  const noteId = href.slice(NOTE_LINK_SCHEME.length).trim();
  return noteId || null;
};

export const buildMarkdownSnippet = (input: {
  noteId: string;
  quoteText: string;
  pageTitle: string;
  createdAt: string;
}): string => {
  const compactQuote = normalizeQuoteText(input.quoteText);
  const quoteLines = compactQuote
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => `> ${escapeMarkdownLine(line)}`)
    .join("\n");

  const metaLine = `> [${NOTE_LINK_LABEL}](${buildNoteLink(input.noteId)})${NOTE_META_SEPARATOR}${escapeMarkdownLine(input.pageTitle)}${NOTE_META_SEPARATOR}${input.createdAt}`;
  return `\n${quoteLines}\n>\n${metaLine}\n`;
};

export const createNoteEntity = (input: {
  kind: NoteKind;
  page: PageDescriptor;
  quoteText: string;
  selectors: SerializedSelector;
}): NoteEntity => {
  const createdAt = buildTimestamp();
  const id = crypto.randomUUID();

  return {
    id,
    kind: input.kind,
    pageKey: input.page.key,
    pageUrl: input.page.url,
    pageTitle: input.page.title,
    quoteText: normalizeQuoteText(input.quoteText),
    selectors: input.selectors,
    markdownSnippet: buildMarkdownSnippet({
      noteId: id,
      quoteText: input.quoteText,
      pageTitle: input.page.title,
      createdAt
    }),
    createdAt,
    updatedAt: createdAt
  };
};

export const createWebAnnotationEntity = (input: {
  pageKey: PageKey;
  content: string;
  x: number;
  y: number;
}): WebAnnotationEntity => {
  const createdAt = buildTimestamp();

  return {
    id: crypto.randomUUID(),
    pageKey: input.pageKey,
    content: input.content.trim(),
    x: Math.round(input.x),
    y: Math.round(input.y),
    createdAt,
    updatedAt: createdAt
  };
};

export const createPageDocument = (page: PageDescriptor): PageDocumentEntity => ({
  pageKey: page.key,
  pageUrl: page.url,
  pageTitle: page.title,
  markdown: "",
  updatedAt: buildTimestamp()
});

export const getLegacySeededMarkdown = (page: PageDescriptor): string =>
  `# ${page.title}\n\nSource: ${page.url}\n\n`;
