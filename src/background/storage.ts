import { PAGE_STORAGE_PREFIX } from "../shared/constants";
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

const LEGACY_ANNOTATION_STORAGE_PREFIX = "webnote:annotations:";

interface UpsertNoteOptions {
  enqueueInsert?: boolean;
}

interface NormalizedPageRecordResult {
  legacyPendingInserts: PendingInsert[];
  pageRecord: PageRecord | null;
}

type StoredPageRecordCandidate = Partial<PageRecord> & {
  pendingInserts?: unknown;
};

const pageMutationQueues = new Map<PageKey, Promise<void>>();
const runtimePendingInsertQueues = new Map<PageKey, PendingInsert[]>();

const getStorageKey = (pageKey: PageKey): string => `${PAGE_STORAGE_PREFIX}${pageKey}`;
const getLegacyAnnotationStorageKey = (pageKey: PageKey): string =>
  `${LEGACY_ANNOTATION_STORAGE_PREFIX}${pageKey}`;

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
  pageKey
});

const cloneNote = (note: NoteEntity, page: PageDescriptor): NoteEntity => ({
  ...note,
  kind: (note.kind ?? "excerpt") as NoteKind,
  pageKey: page.key,
  pageTitle: page.title,
  pageUrl: page.url
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

const normalizeAnnotations = (
  annotations: WebAnnotationEntity[] | null | undefined,
  pageKey: PageKey
): WebAnnotationEntity[] => {
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations
    .filter(
      (annotation): annotation is WebAnnotationEntity =>
        typeof annotation === "object" &&
        annotation !== null &&
        typeof annotation.id === "string" &&
        typeof annotation.content === "string" &&
        typeof annotation.createdAt === "string" &&
        typeof annotation.updatedAt === "string" &&
        typeof annotation.x === "number" &&
        typeof annotation.y === "number"
    )
    .map((annotation) => cloneAnnotation(annotation, pageKey));
};

const normalizePageRecord = (
  candidateRecord: StoredPageRecordCandidate | null | undefined
): NormalizedPageRecordResult => {
  if (!candidateRecord?.page || !candidateRecord.document) {
    return {
      legacyPendingInserts: [],
      pageRecord: null
    };
  }

  const page = {
    key: candidateRecord.page.key,
    lastSeenAt: candidateRecord.page.lastSeenAt,
    sourceUrl: candidateRecord.page.sourceUrl ?? candidateRecord.page.url,
    title: candidateRecord.page.title,
    url: candidateRecord.page.url
  } satisfies PageDescriptor;

  if (
    typeof page.key !== "string" ||
    typeof page.url !== "string" ||
    typeof page.sourceUrl !== "string" ||
    typeof page.title !== "string" ||
    typeof page.lastSeenAt !== "string"
  ) {
    return {
      legacyPendingInserts: [],
      pageRecord: null
    };
  }

  const document = {
    markdown: typeof candidateRecord.document.markdown === "string" ? candidateRecord.document.markdown : "",
    pageKey: page.key,
    pageTitle: page.title,
    pageUrl: page.url,
    updatedAt:
      typeof candidateRecord.document.updatedAt === "string"
        ? candidateRecord.document.updatedAt
        : new Date().toISOString()
  } satisfies PageDocumentEntity;

  const notes = Array.isArray(candidateRecord.notes)
    ? candidateRecord.notes
        .filter(
          (note): note is NoteEntity =>
            typeof note === "object" &&
            note !== null &&
            typeof note.id === "string" &&
            typeof note.quoteText === "string" &&
            typeof note.markdownSnippet === "string" &&
            typeof note.createdAt === "string" &&
            typeof note.updatedAt === "string" &&
            typeof note.pageTitle === "string" &&
            typeof note.pageUrl === "string" &&
            typeof note.pageKey === "string"
        )
        .map((note) => cloneNote(note, page))
    : [];

  const annotations = normalizeAnnotations(candidateRecord.annotations, page.key);
  const metaUpdatedAt =
    typeof candidateRecord.meta?.updatedAt === "string"
      ? candidateRecord.meta.updatedAt
      : document.updatedAt;
  const metaCreatedAt =
    typeof candidateRecord.meta?.createdAt === "string"
      ? candidateRecord.meta.createdAt
      : metaUpdatedAt;

  return {
    legacyPendingInserts: normalizePendingInserts(candidateRecord.pendingInserts, page.key),
    pageRecord: {
      annotations,
      document,
      meta: {
        createdAt: metaCreatedAt,
        updatedAt: metaUpdatedAt
      } satisfies PageMetaEntity,
      notes,
      page
    }
  };
};

const touchPageRecord = (pageRecord: PageRecord): PageRecord => {
  const nextTimestamp = new Date().toISOString();

  return {
    ...pageRecord,
    meta: {
      createdAt: pageRecord.meta.createdAt,
      updatedAt: nextTimestamp
    }
  };
};

const mergeAnnotationsById = (
  pageKey: PageKey,
  primaryAnnotations: WebAnnotationEntity[],
  secondaryAnnotations: WebAnnotationEntity[]
): WebAnnotationEntity[] => {
  const mergedAnnotationsById = new Map<string, WebAnnotationEntity>();

  for (const annotation of [...primaryAnnotations, ...secondaryAnnotations]) {
    mergedAnnotationsById.set(annotation.id, cloneAnnotation(annotation, pageKey));
  }

  return [...mergedAnnotationsById.values()];
};

const savePageRecord = async (pageRecord: PageRecord): Promise<PageRecord> => {
  await chrome.storage.local.set({
    [getStorageKey(pageRecord.page.key)]: pageRecord
  });

  return pageRecord;
};

const readStoredPageRecord = async (pageKey: PageKey): Promise<NormalizedPageRecordResult> => {
  const storageKey = getStorageKey(pageKey);
  const result = await chrome.storage.local.get(storageKey);
  return normalizePageRecord(result[storageKey] as StoredPageRecordCandidate | undefined);
};

const readLegacyAnnotations = async (
  pageKey: PageKey
): Promise<{ annotations: WebAnnotationEntity[]; hasLegacyKey: boolean }> => {
  const storageKey = getLegacyAnnotationStorageKey(pageKey);
  const result = await chrome.storage.local.get(storageKey);

  return {
    annotations: normalizeAnnotations(result[storageKey] as WebAnnotationEntity[] | undefined, pageKey),
    hasLegacyKey: result[storageKey] !== undefined
  };
};

const seedRuntimePendingInserts = (pageKey: PageKey, pendingInserts: PendingInsert[]): void => {
  if (pendingInserts.length === 0 || runtimePendingInsertQueues.has(pageKey)) {
    return;
  }

  runtimePendingInsertQueues.set(pageKey, clonePendingInserts(pendingInserts));
};

const updatePageMetadata = (
  pageRecord: PageRecord,
  page: PageDescriptor,
  documentOverride?: Partial<PageDocumentEntity>
): PageRecord => ({
  ...pageRecord,
  document: {
    ...pageRecord.document,
    pageKey: page.key,
    pageTitle: page.title,
    pageUrl: page.url,
    ...documentOverride
  },
  notes: pageRecord.notes.map((note) => cloneNote(note, page)),
  annotations: pageRecord.annotations.map((annotation) => cloneAnnotation(annotation, page.key)),
  page
});

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

  return touchPageRecord({
    ...pageRecord,
    document: {
      ...pageRecord.document,
      markdown: "",
      updatedAt: new Date().toISOString()
    }
  });
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

const migrateLegacyPageRecord = async (page: PageDescriptor): Promise<NormalizedPageRecordResult> => {
  const legacyPageKey = buildLegacyPageKey(page.sourceUrl);

  if (legacyPageKey === page.key) {
    return {
      legacyPendingInserts: [],
      pageRecord: null
    };
  }

  const legacyStorageKey = getStorageKey(legacyPageKey);
  const result = await chrome.storage.local.get(legacyStorageKey);
  const normalizedLegacyRecord = normalizePageRecord(result[legacyStorageKey] as StoredPageRecordCandidate | undefined);

  if (!normalizedLegacyRecord.pageRecord) {
    return normalizedLegacyRecord;
  }

  await chrome.storage.local.remove(legacyStorageKey);

  return {
    ...normalizedLegacyRecord,
    pageRecord: updatePageMetadata(normalizedLegacyRecord.pageRecord, page)
  };
};

const readPageRecord = async (pageKey: PageKey): Promise<PageRecord | null> => {
  const normalizedStoredRecord = await readStoredPageRecord(pageKey);
  const pageRecord = normalizedStoredRecord.pageRecord;

  if (!pageRecord) {
    return null;
  }

  seedRuntimePendingInserts(pageKey, normalizedStoredRecord.legacyPendingInserts);

  const legacyAnnotations = await readLegacyAnnotations(pageKey);
  const shouldPersistCleanup =
    normalizedStoredRecord.legacyPendingInserts.length > 0 || legacyAnnotations.hasLegacyKey;

  const nextPageRecord = legacyAnnotations.hasLegacyKey
    ? touchPageRecord({
        ...pageRecord,
        annotations: mergeAnnotationsById(pageKey, pageRecord.annotations, legacyAnnotations.annotations)
      })
    : pageRecord;

  if (!shouldPersistCleanup) {
    return nextPageRecord;
  }

  if (legacyAnnotations.hasLegacyKey) {
    await chrome.storage.local.remove(getLegacyAnnotationStorageKey(pageKey));
  }

  return savePageRecord(nextPageRecord);
};

const getOrCreatePageRecordUnsafe = async (page: PageDescriptor): Promise<PageRecord> => {
  const existingRecord = await readPageRecord(page.key);

  if (existingRecord) {
    return savePageRecord(updatePageMetadata(migrateLegacyDocument(existingRecord, page), page));
  }

  const migratedLegacyRecord = await migrateLegacyPageRecord(page);

  if (migratedLegacyRecord.pageRecord) {
    seedRuntimePendingInserts(page.key, migratedLegacyRecord.legacyPendingInserts);
    return savePageRecord(updatePageMetadata(migrateLegacyDocument(migratedLegacyRecord.pageRecord, page), page));
  }

  return savePageRecord(createEmptyPageRecord(page));
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
    const nextNotes = [...pageRecord.notes];
    const existingIndex = nextNotes.findIndex((item) => item.id === note.id);

    if (existingIndex >= 0) {
      nextNotes[existingIndex] = cloneNote(note, page);
    } else {
      nextNotes.push(cloneNote(note, page));
    }

    if (shouldEnqueueInsert) {
      enqueueRuntimePendingInsert(note);
    }

    return savePageRecord(
      touchPageRecord({
        ...pageRecord,
        notes: nextNotes,
        page
      })
    );
  });
};

