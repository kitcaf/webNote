export type PageKey = string;
export type AnchorResolutionSource = "live" | "position" | "quote";
export type NoteKind = "excerpt" | "highlight";

export interface PageDescriptor {
  key: PageKey;
  url: string;
  sourceUrl: string;
  title: string;
  lastSeenAt: string;
}

export interface TextQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface TextPositionSelector {
  start: number;
  end: number;
}

export interface SerializedSelector {
  quote: TextQuoteSelector;
  position: TextPositionSelector;
}

export interface NoteEntity {
  id: string;
  kind: NoteKind;
  pageKey: PageKey;
  pageUrl: string;
  pageTitle: string;
  quoteText: string;
  selectors: SerializedSelector;
  markdownSnippet: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingInsert {
  noteId: string;
  pageKey: PageKey;
  markdownSnippet: string;
  createdAt: string;
}

export interface WebAnnotationEntity {
  id: string;
  pageKey: PageKey;
  content: string;
  x: number;
  y: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageDocumentEntity {
  pageKey: PageKey;
  pageUrl: string;
  pageTitle: string;
  markdown: string;
  updatedAt: string;
}

export interface PageMetaEntity {
  createdAt: string;
  updatedAt: string;
}

export interface PageRecord {
  page: PageDescriptor;
  document: PageDocumentEntity;
  annotations: WebAnnotationEntity[];
  notes: NoteEntity[];
  meta: PageMetaEntity;
}

export interface PageViewState {
  pageRecord: PageRecord | null;
  pendingInserts: PendingInsert[];
  tabId: number | null;
}

export interface LiveAnchor {
  noteId: string;
  range: Range;
  source: AnchorResolutionSource;
  rect: DOMRect | null;
  rects: DOMRect[];
}
