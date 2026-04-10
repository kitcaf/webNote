import type { WebAnnotationEntity } from "../shared/types";

export class AnnotationStore {
  private readonly annotations = new Map<string, WebAnnotationEntity>();

  clear(): void {
    this.annotations.clear();
  }

  get(annotationId: string): WebAnnotationEntity | null {
    return this.annotations.get(annotationId) ?? null;
  }

  getAll(): WebAnnotationEntity[] {
    return [...this.annotations.values()];
  }

  remove(annotationId: string): void {
    this.annotations.delete(annotationId);
  }

  setAll(annotations: Iterable<WebAnnotationEntity>): void {
    this.annotations.clear();

    for (const annotation of annotations) {
      this.annotations.set(annotation.id, annotation);
    }
  }

  upsert(annotation: WebAnnotationEntity): void {
    this.annotations.set(annotation.id, annotation);
  }
}
