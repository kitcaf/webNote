import {
  ANNOTATION_STORAGE_PREFIX,
  ANNOTATION_DEFAULT_WIDTH_PX,
  ANNOTATION_MIN_WIDTH_PX,
  DOCUMENT_STORAGE_PREFIX,
  LEGACY_PAGE_STORAGE_PREFIX,
  NOTE_STORAGE_PREFIX,
  PAGE_META_STORAGE_PREFIX
} from "../shared/constants";
import {
  buildLegacyPageKey,
  createPageDocument,
  getLegacySeededMarkdown
} from "../shared/serialization";
import type {
  NoteEntity,
  NoteKind,
  PageDescriptor,
  PageDocumentEntity,
  PageKey,
  PageMetaEntity,
  PageRecord,
  PendingInsert,
  WebAnnotationEntity
} from "../shared/types";

interface UpsertNoteOptions {
  enqueueInsert?: boolean;
}

interface PageStorageMetaRecord {
  meta: PageMetaEntity;
  page: PageDescriptor;
}

interface NormalizedLegacyPageRecordResult {
  legacyPendingInserts: PendingInsert[];
  pageRecord: PageRecord | null;
}

type StoredPageMetaCandidate = Partial<PageStorageMetaRecord>;
type StoredPageRecordCandidate = Partial<PageRecord> & {
  pendingInserts?: unknown;
};

const pageMutationQueues = new Map<PageKey, Promise<void>>();
const runtimePendingInsertQueues = new Map<PageKey, PendingInsert[]>();

const getPageMetaStorageKey = (pageKey: PageKey): string => `${PAGE_META_STORAGE_PREFIX}${pageKey}`;
const getDocumentStorageKey = (pageKey: PageKey): string => `${DOCUMENT_STORAGE_PREFIX}${pageKey}`;
const getNoteStorageKey = (pageKey: PageKey): string => `${NOTE_STORAGE_PREFIX}${pageKey}`;
const getAnnotationStorageKey = (pageKey: PageKey): string => `${ANNOTATION_STORAGE_PREFIX}${pageKey}`;
const getLegacyPageStorageKey = (pageKey: PageKey): string => `${LEGACY_PAGE_STORAGE_PREFIX}${pageKey}`;

const buildPageStorageKeys = (pageKey: PageKey): {
  annotationKey: string;
  documentKey: string;
  legacyPageKey: string;
  metaKey: string;
  notesKey: string;
} => ({
  annotationKey: getAnnotationStorageKey(pageKey),
  documentKey: getDocumentStorageKey(pageKey),
  legacyPageKey: getLegacyPageStorageKey(pageKey),
  metaKey: getPageMetaStorageKey(pageKey),
  notesKey: getNoteStorageKey(pageKey)
});

const clonePendingInsert = (pendingInsert: PendingInsert): PendingInsert => ({
  createdAt: pendingInsert.createdAt,
  markdownSnippet: pendingInsert.markdownSnippet,
  noteId: pendingInsert.noteId,
  pageKey: pendingInsert.pageKey
});

const clonePendingInserts = (pendingInserts: Iterable<PendingInsert>): PendingInsert[] =>
  [...pendingInserts].map((pendingInsert) => clonePendingInsert(pendingInsert));

const cloneAnnotation = (annotation: WebAnnotationEntity, pageKey: PageKey): WebAnnotationEntity => ({
  ...annotation,
  pageKey,
  width: Math.max(Math.round(annotation.width), ANNOTATION_MIN_WIDTH_PX)
});

const cloneNote = (note: NoteEntity, page: PageDescriptor): NoteEntity => ({
  ...note,
  kind: (note.kind ?? "excerpt") as NoteKind,
  pageKey: page.key,
  pageTitle: page.title,
  pageUrl: page.url
});

const clonePage = (page: PageDescriptor): PageDescriptor => ({
  key: page.key,
  lastSeenAt: page.lastSeenAt,
  sourceUrl: page.sourceUrl,
  title: page.title,
  url: page.url
});

const cloneMeta = (meta: PageMetaEntity): PageMetaEntity => ({
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt
});

