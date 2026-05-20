import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../src/logger.js';

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockReset().mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockReset().mockImplementation(() => {});
    vi.spyOn(console, 'error').mockReset().mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockReset().mockImplementation(() => {});
  });

  it('info writes to console.log', () => {
    logger.info('hello');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('INFO'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('hello'));
  });

  it('warn writes to console.warn', () => {
    logger.warn('warning');
    expect(console.warn).toHaveBeenCalled();
  });

  it('error writes to console.error', () => {
    logger.error('error msg', { code: 500 });
    expect(console.error).toHaveBeenCalled();
  });

  it('debug does not write by default (LOG_LEVEL=info)', () => {
    logger.debug('debug msg');
    expect(console.debug).not.toHaveBeenCalled();
  });
});
