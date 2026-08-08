import { describe, expect, it } from 'vitest';

const views = import.meta.glob('./{components,pages}/**/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('user-facing copy policy', () => {
  it('does not embed manual HTML line breaks in React views', () => {
    const offenders = Object.entries(views)
      .filter(([path, source]) => !path.endsWith('.test.tsx') && /<br\s*\/?>/i.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('uses the local SVG icon system instead of pictographs in React views', () => {
    const pictograph = /\p{Extended_Pictographic}/u;
    const offenders = Object.entries(views)
      .filter(([path, source]) => !path.endsWith('.test.tsx') && pictograph.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