const normalizePendingInserts = (candidateValue: unknown, pageKey: PageKey): PendingInsert[] => {
  if (!Array.isArray(candidateValue)) {
    return [];
  }

  return candidateValue
    .filter(
      (candidatePendingInsert): candidatePendingInsert is PendingInsert =>
        typeof candidatePendingInsert === "object" &&
        candidatePendingInsert !== null &&
        typeof candidatePendingInsert.noteId === "string" &&
        typeof candidatePendingInsert.markdownSnippet === "string" &&
        typeof candidatePendingInsert.createdAt === "string"
    )
    .map((pendingInsert) => ({
      ...pendingInsert,
      pageKey
    }));
};

const normalizePageDescriptor = (candidatePage: Partial<PageDescriptor> | null | undefined): PageDescriptor | null => {
  if (
    typeof candidatePage?.key !== "string" ||
    typeof candidatePage.url !== "string" ||
    typeof candidatePage.title !== "string" ||
    typeof candidatePage.lastSeenAt !== "string"
  ) {
    return null;
  }

  return {
    key: candidatePage.key,
    lastSeenAt: candidatePage.lastSeenAt,
    sourceUrl: typeof candidatePage.sourceUrl === "string" ? candidatePage.sourceUrl : candidatePage.url,
    title: candidatePage.title,
    url: candidatePage.url
  };
};

const normalizePageMetaRecord = (
  candidateMetaRecord: StoredPageMetaCandidate | null | undefined
): PageStorageMetaRecord | null => {
  const page = normalizePageDescriptor(candidateMetaRecord?.page);

  if (!page) {
    return null;
  }

  const updatedAt =
    typeof candidateMetaRecord?.meta?.updatedAt === "string"
      ? candidateMetaRecord.meta.updatedAt
      : page.lastSeenAt;
  const createdAt =
    typeof candidateMetaRecord?.meta?.createdAt === "string"
      ? candidateMetaRecord.meta.createdAt
      : updatedAt;

  return {
    meta: {
      createdAt,
      updatedAt
    },
    page
  };
};

const normalizeDocument = (
  candidateDocument: Partial<PageDocumentEntity> | null | undefined,
  page: PageDescriptor,
  fallbackUpdatedAt: string
): PageDocumentEntity => ({
  markdown: typeof candidateDocument?.markdown === "string" ? candidateDocument.markdown : "",
  pageKey: page.key,
  pageTitle: page.title,
  pageUrl: page.url,
  updatedAt:
    typeof candidateDocument?.updatedAt === "string"
      ? candidateDocument.updatedAt
      : fallbackUpdatedAt
});

const normalizeNotes = (candidateNotes: unknown, page: PageDescriptor): NoteEntity[] => {
  if (!Array.isArray(candidateNotes)) {
    return [];
  }

  return candidateNotes
    .filter(
      (candidateNote): candidateNote is NoteEntity =>
        typeof candidateNote === "object" &&
        candidateNote !== null &&
        typeof candidateNote.id === "string" &&
        typeof candidateNote.quoteText === "string" &&
        typeof candidateNote.markdownSnippet === "string" &&
        typeof candidateNote.createdAt === "string" &&
        typeof candidateNote.updatedAt === "string" &&
        typeof candidateNote.pageTitle === "string" &&
        typeof candidateNote.pageUrl === "string" &&
        typeof candidateNote.pageKey === "string"
    )
    .map((note) => cloneNote(note, page));
};

const normalizeAnnotations = (
  candidateAnnotations: unknown,
  pageKey: PageKey
): WebAnnotationEntity[] => {
  if (!Array.isArray(candidateAnnotations)) {
    return [];
  }

  return candidateAnnotations
    .filter(
      (candidateAnnotation): candidateAnnotation is WebAnnotationEntity =>
        typeof candidateAnnotation === "object" &&
        candidateAnnotation !== null &&
        typeof candidateAnnotation.id === "string" &&
        typeof candidateAnnotation.content === "string" &&
        typeof candidateAnnotation.createdAt === "string" &&
        typeof candidateAnnotation.updatedAt === "string" &&
        (typeof candidateAnnotation.width === "number" || candidateAnnotation.width === undefined) &&
        typeof candidateAnnotation.x === "number" &&
        typeof candidateAnnotation.y === "number"
    )
    .map((annotation) =>
      cloneAnnotation(
        {
          ...annotation,
          width:
            typeof annotation.width === "number" ? annotation.width : ANNOTATION_DEFAULT_WIDTH_PX
        },
        pageKey
      )
    );
};

