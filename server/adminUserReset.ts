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
      audit_logged?: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function tableExists(targetDb: Database.Database, tableName: string): boolean {
  try {
    const row = targetDb
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName);
    return Boolean(row);
  } catch {
    return false;
  }
}

function getTableColumns(targetDb: Database.Database, tableName: string): Set<string> {
  try {
    const cols = targetDb
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    return new Set(cols.map((c) => c.name));
  } catch {
    return new Set<string>();
  }
}

function insertModerationAuditRow(
  targetDb: Database.Database,
  colSet: Set<string>,
  params: {
    id: string;
    moderatorId: string;
    targetUserId: string;
    actionName: string;
    detailsText: string;
  }
): void {
  const columns: string[] = [];
  const values: string[] = [];

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

/**
 * Post-commit moderation audit writer.
 * Must NEVER be called inside the reset transaction and NEVER pass NULL to target_user_id
 * on bulk reset (uses adminUserId so NOT NULL constraints on legacy DBs never fail).
 */
export function writeResetModerationAuditPostCommit(
  targetDb: Database.Database,
  params: {
    adminUserId: string;
    mode: 'single' | 'bulk';
    primaryTargetId: string;
    affectedCount: number;
    skipAdmins: boolean;
    scopes: UserResetScopes;
  }
): boolean {
  const colSet = getTableColumns(targetDb, 'moderation_actions');
  if (colSet.size === 0) return false;

  const actionName = params.mode === 'bulk' ? 'mass_reset' : 'user_reset';
  const targetUserId =
    params.mode === 'bulk' ? params.adminUserId : params.primaryTargetId || params.adminUserId;
  const detailsText =
    `mode=${params.mode} skip_admins=${params.skipAdmins} ` +
    `affected=${params.affectedCount} scopes=${JSON.stringify(params.scopes)} ` +
    `by=${params.adminUserId}`;

  insertModerationAuditRow(targetDb, colSet, {
    id: 'mod_' + crypto.randomUUID().slice(0, 8),
    moderatorId: params.adminUserId,
    targetUserId,
    actionName,
    detailsText,
  });

  return true;
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

  const profileCols = getTableColumns(targetDb, 'profiles');
  const userCols = getTableColumns(targetDb, 'users');
  const hasXpHistory = tableExists(targetDb, 'xp_history');
  const hasXpTransactions = tableExists(targetDb, 'xp_transactions');
  const hasUserAchievements = tableExists(targetDb, 'user_achievements');
  const hasUserTrackPlays = tableExists(targetDb, 'user_track_plays');
  const hasPostReads = tableExists(targetDb, 'post_reads');
  const hasUserSecretFlags = tableExists(targetDb, 'user_secret_flags');
  const hasUserInventory = tableExists(targetDb, 'user_inventory');
  const hasGameAttempts = tableExists(targetDb, 'game_attempts');
  const hasDailyTrackAttempts = tableExists(targetDb, 'daily_track_attempts');
  const hasQuizAttempts = tableExists(targetDb, 'quiz_attempts');
  const hasGameCompletions = tableExists(targetDb, 'game_completions');
  const hasDailyMiniGameAttempts = tableExists(targetDb, 'daily_mini_game_attempts');

  const profileXpAssigns: string[] = [];
  for (const col of ['total_xp', 'xp', 'spendable_xp', 'xp_balance']) {
    if (profileCols.has(col)) profileXpAssigns.push(`${col} = 0`);
  }
  if (profileCols.has('level')) profileXpAssigns.push('level = 1');
  if (profileCols.has('updated_at')) profileXpAssigns.push("updated_at = datetime('now')");

  const userXpAssigns: string[] = [];
  for (const col of ['total_xp', 'xp', 'spendable_xp', 'xp_balance']) {
    if (userCols.has(col)) userXpAssigns.push(`${col} = 0`);
  }
  if (userCols.has('level')) userXpAssigns.push('level = 1');
  if (userXpAssigns.length > 0 && userCols.has('updated_at')) {
    userXpAssigns.push("updated_at = datetime('now')");
  }

  targetDb.transaction(() => {
    for (const uid of targetIds) {
      if (scopes.xp) {
        if (profileXpAssigns.length > 0) {
          targetDb
            .prepare(`UPDATE profiles SET ${profileXpAssigns.join(', ')} WHERE user_id = ?`)
            .run(uid);
        }
        if (userXpAssigns.length > 0) {
          targetDb
            .prepare(`UPDATE users SET ${userXpAssigns.join(', ')} WHERE id = ?`)
            .run(uid);
        }
        if (hasXpTransactions) {
          targetDb.prepare('DELETE FROM xp_transactions WHERE user_id = ?').run(uid);
        }
        if (hasXpHistory) {
          targetDb.prepare('DELETE FROM xp_history WHERE user_id = ?').run(uid);
        }
        // Clear earned game XP when XP is reset without wiping game history so leaderboard totals drop to 0
        if (!scopes.games) {
          if (hasGameAttempts) {
            targetDb.prepare('UPDATE game_attempts SET xp_earned = 0, score = 0 WHERE user_id = ?').run(uid);
          }
          if (hasDailyTrackAttempts) {
            targetDb.prepare('UPDATE daily_track_attempts SET xp_earned = 0, score = 0 WHERE user_id = ?').run(uid);
          }
          if (hasQuizAttempts) {
            targetDb.prepare('UPDATE quiz_attempts SET xp_earned = 0, score = 0 WHERE user_id = ?').run(uid);
          }
          if (hasGameCompletions) {
            targetDb.prepare('UPDATE game_completions SET xp_earned = 0, score = 0 WHERE user_id = ?').run(uid);
          }
          if (hasDailyMiniGameAttempts) {
            targetDb.prepare('UPDATE daily_mini_game_attempts SET xp_earned = 0, score = 0 WHERE user_id = ?').run(uid);
          }
        }
      }

      if (scopes.achievements) {
        if (hasUserAchievements) {
          targetDb.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(uid);
        }
        if (profileCols.has('featured_achievements_json')) {
          targetDb
            .prepare("UPDATE profiles SET featured_achievements_json = '[]', updated_at = datetime('now') WHERE user_id = ?")
            .run(uid);
        }
        if (hasUserTrackPlays) {
          targetDb.prepare('DELETE FROM user_track_plays WHERE user_id = ?').run(uid);
        }
        if (hasPostReads) {
          targetDb.prepare('DELETE FROM post_reads WHERE user_id = ?').run(uid);
        }
        if (hasUserSecretFlags) {
          targetDb.prepare('DELETE FROM user_secret_flags WHERE user_id = ?').run(uid);
        }
      }

      if (scopes.cosmetics) {
        if (hasUserInventory) {
          targetDb.prepare('DELETE FROM user_inventory WHERE user_id = ?').run(uid);
        }
        const cosmeticCols = [
          'equipped_frame',
          'equipped_banner',
          'equipped_name_style',
          'equipped_badge',
          'equipped_title',
          'equipped_theme',
          'equipped_effect',
        ].filter((c) => profileCols.has(c));
        if (cosmeticCols.length > 0) {
          const assigns = cosmeticCols.map((c) => `${c} = NULL`);
          if (profileCols.has('updated_at')) assigns.push("updated_at = datetime('now')");
          targetDb.prepare(`UPDATE profiles SET ${assigns.join(', ')} WHERE user_id = ?`).run(uid);
        }
      }

      if (scopes.games) {
        const streakAssigns: string[] = [];
        if (profileCols.has('daily_streak')) streakAssigns.push('daily_streak = 0');
        if (profileCols.has('last_active_date')) streakAssigns.push('last_active_date = NULL');
        if (streakAssigns.length > 0) {
          if (profileCols.has('updated_at')) streakAssigns.push("updated_at = datetime('now')");
          targetDb.prepare(`UPDATE profiles SET ${streakAssigns.join(', ')} WHERE user_id = ?`).run(uid);
        }
        if (hasGameAttempts) {
          targetDb.prepare('DELETE FROM game_attempts WHERE user_id = ?').run(uid);
        }
        if (hasDailyTrackAttempts) {
          targetDb.prepare('DELETE FROM daily_track_attempts WHERE user_id = ?').run(uid);
        }
        if (hasQuizAttempts) {
          targetDb.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(uid);
        }
        if (hasGameCompletions) {
          targetDb.prepare('DELETE FROM game_completions WHERE user_id = ?').run(uid);
        }
        if (hasDailyMiniGameAttempts) {
          targetDb.prepare('DELETE FROM daily_mini_game_attempts WHERE user_id = ?').run(uid);
        }
        if (!scopes.xp && hasXpTransactions) {
          try {
            targetDb
              .prepare("UPDATE xp_transactions SET reference_key = NULL WHERE user_id = ? AND reference_key LIKE 'game:%'")
              .run(uid);
          } catch {}
        }
      }
    }
  })();

  // Audit log runs strictly AFTER the reset transaction commits so logging errors can NEVER roll back a reset
  let auditLogged = false;
  try {
    auditLogged = writeResetModerationAuditPostCommit(targetDb, {
      adminUserId: input.adminUserId,
      mode,
      primaryTargetId: mode === 'single' ? targetIds[0] : input.adminUserId,
      affectedCount: targetIds.length,
      skipAdmins,
      scopes,
    });
  } catch (auditErr) {
    console.error('[ModerationAudit] Post-commit audit log failed (reset preserved):', auditErr);
  }

  return {
    ok: true,
    mode,
    affected_users: targetIds.length,
    scopes,
    audit_logged: auditLogged,
  };
}