export const saveDocument = async (pageKey: PageKey, markdown: string): Promise<PageRecord | null> =>
  withPageMutationLock(pageKey, async () => {
    const pageRecord = await readPageRecord(pageKey);

    if (!pageRecord) {
      return null;
    }

    return savePageRecord(
      touchPageRecord({
        ...pageRecord,
        document: {
          ...pageRecord.document,
          markdown,
          updatedAt: new Date().toISOString()
        }
      })
    );
  });

export const flushPendingInserts = async (pageKey: PageKey, noteIds: string[]): Promise<PendingInsert[]> =>
  withPageMutationLock(pageKey, async () => removeRuntimePendingInsertIds(pageKey, noteIds));

export const upsertAnnotation = async (
  annotation: WebAnnotationEntity
): Promise<PageRecord | null> =>
  withPageMutationLock(annotation.pageKey, async () => {
    const pageRecord = await readPageRecord(annotation.pageKey);

    if (!pageRecord) {
      return null;
    }

    const nextAnnotations = [...pageRecord.annotations];
    const existingIndex = nextAnnotations.findIndex((item) => item.id === annotation.id);

    if (existingIndex >= 0) {
      nextAnnotations[existingIndex] = cloneAnnotation(annotation, annotation.pageKey);
    } else {
      nextAnnotations.push(cloneAnnotation(annotation, annotation.pageKey));
    }

    return savePageRecord(
      touchPageRecord({
        ...pageRecord,
        annotations: nextAnnotations
      })
    );
  });