const normalizeLegacyPageRecord = (
  candidateRecord: StoredPageRecordCandidate | null | undefined
): NormalizedLegacyPageRecordResult => {
  const page = normalizePageDescriptor(candidateRecord?.page);

  if (!page) {
    return {
      legacyPendingInserts: [],
      pageRecord: null
    };
  }

  const document = normalizeDocument(candidateRecord?.document, page, new Date().toISOString());
  const notes = normalizeNotes(candidateRecord?.notes, page);
  const annotations = normalizeAnnotations(candidateRecord?.annotations, page.key);
  const updatedAt =
    typeof candidateRecord?.meta?.updatedAt === "string"
      ? candidateRecord.meta.updatedAt
      : document.updatedAt;
  const createdAt =
    typeof candidateRecord?.meta?.createdAt === "string"
      ? candidateRecord.meta.createdAt
      : updatedAt;

  return {
    legacyPendingInserts: normalizePendingInserts(candidateRecord?.pendingInserts, page.key),
    pageRecord: {
      annotations,
      document,
      meta: {
        createdAt,
        updatedAt
      },
      notes,
      page
    }
  };
};

const createPageMetaRecord = (
  page: PageDescriptor,
  meta?: Partial<PageMetaEntity>
): PageStorageMetaRecord => {
  const updatedAt = typeof meta?.updatedAt === "string" ? meta.updatedAt : new Date().toISOString();
  const createdAt = typeof meta?.createdAt === "string" ? meta.createdAt : updatedAt;

  return {
    meta: {
      createdAt,
      updatedAt
    },
    page: clonePage(page)
  };
};

const touchPageMetaRecord = (
  pageMetaRecord: PageStorageMetaRecord,
  pageOverride?: PageDescriptor
): PageStorageMetaRecord => ({
  meta: {
    createdAt: pageMetaRecord.meta.createdAt,
    updatedAt: new Date().toISOString()
  },
  page: clonePage(pageOverride ?? pageMetaRecord.page)
});

const synchronizePageDocument = (
  pageDocument: PageDocumentEntity,
  page: PageDescriptor,
  markdownOverride?: string
): PageDocumentEntity => ({
  markdown: markdownOverride ?? pageDocument.markdown,
  pageKey: page.key,
  pageTitle: page.title,
  pageUrl: page.url,
  updatedAt:
    markdownOverride === undefined ? pageDocument.updatedAt : new Date().toISOString()
});

const didPageDescriptorChange = (currentPage: PageDescriptor, nextPage: PageDescriptor): boolean =>
  currentPage.key !== nextPage.key ||
  currentPage.url !== nextPage.url ||
  currentPage.sourceUrl !== nextPage.sourceUrl ||
  currentPage.title !== nextPage.title;

const migrateLegacyDocument = (pageRecord: PageRecord, page: PageDescriptor): PageRecord => {
  const seededMarkdownVariants = new Set([
    getLegacySeededMarkdown(page),
    getLegacySeededMarkdown({
      ...page,
      url: page.sourceUrl
    })
  ]);

  if (!seededMarkdownVariants.has(pageRecord.document.markdown)) {
    return pageRecord;
  }

  return {
    ...pageRecord,
    document: {
      ...pageRecord.document,
      markdown: "",
      updatedAt: new Date().toISOString()
    },
    meta: {
      ...pageRecord.meta,
      updatedAt: new Date().toISOString()
    }
  };
};

const createEmptyPageRecord = (page: PageDescriptor): PageRecord => {
  const timestamp = new Date().toISOString();

  return {
    annotations: [],
    document: createPageDocument(page),
    meta: {
      createdAt: timestamp,
      updatedAt: timestamp
    },
    notes: [],
    page
  };
};

