import crypto from 'crypto';
import type Database from 'better-sqlite3';

export interface UserResetScopes {
  xp: boolean;
  achievements: boolean;
  cosmetics: boolean;
  games: boolean;
}

export interface AdminUserResetInput {
  adminUserId: string;
  mode: 'single' | 'bulk';
  targetUserId?: string;
  skipAdmins?: boolean;
  confirmText?: string;
  scopes: UserResetScopes;
}

export type AdminUserResetResult =
  | {
      ok: true;
      mode: 'single' | 'bulk';
      affected_users: number;
      scopes: UserResetScopes;
      audit_fallback_used?: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function insertModerationAuditRow(
  targetDb: Database.Database,
  colSet: Set<string>,
  params: {
    id: string;
    moderatorId: string;
    targetUserId: string | null;
    actionName: string;
    detailsText: string;
  }
): void {
  const columns: string[] = [];
  const values: Array<string | null> = [];

  if (colSet.has('id')) {
    columns.push('id');
    values.push(params.id);
  }
  if (colSet.has('moderator_id')) {
    columns.push('moderator_id');
    values.push(params.moderatorId);
  }
  if (colSet.has('target_user_id')) {
    columns.push('target_user_id');
    values.push(params.targetUserId);
  }
  if (colSet.has('action_type')) {
    columns.push('action_type');
    values.push(params.actionName);
  }
  if (colSet.has('action')) {
    columns.push('action');
    values.push(params.actionName);
  }
  if (colSet.has('details')) {
    columns.push('details');
    values.push(params.detailsText);
  }
  if (colSet.has('reason')) {
    columns.push('reason');
    values.push(params.detailsText);
  }

  if (columns.length === 0) return;

  const placeholders = columns.map(() => '?').join(', ');
  targetDb
    .prepare(`INSERT INTO moderation_actions (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...values);
}

export function writeResetModerationAuditSafe(
  targetDb: Database.Database,
  params: {
    adminUserId: string;
    mode: 'single' | 'bulk';
    primaryTargetId: string | null;
    affectedCount: number;
    skipAdmins: boolean;
    scopes: UserResetScopes;
  }
): { fallbackUsed: boolean } {
  const cols = targetDb
    .prepare('PRAGMA table_info(moderation_actions)')
    .all() as Array<{ name: string; notnull: number }>;

  if (cols.length === 0) {
    return { fallbackUsed: false };
  }

  const colSet = new Set(cols.map((c) => c.name));
  const targetCol = cols.find((c) => c.name === 'target_user_id');
  const targetRequiresNonNull = Boolean(targetCol && Number(targetCol.notnull) === 1);

  const actionName = params.mode === 'bulk' ? 'mass_reset' : 'user_reset';
  const detailsText =
    `mode=${params.mode} skip_admins=${params.skipAdmins} ` +
    `affected=${params.affectedCount} scopes=${JSON.stringify(params.scopes)} ` +
    `by=${params.adminUserId}`;

  const modId = 'mod_' + crypto.randomUUID().slice(0, 8);

  // If target_user_id still enforces NOT NULL on an un-migrated schema, log under adminUserId directly
  if (params.mode === 'bulk' && targetRequiresNonNull) {
    const spFallback = `sp_mod_nn_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    targetDb.exec(`SAVEPOINT ${spFallback}`);
    try {
      insertModerationAuditRow(targetDb, colSet, {
        id: modId,
        moderatorId: params.adminUserId,
        targetUserId: params.adminUserId,
        actionName: 'mass_reset',
        detailsText,
      });
      targetDb.exec(`RELEASE SAVEPOINT ${spFallback}`);
      return { fallbackUsed: true };
    } catch (err) {
      try {
        targetDb.exec(`ROLLBACK TO SAVEPOINT ${spFallback}`);
        targetDb.exec(`RELEASE SAVEPOINT ${spFallback}`);
      } catch {}
      console.error('[ModerationAudit] Fallback audit insert failed (reset preserved):', err);
      return { fallbackUsed: true };
    }
  }

  const preferredTargetId = params.mode === 'single' ? params.primaryTargetId : null;
  const spPrimary = `sp_mod_pri_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  targetDb.exec(`SAVEPOINT ${spPrimary}`);
  try {
    insertModerationAuditRow(targetDb, colSet, {
      id: modId,
      moderatorId: params.adminUserId,
      targetUserId: preferredTargetId,
      actionName,
      detailsText,
    });
    targetDb.exec(`RELEASE SAVEPOINT ${spPrimary}`);
    return { fallbackUsed: false };
  } catch (err: any) {
    try {
      targetDb.exec(`ROLLBACK TO SAVEPOINT ${spPrimary}`);
      targetDb.exec(`RELEASE SAVEPOINT ${spPrimary}`);
    } catch {}

    const errMsg = String(err?.message || '');
    const isNotNullOrConstraint =
      err?.code === 'SQLITE_CONSTRAINT_NOTNULL' ||
      err?.code === 'SQLITE_CONSTRAINT' ||
      /NOT NULL constraint failed/i.test(errMsg);

    if (isNotNullOrConstraint || params.mode === 'bulk') {
      const spRetry = `sp_mod_ret_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
      targetDb.exec(`SAVEPOINT ${spRetry}`);
      try {
        insertModerationAuditRow(targetDb, colSet, {
          id: 'mod_' + crypto.randomUUID().slice(0, 8),
          moderatorId: params.adminUserId,
          targetUserId: params.adminUserId,
          actionName: 'mass_reset',
          detailsText,
        });
        targetDb.exec(`RELEASE SAVEPOINT ${spRetry}`);
        return { fallbackUsed: true };
      } catch (retryErr) {
        try {
          targetDb.exec(`ROLLBACK TO SAVEPOINT ${spRetry}`);
          targetDb.exec(`RELEASE SAVEPOINT ${spRetry}`);
        } catch {}
        console.error('[ModerationAudit] Audit retry failed (reset preserved):', retryErr);
        return { fallbackUsed: true };
      }
    }

    console.error('[ModerationAudit] Audit insert failed (reset preserved):', err);
    return { fallbackUsed: true };
  }
}

