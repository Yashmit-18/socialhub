import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMetaSettingsForTests } from '../src/integrations/meta/settings.js';
import { ActivityLog, PublishJob, Workspace } from '../src/models/index.js';
import { setPublishingSettingsForTests } from '../src/modules/publishing/publishing.settings.js';
import { setPublishQueueForTests } from '../src/queue/publishQueue.js';
import { as, createWorkspace, registerUser, seedSocialAccounts, seedTeam } from './helpers.js';
import { createDraft, createTestQueue, publish } from './publishFixtures.js';

/**
 * The workspace publishing mode: simulated by default, real publishing only when the server
 * offers it (PUBLISHING_MODE=live) AND an owner or admin switched the workspace with their
 * password. Nothing here calls Meta.
 */

let team;
let ws;
let pages;
const modeUrl = (workspaceId) => `/api/v1/workspaces/${workspaceId}/publishing/mode`;
const statusUrl = (workspaceId) => `/api/v1/workspaces/${workspaceId}/publishing/status`;
const goLive = (member, body = {}) =>
  as(member.token)
    .put(modeUrl(ws))
    .send({ mode: 'LIVE', password: member.password, acknowledgeRealPublishing: true, ...body });

beforeEach(async () => {
  team = await seedTeam();
  ws = team.workspace.id;
  const seeded = await seedSocialAccounts(ws, team.owner.user.id, { pages: 1, instagram: 0 });
  pages = seeded.accounts;
  setPublishQueueForTests(createTestQueue());
  setPublishingSettingsForTests({ mode: 'LIVE', maxAttempts: 3 });
});

afterEach(() => {
  setPublishQueueForTests(undefined);
  setPublishingSettingsForTests(undefined);
  setMetaSettingsForTests(undefined);
});

describe('default', () => {
  it('every workspace starts in simulation, even on a server that offers real publishing', async () => {
    const status = await as(team.viewer.token).get(statusUrl(ws));
    expect(status.body).toMatchObject({
      mode: 'SIMULATED',
      workspaceMode: 'SIMULATED',
      liveAvailable: true,
    });
    const draft = await createDraft(team.owner.token, ws, { accounts: pages });
    const res = await publish(team.owner.token, ws, { contentPackageId: draft.id });
    expect(res.body.publishJob).toMatchObject({ mode: 'SIMULATED', simulated: true });
  });

  it('cannot be switched to live when the server does not offer it', async () => {
    setPublishingSettingsForTests({ mode: 'SIMULATED' });
    const res = await goLive(team.owner);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('LIVE_NOT_AVAILABLE');
    expect((await Workspace.findById(ws)).publishingMode).toBe('SIMULATED');
    expect((await as(team.owner.token).get(statusUrl(ws))).body.liveAvailable).toBe(false);
  });

  it('cannot be switched to live without a configured Meta app', async () => {
    setMetaSettingsForTests({ facebook: null, instagram: null });
    const res = await goLive(team.owner);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('META_NOT_CONFIGURED');
  });
});

describe('switching to live', () => {
  it('only owners and admins may switch, and every switch is recorded', async () => {
    for (const member of [team.editor, team.viewer]) {
      const res = await goLive(member);
      expect(res.status).toBe(403);
    }
    expect((await Workspace.findById(ws)).publishingMode).toBe('SIMULATED');

    const res = await goLive(team.admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'LIVE', workspaceMode: 'LIVE', liveAvailable: true });
    const workspace = await Workspace.findById(ws);
    expect(workspace.publishingMode).toBe('LIVE');
    expect(String(workspace.publishingModeChangedBy)).toBe(team.admin.user.id);

    const entry = await ActivityLog.findOne({ workspace: ws, action: 'publishing.mode_changed' });
    expect(entry.metadata).toMatchObject({ from: 'SIMULATED', to: 'LIVE' });
    expect(JSON.stringify(entry)).not.toContain(team.admin.password);
  });

  it('needs the correct password and an explicit acknowledgement', async () => {
    const missing = await as(team.owner.token).put(modeUrl(ws)).send({ mode: 'LIVE' });
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.error.details.fields)).toEqual(
      expect.arrayContaining(['password', 'acknowledgeRealPublishing']),
    );
    const wrong = await goLive(team.owner, { password: 'not-the-password-123' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.fields.password).toMatch(/incorrect/);
    const unacknowledged = await goLive(team.owner, { acknowledgeRealPublishing: false });
    expect(unacknowledged.status).toBe(422);
    expect((await Workspace.findById(ws)).publishingMode).toBe('SIMULATED');
    expect(await ActivityLog.countDocuments({ action: 'publishing.mode_changed' })).toBe(0);
  });

  it('new jobs are LIVE afterwards; switching back needs no password and makes them simulated again', async () => {
    expect((await goLive(team.owner)).status).toBe(200);
    const first = await createDraft(team.owner.token, ws, { accounts: pages });
    expect(
      (await publish(team.owner.token, ws, { contentPackageId: first.id, confirmRealPost: true }))
        .body.publishJob.mode,
    ).toBe('LIVE');

    const back = await as(team.admin.token).put(modeUrl(ws)).send({ mode: 'SIMULATED' });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ mode: 'SIMULATED', workspaceMode: 'SIMULATED' });
    const second = await createDraft(team.owner.token, ws, { accounts: pages });
    expect(
      (await publish(team.owner.token, ws, { contentPackageId: second.id })).body.publishJob.mode,
    ).toBe('SIMULATED');
    expect(await ActivityLog.countDocuments({ action: 'publishing.mode_changed' })).toBe(2);
  });

  it('a live workspace falls back to simulation for new jobs when the server stops offering it', async () => {
    expect((await goLive(team.owner)).status).toBe(200);
    setPublishingSettingsForTests({ mode: 'SIMULATED' });
    const status = await as(team.owner.token).get(statusUrl(ws));
    expect(status.body).toMatchObject({
      mode: 'SIMULATED',
      workspaceMode: 'LIVE',
      liveAvailable: false,
    });
  });

  it('is isolated per workspace', async () => {
    expect((await goLive(team.owner)).status).toBe(200);
    const other = await registerUser({ name: 'Other Owner' });
    const { workspace } = await createWorkspace(other.token, { name: 'Other Agency' });
    const otherPages = (
      await seedSocialAccounts(workspace.id, other.user.id, {
        pages: 1,
        instagram: 0,
        externalUserId: 'fb-user-2',
      })
    ).accounts;
    expect((await as(other.token).get(statusUrl(workspace.id))).body.mode).toBe('SIMULATED');
    const draft = await createDraft(other.token, workspace.id, { accounts: otherPages });
    const res = await publish(other.token, workspace.id, { contentPackageId: draft.id });
    expect(res.body.publishJob.mode).toBe('SIMULATED');
    // And nobody outside the workspace can change it.
    const outsider = await as(other.token).put(modeUrl(ws)).send({ mode: 'SIMULATED' });
    expect(outsider.status).toBe(404);
    expect((await Workspace.findById(ws)).publishingMode).toBe('LIVE');
    expect(await PublishJob.countDocuments({ workspace: ws })).toBe(0);
  });
});