const savePageSlices = async (input: {
  annotations?: WebAnnotationEntity[];
  document?: PageDocumentEntity;
  notes?: NoteEntity[];
  pageKey: PageKey;
  pageMetaRecord?: PageStorageMetaRecord;
}): Promise<void> => {
  const nextStorageValues: Record<string, unknown> = {};

  if (input.pageMetaRecord) {
    nextStorageValues[getPageMetaStorageKey(input.pageKey)] = {
      meta: cloneMeta(input.pageMetaRecord.meta),
      page: clonePage(input.pageMetaRecord.page)
    } satisfies PageStorageMetaRecord;
  }

  if (input.document) {
    nextStorageValues[getDocumentStorageKey(input.pageKey)] = {
      ...input.document
    } satisfies PageDocumentEntity;
  }

  if (input.notes) {
    nextStorageValues[getNoteStorageKey(input.pageKey)] = input.notes.map((note) =>
      cloneNote(note, input.pageMetaRecord?.page ?? {
        key: note.pageKey,
        lastSeenAt: note.updatedAt,
        sourceUrl: note.pageUrl,
        title: note.pageTitle,
        url: note.pageUrl
      })
    );
  }

  if (input.annotations) {
    nextStorageValues[getAnnotationStorageKey(input.pageKey)] = input.annotations.map((annotation) =>
      cloneAnnotation(annotation, input.pageKey)
    );
  }

  if (Object.keys(nextStorageValues).length === 0) {
    return;
  }

  await chrome.storage.local.set(nextStorageValues);
};

const removeLegacyPageRecord = async (pageKey: PageKey): Promise<void> => {
  await chrome.storage.local.remove(getLegacyPageStorageKey(pageKey));
};

const removeAllPageSlices = async (pageKey: PageKey): Promise<void> => {
  await chrome.storage.local.remove([
    getAnnotationStorageKey(pageKey),
    getDocumentStorageKey(pageKey),
    getLegacyPageStorageKey(pageKey),
    getNoteStorageKey(pageKey),
    getPageMetaStorageKey(pageKey)
  ]);
};

const materializePageRecord = async (pageRecord: PageRecord): Promise<PageRecord> => {
  await savePageSlices({
    annotations: pageRecord.annotations,
    document: pageRecord.document,
    notes: pageRecord.notes,
    pageKey: pageRecord.page.key,
    pageMetaRecord: {
      meta: pageRecord.meta,
      page: pageRecord.page
    }
  });

  return pageRecord;
};

const seedRuntimePendingInserts = (pageKey: PageKey, pendingInserts: PendingInsert[]): void => {
  if (pendingInserts.length === 0 || runtimePendingInsertQueues.has(pageKey)) {
    return;
  }

  runtimePendingInsertQueues.set(pageKey, clonePendingInserts(pendingInserts));
};

const removeRuntimePendingInsertIds = (pageKey: PageKey, noteIds: string[]): PendingInsert[] => {
  const existingPendingInserts = runtimePendingInsertQueues.get(pageKey) ?? [];

  if (existingPendingInserts.length === 0) {
    return [];
  }

  const flushedPendingInsertIds = new Set(noteIds);
  const remainingPendingInserts = existingPendingInserts.filter(
    (pendingInsert) => !flushedPendingInsertIds.has(pendingInsert.noteId)
  );

  if (remainingPendingInserts.length === 0) {
    runtimePendingInsertQueues.delete(pageKey);
  } else {
    runtimePendingInsertQueues.set(pageKey, remainingPendingInserts);
  }

  return clonePendingInserts(remainingPendingInserts);
};

const enqueueRuntimePendingInsert = (note: NoteEntity): void => {
  const existingPendingInserts = runtimePendingInsertQueues.get(note.pageKey) ?? [];

  if (existingPendingInserts.some((pendingInsert) => pendingInsert.noteId === note.id)) {
    return;
  }

  runtimePendingInsertQueues.set(note.pageKey, [
    ...existingPendingInserts,
    clonePendingInsert({
      createdAt: note.createdAt,
      markdownSnippet: note.markdownSnippet,
      noteId: note.id,
      pageKey: note.pageKey
    })
  ]);
};

