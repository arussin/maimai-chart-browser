/** Authored teaching data; never used as canonical identity or detected evidence. */
export interface PatternDefinition {
  pattern_id: string;
  display_name: string;
  definition: string;
  kind: string;
  aliases: (string | { text: string })[];
}
type Position = number | string;
interface ExampleBase {
  duration: number;
  unit: string;
  bands: [number, number, string][];
}
export interface NoteExample extends ExampleBase {
  kind: 'notes';
  notes: [number, Position, string][];
  holds: [number, number, Position][];
  slides: [number, number, number, number[]][];
  slide_labels?: string[];
  slide_points?: [number, number][][];
}
export interface BarExample extends ExampleBase {
  kind: 'bars';
  series: { label: string; values: number[] }[];
}
export type LessonExample = NoteExample | BarExample;
export interface Lesson {
  summary: string;
  watch: string;
  example: LessonExample;
}
export interface LessonBook {
  lessons: Record<string, Lesson>;
}
