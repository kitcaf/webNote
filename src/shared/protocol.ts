import type {
  NoteEntity,
  PageDescriptor,
  PageKey,
  PageRecord,
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
      openSidePanel?: boolean;
    };
  };
}

export interface ContentCaptureSelectionMessage {
  type: "content/capture-selection";
}

export interface ContentOpenSidePanelMessage {
  type: "content/open-side-panel";
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

export interface PanelBootstrapMessage {
  type: "panel/bootstrap";
}

export interface PanelSaveDocumentMessage {
  type: "panel/save-document";
  payload: {
    pageKey: PageKey;
    markdown: string;
  };
}

export interface PanelFlushPendingMessage {
  type: "panel/flush-pending";
  payload: {
    pageKey: PageKey;
    noteIds: string[];
  };
}

export interface PanelOpenSourceMessage {
  type: "panel/open-source";
  payload: {
    pageKey: PageKey;
    noteId: string;
  };
}

export interface BackgroundPageUpdatedMessage {
  type: "background/page-updated";
  payload: PageViewState;
}

export type RuntimeMessage =
  | BackgroundPageUpdatedMessage
  | ContentActivateNoteMessage
  | ContentCaptureSelectionMessage
  | ContentCreateNoteMessage
  | ContentDeleteAnnotationMessage
  | ContentDeleteNoteMessage
  | ContentOpenSidePanelMessage
  | ContentPageChangedMessage
  | ContentPageReadyMessage
  | ContentReplaceAnnotationsMessage
  | ContentUpsertAnnotationMessage
  | PanelBootstrapMessage
  | PanelFlushPendingMessage
  | PanelOpenSourceMessage
  | PanelSaveDocumentMessage;

export interface BasicResponse {
  ok: boolean;
  reason?: string;
}

export interface PageRecordResponse extends BasicResponse {
  pageState: PageViewState;
}