const readPageRecord = async (pageKey: PageKey): Promise<PageRecord | null> => {
  const storageKeys = buildPageStorageKeys(pageKey);
  const storageResult = await chrome.storage.local.get([
    storageKeys.annotationKey,
    storageKeys.documentKey,
    storageKeys.legacyPageKey,
    storageKeys.metaKey,
    storageKeys.notesKey
  ]);
  const storedPageMetaRecord = normalizePageMetaRecord(
    storageResult[storageKeys.metaKey] as StoredPageMetaCandidate | undefined
  );
  const legacyPageRecordResult = normalizeLegacyPageRecord(
    storageResult[storageKeys.legacyPageKey] as StoredPageRecordCandidate | undefined
  );

  if (!storedPageMetaRecord && !legacyPageRecordResult.pageRecord) {
    return null;
  }

  const page = clonePage(storedPageMetaRecord?.page ?? legacyPageRecordResult.pageRecord!.page);
  const meta = cloneMeta(storedPageMetaRecord?.meta ?? legacyPageRecordResult.pageRecord!.meta);
  const document =
    storageResult[storageKeys.documentKey] === undefined
      ? normalizeDocument(legacyPageRecordResult.pageRecord?.document, page, meta.updatedAt)
      : normalizeDocument(
          storageResult[storageKeys.documentKey] as Partial<PageDocumentEntity> | undefined,
          page,
          meta.updatedAt
        );
  const notes =
    storageResult[storageKeys.notesKey] === undefined
      ? legacyPageRecordResult.pageRecord?.notes.map((note) => cloneNote(note, page)) ?? []
      : normalizeNotes(storageResult[storageKeys.notesKey], page);
  const annotations =
    storageResult[storageKeys.annotationKey] === undefined
      ? legacyPageRecordResult.pageRecord?.annotations.map((annotation) => cloneAnnotation(annotation, page.key)) ?? []
      : normalizeAnnotations(storageResult[storageKeys.annotationKey], page.key);

  seedRuntimePendingInserts(pageKey, legacyPageRecordResult.legacyPendingInserts);

  const nextPageRecord: PageRecord = {
    annotations,
    document,
    meta,
    notes,
    page
  };
  const shouldPersistMigration =
    storageResult[storageKeys.metaKey] === undefined ||
    storageResult[storageKeys.documentKey] === undefined ||
    storageResult[storageKeys.notesKey] === undefined ||
    storageResult[storageKeys.annotationKey] === undefined ||
    legacyPageRecordResult.pageRecord !== null;

  if (!shouldPersistMigration) {
    return nextPageRecord;
  }

  await materializePageRecord(nextPageRecord);

  if (legacyPageRecordResult.pageRecord) {
    await removeLegacyPageRecord(pageKey);
  }

  return nextPageRecord;
};

const readPageMetaRecord = async (pageKey: PageKey): Promise<PageStorageMetaRecord | null> => {
  const storageKey = getPageMetaStorageKey(pageKey);
  const storageResult = await chrome.storage.local.get(storageKey);
  const pageMetaRecord = normalizePageMetaRecord(storageResult[storageKey] as StoredPageMetaCandidate | undefined);

  if (pageMetaRecord) {
    return pageMetaRecord;
  }

  const pageRecord = await readPageRecord(pageKey);

  if (!pageRecord) {
    return null;
  }

  return {
    meta: cloneMeta(pageRecord.meta),
    page: clonePage(pageRecord.page)
  };
};

const readPageDocument = async (pageKey: PageKey): Promise<PageDocumentEntity | null> => {
  const pageMetaRecord = await readPageMetaRecord(pageKey);

  if (!pageMetaRecord) {
    return null;
  }

  const storageKey = getDocumentStorageKey(pageKey);
  const storageResult = await chrome.storage.local.get(storageKey);

  if (storageResult[storageKey] !== undefined) {
    return normalizeDocument(
      storageResult[storageKey] as Partial<PageDocumentEntity> | undefined,
      pageMetaRecord.page,
      pageMetaRecord.meta.updatedAt
    );
  }

  const pageRecord = await readPageRecord(pageKey);
  return pageRecord?.document ?? createPageDocument(pageMetaRecord.page);
};

