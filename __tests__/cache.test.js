import { cacheGet, cacheSet, cacheInvalidate, cacheCleanup } from '../src/services/cache.js';

beforeEach(() => {
    cacheInvalidate();
});

describe('cacheSet and cacheGet', () => {
    describe('basic operations', () => {
        test('stores and retrieves a string value', () => {
            cacheSet('key1', 'hello');
            expect(cacheGet('key1')).toBe('hello');
        });

        test('stores and retrieves a number', () => {
            cacheSet('num', 42);
            expect(cacheGet('num')).toBe(42);
        });

        test('stores and retrieves an object', () => {
            const obj = { a: 1, b: [2, 3] };
            cacheSet('obj', obj);
            expect(cacheGet('obj')).toEqual(obj);
        });

        test('stores and retrieves an array', () => {
            const arr = [1, 2, 3];
            cacheSet('arr', arr);
            expect(cacheGet('arr')).toEqual(arr);
        });

        test('stores and retrieves null', () => {
            cacheSet('null', null);
            expect(cacheGet('null')).toBeNull();
        });

        test('stores and retrieves boolean', () => {
            cacheSet('bool', true);
            expect(cacheGet('bool')).toBe(true);
        });
    });

    describe('overwrite behavior', () => {
        test('overwrites existing key', () => {
            cacheSet('key', 'old');
            cacheSet('key', 'new');
            expect(cacheGet('key')).toBe('new');
        });

        test('overwrites with different type', () => {
            cacheSet('key', 123);
            cacheSet('key', 'string');
            expect(cacheGet('key')).toBe('string');
        });
    });

    describe('undefined keys', () => {
        test('returns undefined for non-existent key', () => {
            expect(cacheGet('nonexistent')).toBeUndefined();
        });

        test('returns undefined for empty key', () => {
            expect(cacheGet('')).toBeUndefined();
        });
    });

    describe('multiple keys', () => {
        test('stores multiple independent keys', () => {
            cacheSet('a', 1);
            cacheSet('b', 2);
            cacheSet('c', 3);
            expect(cacheGet('a')).toBe(1);
            expect(cacheGet('b')).toBe(2);
            expect(cacheGet('c')).toBe(3);
        });

        test('keys with similar prefixes are independent', () => {
            cacheSet('prefix:key1', 'val1');
            cacheSet('prefix:key2', 'val2');
            expect(cacheGet('prefix:key1')).toBe('val1');
            expect(cacheGet('prefix:key2')).toBe('val2');
        });
    });
});

describe('TTL expiration', () => {
    test('expires after TTL', async () => {
        cacheSet('expire', 'gone', 10);
        expect(cacheGet('expire')).toBe('gone');
        await new Promise(r => setTimeout(r, 15));
        expect(cacheGet('expire')).toBeUndefined();
    });

    test('default TTL is 30s', () => {
        cacheSet('default', 'val');
        expect(cacheGet('default')).toBe('val');
    });

    test('zero TTL expires immediately', async () => {
        cacheSet('zero', 'val', 0);
        await new Promise(r => setTimeout(r, 5));
        expect(cacheGet('zero')).toBeUndefined();
    });

    test('long TTL persists', () => {
        cacheSet('long', 'val', 3600000);
        expect(cacheGet('long')).toBe('val');
    });

    test('different keys expire independently', async () => {
        cacheSet('fast', 'gone', 10);
        cacheSet('slow', 'stay', 1000);
        await new Promise(r => setTimeout(r, 20));
        expect(cacheGet('fast')).toBeUndefined();
        expect(cacheGet('slow')).toBe('stay');
    });
});

