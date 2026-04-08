import { PAGE_STORAGE_PREFIX } from "../shared/constants";
import { createPageDocument, getLegacySeededMarkdown } from "../shared/serialization";
import type {
  NoteEntity,
  NoteKind,
  PageDescriptor,
  PageDocumentEntity,
  PageKey,
  PageRecord,
  PendingInsert,
  WebAnnotationEntity
} from "../shared/types";

const getStorageKey = (pageKey: PageKey): string => `${PAGE_STORAGE_PREFIX}${pageKey}`;

interface UpsertNoteOptions {
  enqueueInsert?: boolean;
}

const pageMutationQueues = new Map<PageKey, Promise<void>>();

const clonePendingInsert = (note: NoteEntity): PendingInsert => ({
  noteId: note.id,
  pageKey: note.pageKey,
  markdownSnippet: note.markdownSnippet,
  createdAt: note.createdAt
});

const waitForPendingPageMutations = async (pageKey: PageKey): Promise<void> => {
  const pendingMutation = pageMutationQueues.get(pageKey);

  if (!pendingMutation) {
    return;
  }

  await pendingMutation.catch(() => undefined);
};

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

const normalizePageRecord = (pageRecord: PageRecord): PageRecord => ({
  ...pageRecord,
  annotations: pageRecord.annotations ?? [],
  notes: (pageRecord.notes ?? []).map((note) => ({
    ...note,
    kind: (note.kind ?? "excerpt") as NoteKind
  })),
  pendingInserts: pageRecord.pendingInserts ?? []
});

const savePageRecord = async (pageRecord: PageRecord): Promise<PageRecord> => {
  await chrome.storage.local.set({
    [getStorageKey(pageRecord.page.key)]: pageRecord
  });

  return pageRecord;
};

const updatePageMetadata = (
  pageRecord: PageRecord,
  page: PageDescriptor,
  documentOverride?: Partial<PageDocumentEntity>
): PageRecord => ({
  ...pageRecord,
  page,
  document: {
    ...pageRecord.document,
    pageKey: page.key,
    pageTitle: page.title,
    pageUrl: page.url,
    ...documentOverride
  }
});

const migrateLegacyDocument = (pageRecord: PageRecord, page: PageDescriptor): PageRecord => {
  if (pageRecord.document.markdown !== getLegacySeededMarkdown(page)) {
    return pageRecord;
  }

  return {
    ...pageRecord,
    document: {
      ...pageRecord.document,
      markdown: "",
      updatedAt: new Date().toISOString()
    }
  };
};

const readPageRecord = async (pageKey: PageKey): Promise<PageRecord | null> => {
  const storageKey = getStorageKey(pageKey);
  const result = await chrome.storage.local.get(storageKey);
  const pageRecord = result[storageKey] as PageRecord | undefined;
  return pageRecord ? normalizePageRecord(pageRecord) : null;
};

const getOrCreatePageRecordUnsafe = async (page: PageDescriptor): Promise<PageRecord> => {
  const existingRecord = await readPageRecord(page.key);

  if (existingRecord) {
    return savePageRecord(updatePageMetadata(migrateLegacyDocument(existingRecord, page), page));
  }

  return savePageRecord({
    page,
    annotations: [],
    document: createPageDocument(page),
    notes: [],
    pendingInserts: []
  });
};

export const getPageRecord = async (pageKey: PageKey): Promise<PageRecord | null> => {
  await waitForPendingPageMutations(pageKey);
  return readPageRecord(pageKey);
};

export const getOrCreatePageRecord = async (page: PageDescriptor): Promise<PageRecord> => {
  return withPageMutationLock(page.key, () => getOrCreatePageRecordUnsafe(page));
};

export const upsertNote = async (
  note: NoteEntity,
  options: UpsertNoteOptions = {}
): Promise<PageRecord> => {
  const shouldEnqueueInsert = options.enqueueInsert ?? true;
  const page = {
    key: note.pageKey,
    title: note.pageTitle,
    url: note.pageUrl,
    lastSeenAt: note.updatedAt
  };

  return withPageMutationLock(page.key, async () => {
    const pageRecord = await getOrCreatePageRecordUnsafe(page);
    const nextNotes = [...pageRecord.notes];
    const existingIndex = nextNotes.findIndex((item) => item.id === note.id);

    if (existingIndex >= 0) {
      nextNotes[existingIndex] = note;
    } else {
      nextNotes.push(note);
    }

    const nextPendingInserts = shouldEnqueueInsert
      ? pageRecord.pendingInserts.some((item) => item.noteId === note.id)
        ? pageRecord.pendingInserts
        : [...pageRecord.pendingInserts, clonePendingInsert(note)]
      : pageRecord.pendingInserts;

    return savePageRecord({
      ...pageRecord,
      notes: nextNotes,
      pendingInserts: nextPendingInserts,
      page
    });
  });
};

export const saveDocument = async (pageKey: PageKey, markdown: string): Promise<PageRecord | null> => {
  return withPageMutationLock(pageKey, async () => {
    const pageRecord = await readPageRecord(pageKey);

    if (!pageRecord) {
      return null;
    }

    return savePageRecord({
      ...pageRecord,
      document: {
        ...pageRecord.document,
        markdown,
        updatedAt: new Date().toISOString()
      }
    });
  });
};

export const flushPendingInserts = async (
  pageKey: PageKey,
  noteIds: string[]
): Promise<PageRecord | null> => {
  return withPageMutationLock(pageKey, async () => {
    const pageRecord = await readPageRecord(pageKey);

    if (!pageRecord) {
      return null;
    }

    const pendingInsertSet = new Set(noteIds);

    return savePageRecord({
      ...pageRecord,
      pendingInserts: pageRecord.pendingInserts.filter((item) => !pendingInsertSet.has(item.noteId))
    });
  });
};

export const upsertAnnotation = async (annotation: WebAnnotationEntity): Promise<PageRecord> => {
  return withPageMutationLock(annotation.pageKey, async () => {
    const pageRecord = await readPageRecord(annotation.pageKey);

    if (!pageRecord) {
      throw new Error("No page record found for the annotation page.");
    }

    const nextAnnotations = [...pageRecord.annotations];
    const existingIndex = nextAnnotations.findIndex((item) => item.id === annotation.id);

    if (existingIndex >= 0) {
      nextAnnotations[existingIndex] = annotation;
    } else {
      nextAnnotations.push(annotation);
    }

    return savePageRecord({
      ...pageRecord,
      annotations: nextAnnotations
    });
  });
};

export const deleteAnnotation = async (
  pageKey: PageKey,
  annotationId: string
): Promise<PageRecord | null> => {
  return withPageMutationLock(pageKey, async () => {
    const pageRecord = await readPageRecord(pageKey);

    if (!pageRecord) {
      return null;
    }

    return savePageRecord({
      ...pageRecord,
      annotations: pageRecord.annotations.filter((item) => item.id !== annotationId)
    });
  });
};

export const deleteNote = async (pageKey: PageKey, noteId: string): Promise<PageRecord | null> => {
  return withPageMutationLock(pageKey, async () => {
    const pageRecord = await readPageRecord(pageKey);

    if (!pageRecord) {
      return null;
    }

    return savePageRecord({
      ...pageRecord,
      notes: pageRecord.notes.filter((item) => item.id !== noteId),
      pendingInserts: pageRecord.pendingInserts.filter((item) => item.noteId !== noteId)
    });
  });
};