const readPageNotes = async (pageKey: PageKey): Promise<{
  notes: NoteEntity[];
  pageMetaRecord: PageStorageMetaRecord;
} | null> => {
  const pageMetaRecord = await readPageMetaRecord(pageKey);

  if (!pageMetaRecord) {
    return null;
  }

  const storageKey = getNoteStorageKey(pageKey);
  const storageResult = await chrome.storage.local.get(storageKey);

  if (storageResult[storageKey] !== undefined) {
    return {
      notes: normalizeNotes(storageResult[storageKey], pageMetaRecord.page),
      pageMetaRecord
    };
  }

  const pageRecord = await readPageRecord(pageKey);

  return {
    notes: pageRecord?.notes ?? [],
    pageMetaRecord
  };
};

const readPageAnnotations = async (pageKey: PageKey): Promise<{
  annotations: WebAnnotationEntity[];
  pageMetaRecord: PageStorageMetaRecord;
} | null> => {
  const pageMetaRecord = await readPageMetaRecord(pageKey);

  if (!pageMetaRecord) {
    return null;
  }

  const storageKey = getAnnotationStorageKey(pageKey);
  const storageResult = await chrome.storage.local.get(storageKey);

  if (storageResult[storageKey] !== undefined) {
    return {
      annotations: normalizeAnnotations(storageResult[storageKey], pageKey),
      pageMetaRecord
    };
  }

  const pageRecord = await readPageRecord(pageKey);

  return {
    annotations: pageRecord?.annotations ?? [],
    pageMetaRecord
  };
};

const getOrCreatePageRecordUnsafe = async (page: PageDescriptor): Promise<PageRecord> => {
  const existingRecord = await readPageRecord(page.key);

  if (existingRecord) {
    const shouldUpdatePage = didPageDescriptorChange(existingRecord.page, page);
    const migratedRecord = migrateLegacyDocument(existingRecord, page);
    const nextPage = shouldUpdatePage
      ? {
          ...page,
          lastSeenAt: existingRecord.page.lastSeenAt
        }
      : migratedRecord.page;
    const nextRecord: PageRecord = {
      ...migratedRecord,
      document: synchronizePageDocument(migratedRecord.document, nextPage),
      meta:
        shouldUpdatePage || migratedRecord.document.updatedAt !== existingRecord.document.updatedAt
          ? touchPageMetaRecord({
              meta: migratedRecord.meta,
              page: existingRecord.page
            }, nextPage).meta
          : migratedRecord.meta,
      page: nextPage
    };

    if (
      !shouldUpdatePage &&
      nextRecord.document.updatedAt === existingRecord.document.updatedAt &&
      nextRecord.meta.updatedAt === existingRecord.meta.updatedAt
    ) {
      return nextRecord;
    }

    await savePageSlices({
      document: nextRecord.document,
      pageKey: nextRecord.page.key,
      pageMetaRecord: {
        meta: nextRecord.meta,
        page: nextRecord.page
      }
    });
    return nextRecord;
  }

  const legacyPageKey = buildLegacyPageKey(page.sourceUrl);

  if (legacyPageKey !== page.key) {
    const migratedLegacyRecord = await readPageRecord(legacyPageKey);

    if (migratedLegacyRecord) {
      const nextPageRecord: PageRecord = {
        ...migratedLegacyRecord,
        document: synchronizePageDocument(migratedLegacyRecord.document, page),
        meta: touchPageMetaRecord({
          meta: migratedLegacyRecord.meta,
          page: migratedLegacyRecord.page
        }, page).meta,
        page
      };

      seedRuntimePendingInserts(page.key, getPendingInserts(legacyPageKey));
      runtimePendingInsertQueues.delete(legacyPageKey);
      await materializePageRecord(nextPageRecord);
      await removeAllPageSlices(legacyPageKey);
      return nextPageRecord;
    }
  }

  const emptyPageRecord = createEmptyPageRecord(page);
  await materializePageRecord(emptyPageRecord);
  return emptyPageRecord;
};

