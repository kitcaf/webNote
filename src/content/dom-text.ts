export interface TextNodeRecord {
  node: Text;
  start: number;
  end: number;
}

export interface TextIndex {
  records: TextNodeRecord[];
  text: string;
}

const SKIPPED_TAGS = new Set(["NOSCRIPT", "SCRIPT", "STYLE", "TEXTAREA"]);

const shouldSkipNode = (node: Text): boolean => {
  const parentElement = node.parentElement;

  if (!parentElement) {
    return true;
  }

  if (parentElement.closest("[data-webnote-overlay='true']")) {
    return true;
  }

  return SKIPPED_TAGS.has(parentElement.tagName);
};

const locateRecordIndex = (records: TextNodeRecord[], absoluteOffset: number): number => {
  let low = 0;
  let high = records.length - 1;
  let candidateIndex = records.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const middleRecord = records[middle];

    if (!middleRecord) {
      break;
    }

    if (absoluteOffset <= middleRecord.end) {
      candidateIndex = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return candidateIndex;
};

export const buildTextIndex = (root: HTMLElement): TextIndex => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const records: TextNodeRecord[] = [];
  const fragments: string[] = [];
  let offset = 0;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || shouldSkipNode(node) || node.data.length === 0) {
      continue;
    }

    records.push({
      node,
      start: offset,
      end: offset + node.data.length
    });
    fragments.push(node.data);
    offset += node.data.length;
  }

  return {
    records,
    text: fragments.join("")
  };
};

export const rangeToOffsets = (
  root: HTMLElement,
  range: Range
): { start: number; end: number } | null => {
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }

  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    start: startRange.toString().length,
    end: endRange.toString().length
  };
};

export const offsetsToRange = (
  index: TextIndex,
  start: number,
  end: number
): Range | null => {
  if (index.records.length === 0 || end <= start) {
    return null;
  }

  const startIndex = locateRecordIndex(index.records, start);
  const endIndex = locateRecordIndex(index.records, end);
  const startRecord = index.records[startIndex];
  const endRecord = index.records[endIndex];

  if (!startRecord || !endRecord) {
    return null;
  }

  const normalizedStart = Math.max(startRecord.start, Math.min(start, startRecord.end));
  const normalizedEnd = Math.max(endRecord.start, Math.min(end, endRecord.end));

  const range = document.createRange();
  range.setStart(startRecord.node, normalizedStart - startRecord.start);
  range.setEnd(endRecord.node, normalizedEnd - endRecord.start);
  return range;
};
