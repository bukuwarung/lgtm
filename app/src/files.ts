import { isMarkdown } from './markdown.ts';

// Where a test's subject would live: src/test|androidTest/… → src/main/…, FooTest.kt / foo.test.ts → Foo.kt / foo.ts.
const subject = (path: string) =>
  path
    .replace(/\/src\/(test|androidTest|sharedTest|testFixtures)\w*\//, '/src/main/')
    .replace(/(^|\/)__tests__\//, '$1')
    .replace(/(Tests?|Spec|IT)(\.\w+)$/, '$2')
    .replace(/[._-](test|spec)(\.\w+)$/, '$2');
const isTest = (path: string) => subject(path) !== path;

// Reading order: markdown (the intent) first, then each source file followed by its tests.
export const reviewOrder = (paths: string[]) =>
  [...paths].sort(
    (a, b) => +isMarkdown(b) - +isMarkdown(a) || subject(a).localeCompare(subject(b)) || +isTest(a) - +isTest(b) || a.localeCompare(b),
  );