export const getPendingInserts = (pageKey: PageKey): PendingInsert[] =>
  clonePendingInserts(runtimePendingInsertQueues.get(pageKey) ?? []);

export const getPageRecord = async (pageKey: PageKey): Promise<PageRecord | null> => {
  const pendingMutation = pageMutationQueues.get(pageKey);

  if (pendingMutation) {
    await pendingMutation.catch(() => undefined);
  }

  return readPageRecord(pageKey);
};

export const getOrCreatePageRecord = async (page: PageDescriptor): Promise<PageRecord> =>
  withPageMutationLock(page.key, () => getOrCreatePageRecordUnsafe(page));

export const upsertNote = async (
  note: NoteEntity,
  options: UpsertNoteOptions = {}
): Promise<PageRecord> => {
  const shouldEnqueueInsert = options.enqueueInsert ?? true;
  const page = {
    key: note.pageKey,
    lastSeenAt: note.updatedAt,
    sourceUrl: note.pageUrl,
    title: note.pageTitle,
    url: note.pageUrl
  } satisfies PageDescriptor;

  return withPageMutationLock(page.key, async () => {
    const pageRecord = await getOrCreatePageRecordUnsafe(page);
    const existingNotesState = await readPageNotes(page.key);
    const nextNotes = [...(existingNotesState?.notes ?? pageRecord.notes)];
    const existingIndex = nextNotes.findIndex((item) => item.id === note.id);
    const clonedNote = cloneNote(note, pageRecord.page);

    if (existingIndex >= 0) {
      nextNotes[existingIndex] = clonedNote;
    } else {
      nextNotes.push(clonedNote);
    }

    if (shouldEnqueueInsert) {
      enqueueRuntimePendingInsert(clonedNote);
    }

    const nextPageMetaRecord = touchPageMetaRecord({
      meta: pageRecord.meta,
      page: pageRecord.page
    }, pageRecord.page);

    await savePageSlices({
      notes: nextNotes,
      pageKey: page.key,
      pageMetaRecord: nextPageMetaRecord
    });

    return {
      ...pageRecord,
      meta: nextPageMetaRecord.meta,
      notes: nextNotes
    };
  });
};

export const saveDocument = async (pageKey: PageKey, markdown: string): Promise<PageRecord | null> =>
  withPageMutationLock(pageKey, async () => {
    const pageMetaRecord = await readPageMetaRecord(pageKey);
    const pageDocument = await readPageDocument(pageKey);

    if (!pageMetaRecord || !pageDocument) {
      return null;
    }

    const nextPageMetaRecord = touchPageMetaRecord(pageMetaRecord, pageMetaRecord.page);
    const nextDocument = synchronizePageDocument(pageDocument, pageMetaRecord.page, markdown);

    await savePageSlices({
      document: nextDocument,
      pageKey,
      pageMetaRecord: nextPageMetaRecord
    });

    const pageRecord = await readPageRecord(pageKey);

    return pageRecord
      ? {
          ...pageRecord,
          document: nextDocument,
          meta: nextPageMetaRecord.meta
        }
      : null;
  });

export const flushPendingInserts = async (pageKey: PageKey, noteIds: string[]): Promise<PendingInsert[]> =>
  withPageMutationLock(pageKey, async () => removeRuntimePendingInsertIds(pageKey, noteIds));

