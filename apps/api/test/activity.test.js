import { describe, expect, it } from 'vitest';
import { ActivityLog } from '../src/models/index.js';
import { as, createWorkspace, registerUser, seedTeam } from './helpers.js';

describe('activity log', () => {
  it('paginates newest-first with a cursor', async () => {
    const { token, user } = await registerUser({ name: 'Logger' });
    const { workspace } = await createWorkspace(token);
    // 1 entry from creation + 24 updates.
    for (let i = 0; i < 24; i += 1) {
      await ActivityLog.create({
        workspace: workspace.id,
        actor: user.id,
        actorName: 'Logger',
        action: 'workspace.updated',
        metadata: { i },
      });
    }

    const first = await as(token).get(`/api/v1/workspaces/${workspace.id}/activity?limit=10`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(10);
    expect(first.body.items[0].metadata.i).toBe(23);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await as(token).get(
      `/api/v1/workspaces/${workspace.id}/activity?limit=10&cursor=${first.body.nextCursor}`,
    );
    const third = await as(token).get(
      `/api/v1/workspaces/${workspace.id}/activity?limit=10&cursor=${second.body.nextCursor}`,
    );
    expect(second.body.items[0].metadata.i).toBe(13);
    expect(third.body.items).toHaveLength(5);
    expect(third.body.items.at(-1).action).toBe('workspace.created');
    expect(third.body.nextCursor).toBeNull();

    const ids = [...first.body.items, ...second.body.items, ...third.body.items].map((e) => e.id);
    expect(new Set(ids).size).toBe(25);
  });

  it('does not expose IP addresses or user agents', async () => {
    const { token } = await registerUser();
    const { workspace } = await createWorkspace(token);
    const res = await as(token).get(`/api/v1/workspaces/${workspace.id}/activity`);
    expect(res.body.items[0]).not.toHaveProperty('ip');
    expect(res.body.items[0]).not.toHaveProperty('userAgent');
    expect(res.body.items[0]).toMatchObject({
      action: 'workspace.created',
      actorName: expect.any(String),
    });
  });

  it('records the full team lifecycle', async () => {
    const { workspace, owner } = await seedTeam();
    const res = await as(owner.token).get(`/api/v1/workspaces/${workspace.id}/activity?limit=50`);
    const actions = res.body.items.map((e) => e.action);
    expect(actions.filter((a) => a === 'invitation.created')).toHaveLength(3);
    expect(actions.filter((a) => a === 'invitation.accepted')).toHaveLength(3);
    expect(actions).toContain('workspace.created');
  });

  it('is restricted to owners and admins', async () => {
    const { workspace, admin, editor, viewer } = await seedTeam();
    expect((await as(admin.token).get(`/api/v1/workspaces/${workspace.id}/activity`)).status).toBe(
      200,
    );
    expect((await as(editor.token).get(`/api/v1/workspaces/${workspace.id}/activity`)).status).toBe(
      403,
    );
    expect((await as(viewer.token).get(`/api/v1/workspaces/${workspace.id}/activity`)).status).toBe(
      403,
    );
  });

  it('validates pagination input', async () => {
    const { token } = await registerUser();
    const { workspace } = await createWorkspace(token);
    expect(
      (await as(token).get(`/api/v1/workspaces/${workspace.id}/activity?limit=500`)).status,
    ).toBe(422);
    expect(
      (await as(token).get(`/api/v1/workspaces/${workspace.id}/activity?cursor=abc`)).status,
    ).toBe(422);
    expect(
      (await as(token).get(`/api/v1/workspaces/${workspace.id}/activity?sort=asc`)).status,
    ).toBe(422);
  });
});