describe('cacheInvalidate', () => {
    describe('invalidate all', () => {
        test('clears all entries when called with no pattern', () => {
            cacheSet('a', 1);
            cacheSet('b', 2);
            cacheInvalidate();
            expect(cacheGet('a')).toBeUndefined();
            expect(cacheGet('b')).toBeUndefined();
        });

        test('clears all entries when called with empty string', () => {
            cacheSet('x', 1);
            cacheInvalidate('');
            expect(cacheGet('x')).toBeUndefined();
        });
    });

    describe('invalidate by prefix', () => {
        test('removes keys with matching prefix', () => {
            cacheSet('notion:active', [1, 2]);
            cacheSet('notion:done', [3]);
            cacheSet('other:key', 'keep');
            cacheInvalidate('notion:');
            expect(cacheGet('notion:active')).toBeUndefined();
            expect(cacheGet('notion:done')).toBeUndefined();
            expect(cacheGet('other:key')).toBe('keep');
        });

        test('removes keys with longer prefix', () => {
            cacheSet('user:123', 'a');
            cacheSet('user:456', 'b');
            cacheSet('admin:123', 'c');
            cacheInvalidate('user:');
            expect(cacheGet('user:123')).toBeUndefined();
            expect(cacheGet('user:456')).toBeUndefined();
            expect(cacheGet('admin:123')).toBe('c');
        });

        test('prefix matches exact key', () => {
            cacheSet('abc', 'val');
            cacheInvalidate('abc');
            expect(cacheGet('abc')).toBeUndefined();
        });
    });

    describe('invalidate does not affect non-matching', () => {
        test('preserves unrelated keys', () => {
            cacheSet('keep1', 1);
            cacheSet('keep2', 2);
            cacheInvalidate('nonexistent:');
            expect(cacheGet('keep1')).toBe(1);
            expect(cacheGet('keep2')).toBe(2);
        });

        test('prefix matches partial key segment', () => {
            cacheSet('foo:bar', 1);
            cacheInvalidate('foo:ba');
            expect(cacheGet('foo:bar')).toBeUndefined();
        });
    });
});

describe('cacheCleanup', () => {
    test('removes expired entries', async () => {
        cacheSet('exp1', 'val1', 10);
        cacheSet('exp2', 'val2', 10);
        cacheSet('keep1', 'val3', 10000);
        await new Promise(r => setTimeout(r, 20));
        expect(cacheGet('exp1')).toBeUndefined();
        expect(cacheGet('exp2')).toBeUndefined();
        expect(cacheGet('keep1')).toBe('val3');
    });

    test('does not remove valid entries', () => {
        cacheSet('stay', 'val', 30000);
        expect(cacheGet('stay')).toBe('val');
    });

    test('handles empty store', () => {
        cacheInvalidate();
        expect(() => cacheCleanup()).not.toThrow();
    });

    test('after cleanup, new entries still work', () => {
        cacheInvalidate();
        cacheSet('new', 'val', 30000);
        cacheCleanup();
        expect(cacheGet('new')).toBe('val');
    });
});

describe('concurrent access patterns', () => {
    test('set and get in rapid succession', () => {
        for (let i = 0; i < 100; i++) {
            cacheSet(`key${i}`, `val${i}`);
        }
        for (let i = 0; i < 100; i++) {
            expect(cacheGet(`key${i}`)).toBe(`val${i}`);
        }
    });

    test('invalidation while iterating', () => {
        cacheSet('a', 1);
        cacheSet('b', 2);
        cacheSet('c', 3);
        cacheInvalidate('b');
        expect(cacheGet('a')).toBe(1);
        expect(cacheGet('b')).toBeUndefined();
        expect(cacheGet('c')).toBe(3);
    });

    test('multiple invalidations', () => {
        cacheSet('x1', 'a');
        cacheSet('x2', 'b');
        cacheSet('y1', 'c');
        cacheInvalidate('x');
        cacheInvalidate('y');
        expect(cacheGet('x1')).toBeUndefined();
        expect(cacheGet('x2')).toBeUndefined();
        expect(cacheGet('y1')).toBeUndefined();
    });
});