export function executeAdminUserReset(
  targetDb: Database.Database,
  input: AdminUserResetInput
): AdminUserResetResult {
  const mode = input.mode === 'bulk' ? 'bulk' : 'single';
  const targetUserId = typeof input.targetUserId === 'string' ? input.targetUserId.trim() : '';
  const skipAdmins = input.skipAdmins !== false;
  const confirmText = String(input.confirmText || '').trim();
  const scopes: UserResetScopes = {
    xp: Boolean(input.scopes?.xp),
    achievements: Boolean(input.scopes?.achievements),
    cosmetics: Boolean(input.scopes?.cosmetics),
    games: Boolean(input.scopes?.games),
  };

  if (!scopes.xp && !scopes.achievements && !scopes.cosmetics && !scopes.games) {
    return { ok: false, status: 400, error: 'Выберите хотя бы одну категорию данных для сброса.' };
  }

  let targetIds: string[] = [];
  if (mode === 'single') {
    if (!targetUserId) {
      return { ok: false, status: 400, error: 'Выберите пользователя для сброса.' };
    }
    const row = targetDb.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId) as { id: string } | undefined;
    if (!row) {
      return { ok: false, status: 404, error: 'Пользователь не найден.' };
    }
    targetIds = [row.id];
  } else {
    if (confirmText !== 'СБРОСИТЬ') {
      return { ok: false, status: 400, error: 'Для массового сброса введите точное слово СБРОСИТЬ.' };
    }
    const rows = skipAdmins
      ? (targetDb.prepare("SELECT id FROM users WHERE role_id != 'admin'").all() as Array<{ id: string }>)
      : (targetDb.prepare('SELECT id FROM users').all() as Array<{ id: string }>);
    targetIds = rows.map((r) => r.id);
  }

  if (targetIds.length === 0) {
    return { ok: true, mode, affected_users: 0, scopes };
  }

  let auditFallbackUsed = false;

  targetDb.transaction(() => {
    for (const uid of targetIds) {
      if (scopes.xp) {
        targetDb
          .prepare(`UPDATE profiles SET total_xp = 0, xp = 0, level = 1, updated_at = datetime('now') WHERE user_id = ?`)
          .run(uid);
        targetDb.prepare('DELETE FROM xp_transactions WHERE user_id = ?').run(uid);
      }

      if (scopes.achievements) {
        targetDb.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(uid);
        targetDb
          .prepare("UPDATE profiles SET featured_achievements_json = '[]', updated_at = datetime('now') WHERE user_id = ?")
          .run(uid);
        targetDb.prepare('DELETE FROM user_track_plays WHERE user_id = ?').run(uid);
        targetDb.prepare('DELETE FROM post_reads WHERE user_id = ?').run(uid);
        targetDb.prepare('DELETE FROM user_secret_flags WHERE user_id = ?').run(uid);
      }

      if (scopes.cosmetics) {
        targetDb.prepare('DELETE FROM user_inventory WHERE user_id = ?').run(uid);
        targetDb
          .prepare(`
            UPDATE profiles SET
              equipped_frame = NULL,
              equipped_banner = NULL,
              equipped_name_style = NULL,
              equipped_badge = NULL,
              equipped_title = NULL,
              equipped_theme = NULL,
              equipped_effect = NULL,
              updated_at = datetime('now')
            WHERE user_id = ?
          `)
          .run(uid);
      }

      if (scopes.games) {
        targetDb
          .prepare("UPDATE profiles SET daily_streak = 0, last_active_date = NULL, updated_at = datetime('now') WHERE user_id = ?")
          .run(uid);
        targetDb.prepare('DELETE FROM game_attempts WHERE user_id = ?').run(uid);
        targetDb.prepare('DELETE FROM daily_track_attempts WHERE user_id = ?').run(uid);
        targetDb.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(uid);
        targetDb.prepare('DELETE FROM game_completions WHERE user_id = ?').run(uid);
        targetDb.prepare('DELETE FROM daily_mini_game_attempts WHERE user_id = ?').run(uid);
      }
    }

    const auditOutcome = writeResetModerationAuditSafe(targetDb, {
      adminUserId: input.adminUserId,
      mode,
      primaryTargetId: targetIds[0] || null,
      affectedCount: targetIds.length,
      skipAdmins,
      scopes,
    });
    auditFallbackUsed = auditOutcome.fallbackUsed;
  })();

  return {
    ok: true,
    mode,
    affected_users: targetIds.length,
    scopes,
    audit_fallback_used: auditFallbackUsed,
  };
}
