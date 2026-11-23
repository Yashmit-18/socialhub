import { describe, expect, it } from 'vitest';
import { statusNotices, warningText } from './labels.js';

const base = {
  canPublish: true,
  reason: null,
  message: null,
  queue: { status: 'READY' },
  worker: { status: 'RUNNING' },
  storage: { publicUrls: true },
};

describe('publishing status notices', () => {
  it('says plainly when posts go to the real accounts', () => {
    const notices = statusNotices({
      ...base,
      mode: 'LIVE',
      workspaceMode: 'LIVE',
      liveAvailable: true,
    });
    expect(notices).toEqual([
      expect.objectContaining({ key: 'live', tone: 'info', title: 'Real publishing is on.' }),
    ]);
    expect(notices[0].text).toMatch(/real Facebook Pages and Instagram accounts/);
  });

  it('explains a workspace that chose real publishing on a server that no longer offers it', () => {
    const [notice] = statusNotices({
      ...base,
      mode: 'SIMULATED',
      workspaceMode: 'LIVE',
      liveAvailable: false,
    });
    expect(notice).toMatchObject({ key: 'simulated', title: 'Simulation mode.' });
    expect(notice.text).toMatch(/this server does not offer it right now/);
  });

  it('keeps the usual simulation wording otherwise', () => {
    const [notice] = statusNotices({ ...base, mode: 'SIMULATED', workspaceMode: 'SIMULATED' });
    expect(notice.text).toBe(
      'Posts go through the whole process, but nothing is sent to Facebook or Instagram.',
    );
  });

  it('has words for the warnings Instagram can report on a published post', () => {
    expect(warningText('CAPTION_NOT_ATTACHED')).toMatch(/caption could not be attached/);
    expect(warningText('PLATFORM_PARTIAL')).toMatch(/part of it could not be applied/);
  });
});