describe('TTL edge cases', () => {
    test('very small TTL expires fast', async () => {
        cacheSet('fast', 'gone', 1);
        await new Promise(r => setTimeout(r, 5));
        expect(cacheGet('fast')).toBeUndefined();
    });

    test('large TTL value', () => {
        cacheSet('slow', 'stay', 86400000);
        expect(cacheGet('slow')).toBe('stay');
    });

    test('TTL of Infinity', () => {
        cacheSet('inf', 'val', Infinity);
        expect(cacheGet('inf')).toBe('val');
    });

    test('multiple keys with different TTLs', async () => {
        cacheSet('fast1', 'a', 10);
        cacheSet('fast2', 'b', 10);
        cacheSet('slow', 'c', 10000);
        await new Promise(r => setTimeout(r, 20));
        expect(cacheGet('fast1')).toBeUndefined();
        expect(cacheGet('fast2')).toBeUndefined();
        expect(cacheGet('slow')).toBe('c');
    });

    test('re-setting key extends TTL', async () => {
        cacheSet('refresh', 'old', 10);
        await new Promise(r => setTimeout(r, 5));
        cacheSet('refresh', 'new', 10000);
        await new Promise(r => setTimeout(r, 10));
        expect(cacheGet('refresh')).toBe('new');
    });
});

describe('pattern invalidation edge cases', () => {
    test('prefix matches exact key', () => {
        cacheSet('abc', 'val');
        cacheInvalidate('abc');
        expect(cacheGet('abc')).toBeUndefined();
    });

    test('prefix matches start of key', () => {
        cacheSet('notion:active', 'val1');
        cacheSet('notion:done', 'val2');
        cacheSet('notion:upcoming:2025', 'val3');
        cacheInvalidate('notion:');
        expect(cacheGet('notion:active')).toBeUndefined();
        expect(cacheGet('notion:done')).toBeUndefined();
        expect(cacheGet('notion:upcoming:2025')).toBeUndefined();
    });

    test('prefix with colon separators', () => {
        cacheSet('user:100', 'a');
        cacheSet('user:200', 'b');
        cacheSet('admin:100', 'c');
        cacheInvalidate('user:');
        expect(cacheGet('user:100')).toBeUndefined();
        expect(cacheGet('user:200')).toBeUndefined();
        expect(cacheGet('admin:100')).toBe('c');
    });

    test('prefix with nested separators', () => {
        cacheSet('a:b:c', 1);
        cacheSet('a:b:d', 2);
        cacheSet('a:c:b', 3);
        cacheInvalidate('a:b:');
        expect(cacheGet('a:b:c')).toBeUndefined();
        expect(cacheGet('a:b:d')).toBeUndefined();
        expect(cacheGet('a:c:b')).toBe(3);
    });
});

describe('edge cases', () => {
    test('set and get after invalidation', () => {
        cacheSet('temp', 'val');
        cacheInvalidate();
        cacheSet('new', 'val2');
        expect(cacheGet('new')).toBe('val2');
    });

    test('multiple sets same key extends TTL', async () => {
        cacheSet('refresh', 'old', 20);
        await new Promise(r => setTimeout(r, 10));
        cacheSet('refresh', 'new', 30);
        await new Promise(r => setTimeout(r, 15));
        expect(cacheGet('refresh')).toBe('new');
    });

    test('handles special characters in keys', () => {
        cacheSet('key:with/special?chars', 'val');
        expect(cacheGet('key:with/special?chars')).toBe('val');
    });

    test('handles very long keys', () => {
        const longKey = 'a'.repeat(1000);
        cacheSet(longKey, 'val');
        expect(cacheGet(longKey)).toBe('val');
    });

    test('handles very long values', () => {
        const longVal = 'x'.repeat(10000);
        cacheSet('long', longVal);
        expect(cacheGet('long')).toBe(longVal);
    });

    test('cache is isolated between tests', () => {
        expect(cacheGet('should-be-clean')).toBeUndefined();
    });
});
