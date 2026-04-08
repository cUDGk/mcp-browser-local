import type { BoundingBox } from "./common.js";

export type SnapshotElement = {
  ref: string;
  kind: string;
  role?: string;
  name?: string;
  text?: string;
  selectorHints: string[];
  visible: boolean;
  enabled: boolean;
  frameId: string;
  bbox?: BoundingBox;
};

export type PageSnapshot = {
  url: string;
  title: string;
  viewport?: {
    width: number;
    height: number;
  };
  mainFrame: {
    textSummary: string[];
  };
  headings: Array<{
    level: number;
    text: string;
  }>;
  elements: SnapshotElement[];
};
