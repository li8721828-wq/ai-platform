import { runStmt, queryAll, queryOne } from '../db/sqlite.js';

export interface MessageRecord {
  id: string;
  traceId?: string;
  platform: string;
  channel: string;
  userId: string;
  userName?: string;
  groupId?: string;
  text: string;
  role: string;
  replyTo?: string;
  timestamp: number;
  createdAt: number;
}

export class MessageStore {
  insert(msg: Omit<MessageRecord, 'id' | 'createdAt'> & { id?: string }) {
    runStmt(
      `INSERT INTO messages (id, trace_id, platform, channel, user_id, user_name, group_id, text, role, reply_to, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        msg.traceId || null,
        msg.platform,
        msg.channel || 'private',
        msg.userId,
        msg.userName || null,
        msg.groupId || null,
        msg.text,
        msg.role,
        msg.replyTo || null,
        msg.timestamp || Date.now(),
        Date.now(),
      ],
    );
  }

  list(limit = 50, offset = 0, userId?: string): MessageRecord[] {
    let sql = 'SELECT * FROM messages';
    const params: any[] = [];
    if (userId) { sql += ' WHERE user_id = ?'; params.push(userId); }
    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return queryAll(sql, params).map(this.mapRow);
  }

  listUsers(): { userId: string; count: number; lastTime: number }[] {
    return queryAll(
      'SELECT DISTINCT user_id, count(*) as count, max(timestamp) as last_time FROM messages GROUP BY user_id ORDER BY last_time DESC',
    );
  }

  private mapRow(row: any): MessageRecord {
    return {
      id: row.id,
      traceId: row.trace_id || undefined,
      platform: row.platform,
      channel: row.channel,
      userId: row.user_id,
      userName: row.user_name || undefined,
      groupId: row.group_id || undefined,
      text: row.text,
      role: row.role,
      replyTo: row.reply_to || undefined,
      timestamp: row.timestamp,
      createdAt: row.created_at,
    };
  }
}

export const messageStore = new MessageStore();
