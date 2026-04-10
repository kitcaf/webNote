import type {
  NoteEntity,
  PageDescriptor,
  PageKey,
  PageViewState,
  WebAnnotationEntity
} from "./types";

export interface ContentPageReadyMessage {
  type: "content/page-ready";
  payload: {
    page: PageDescriptor;
  };
}

export interface ContentPageChangedMessage {
  type: "content/page-changed";
  payload: {
    page: PageDescriptor;
  };
}

export interface ContentCreateNoteMessage {
  type: "content/create-note";
  payload: {
    note: NoteEntity;
    options?: {
      enqueueInsert?: boolean;
    };
  };
}

export interface ContentCaptureSelectionMessage {
  type: "content/capture-selection";
}

export interface ContentUpsertAnnotationMessage {
  type: "content/upsert-annotation";
  payload: {
    annotation: WebAnnotationEntity;
  };
}

export interface ContentDeleteAnnotationMessage {
  type: "content/delete-annotation";
  payload: {
    pageKey: PageKey;
    annotationId: string;
  };
}

export interface ContentReplaceAnnotationsMessage {
  type: "content/replace-annotations";
  payload: {
    annotations: WebAnnotationEntity[];
    pageKey: PageKey;
  };
}

export interface ContentDeleteNoteMessage {
  type: "content/delete-note";
  payload: {
    pageKey: PageKey;
    noteId: string;
  };
}

export interface ContentActivateNoteMessage {
  type: "content/activate-note";
  payload: {
    pageKey: PageKey;
    noteId: string;
  };
}

export type RuntimeMessage =
  | ContentActivateNoteMessage
  | ContentCaptureSelectionMessage
  | ContentCreateNoteMessage
  | ContentDeleteAnnotationMessage
  | ContentDeleteNoteMessage
  | ContentPageChangedMessage
  | ContentPageReadyMessage
  | ContentReplaceAnnotationsMessage
  | ContentUpsertAnnotationMessage;

export interface BasicResponse {
  ok: boolean;
  reason?: string;
}

export interface PageRecordResponse extends BasicResponse {
  pageState: PageViewState;
}