export const upsertAnnotation = async (
  annotation: WebAnnotationEntity
): Promise<PageRecord | null> =>
  withPageMutationLock(annotation.pageKey, async () => {
    const existingAnnotationsState = await readPageAnnotations(annotation.pageKey);

    if (!existingAnnotationsState) {
      return null;
    }

    const nextAnnotations = [...existingAnnotationsState.annotations];
    const existingIndex = nextAnnotations.findIndex((item) => item.id === annotation.id);
    const clonedAnnotation = cloneAnnotation(annotation, annotation.pageKey);

    if (existingIndex >= 0) {
      nextAnnotations[existingIndex] = clonedAnnotation;
    } else {
      nextAnnotations.push(clonedAnnotation);
    }

    const nextPageMetaRecord = touchPageMetaRecord(existingAnnotationsState.pageMetaRecord);

    await savePageSlices({
      annotations: nextAnnotations,
      pageKey: annotation.pageKey,
      pageMetaRecord: nextPageMetaRecord
    });

    const pageRecord = await readPageRecord(annotation.pageKey);

    return pageRecord
      ? {
          ...pageRecord,
          annotations: nextAnnotations,
          meta: nextPageMetaRecord.meta
        }
      : null;
  });

export const replaceAnnotations = async (
  pageKey: PageKey,
  annotations: WebAnnotationEntity[]
): Promise<PageRecord | null> =>
  withPageMutationLock(pageKey, async () => {
    const existingAnnotationsState = await readPageAnnotations(pageKey);

    if (!existingAnnotationsState) {
      return null;
    }

    const nextAnnotations = normalizeAnnotations(annotations, pageKey);
    const nextPageMetaRecord = touchPageMetaRecord(existingAnnotationsState.pageMetaRecord);

    await savePageSlices({
      annotations: nextAnnotations,
      pageKey,
      pageMetaRecord: nextPageMetaRecord
    });

    const pageRecord = await readPageRecord(pageKey);

    return pageRecord
      ? {
          ...pageRecord,
          annotations: nextAnnotations,
          meta: nextPageMetaRecord.meta
        }
      : null;
  });

export const deleteAnnotation = async (
  pageKey: PageKey,
  annotationId: string
): Promise<PageRecord | null> =>
  withPageMutationLock(pageKey, async () => {
    const existingAnnotationsState = await readPageAnnotations(pageKey);

    if (!existingAnnotationsState) {
      return null;
    }

    const nextAnnotations = existingAnnotationsState.annotations.filter(
      (annotation) => annotation.id !== annotationId
    );
    const nextPageMetaRecord = touchPageMetaRecord(existingAnnotationsState.pageMetaRecord);

    await savePageSlices({
      annotations: nextAnnotations,
      pageKey,
      pageMetaRecord: nextPageMetaRecord
    });

    const pageRecord = await readPageRecord(pageKey);

    return pageRecord
      ? {
          ...pageRecord,
          annotations: nextAnnotations,
          meta: nextPageMetaRecord.meta
        }
      : null;
  });

export const deleteNote = async (pageKey: PageKey, noteId: string): Promise<PageRecord | null> =>
  withPageMutationLock(pageKey, async () => {
    const existingNotesState = await readPageNotes(pageKey);

    if (!existingNotesState) {
      return null;
    }

    removeRuntimePendingInsertIds(pageKey, [noteId]);
    const nextNotes = existingNotesState.notes.filter((note) => note.id !== noteId);
    const nextPageMetaRecord = touchPageMetaRecord(existingNotesState.pageMetaRecord);

    await savePageSlices({
      notes: nextNotes,
      pageKey,
      pageMetaRecord: nextPageMetaRecord
    });

    const pageRecord = await readPageRecord(pageKey);

    return pageRecord
      ? {
          ...pageRecord,
          meta: nextPageMetaRecord.meta,
          notes: nextNotes
        }
      : null;
  });

const withPageMutationLock = async <T>(pageKey: PageKey, task: () => Promise<T>): Promise<T> => {
  const previousMutation = pageMutationQueues.get(pageKey) ?? Promise.resolve();
  let releaseCurrentMutation = (): void => undefined;
  const currentMutation = new Promise<void>((resolve) => {
    releaseCurrentMutation = () => {
      resolve();
    };
  });
  const queuedMutation = previousMutation.catch(() => undefined).then(() => currentMutation);
  pageMutationQueues.set(pageKey, queuedMutation);

  await previousMutation.catch(() => undefined);

  try {
    return await task();
  } finally {
    releaseCurrentMutation();

    if (pageMutationQueues.get(pageKey) === queuedMutation) {
      pageMutationQueues.delete(pageKey);
    }
  }
};
