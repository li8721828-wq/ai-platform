import { describe, it, expect } from 'vitest';
import { safeJsonParse, safeJson, now, genId } from '../src/utils.js';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns fallback for invalid JSON', () => {
    expect(safeJsonParse('not json', {})).toEqual({});
  });

  it('returns null for empty input', () => {
    expect(safeJsonParse('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(safeJsonParse(null as any)).toBeNull();
  });
});

describe('safeJson', () => {
  it('serializes an object', () => {
    expect(safeJson({ a: 1 })).toBe('{"a":1}');
  });

  it('returns fallback on circular reference', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(safeJson(obj, '{}')).toBe('{}');
  });
});

describe('now', () => {
  it('returns a number', () => {
    expect(typeof now()).toBe('number');
  });

  it('is close to Date.now()', () => {
    expect(Math.abs(now() - Date.now())).toBeLessThan(100);
  });
});

describe('genId', () => {
  it('generates a string with prefix', () => {
    const id = genId('test_');
    expect(id).toContain('test_');
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => genId()));
    expect(ids.size).toBe(100);
  });
});