export const replaceAnnotations = async (
  pageKey: PageKey,
  annotations: WebAnnotationEntity[]
): Promise<PageRecord | null> =>
  withPageMutationLock(pageKey, async () => {
    const pageRecord = await readPageRecord(pageKey);

    if (!pageRecord) {
      return null;
    }

    return savePageRecord(
      touchPageRecord({
        ...pageRecord,
        annotations: normalizeAnnotations(annotations, pageKey)
      })
    );
  });

export const deleteAnnotation = async (
  pageKey: PageKey,
  annotationId: string
): Promise<PageRecord | null> =>
  withPageMutationLock(pageKey, async () => {
    const pageRecord = await readPageRecord(pageKey);

    if (!pageRecord) {
      return null;
    }

    return savePageRecord(
      touchPageRecord({
        ...pageRecord,
        annotations: pageRecord.annotations.filter((annotation) => annotation.id !== annotationId)
      })
    );
  });

export const deleteNote = async (pageKey: PageKey, noteId: string): Promise<PageRecord | null> =>
  withPageMutationLock(pageKey, async () => {
    const pageRecord = await readPageRecord(pageKey);

    if (!pageRecord) {
      return null;
    }

    removeRuntimePendingInsertIds(pageKey, [noteId]);

    return savePageRecord(
      touchPageRecord({
        ...pageRecord,
        notes: pageRecord.notes.filter((note) => note.id !== noteId)
      })
    );
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
