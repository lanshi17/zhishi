import type { DbPool } from "../db.js";

export type ConversationRole = "user" | "assistant";

export type ConversationMessageInput = {
  userId: string;
  role: ConversationRole;
  content: string;
};

export type ConversationMessage = ConversationMessageInput & {
  id: string;
};

/**
 * Stores messages in chronological order. The token estimate treats every
 * character as a token, which deliberately errs on the safe side for the
 * predominantly Chinese conversation content handled by this application.
 */
const MESSAGE_TOKEN_OVERHEAD = 4;

export class ConversationRepository {
  constructor(private readonly pool: DbPool) {}

  async append(input: ConversationMessageInput): Promise<ConversationMessage> {
    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      userId: input.userId,
      role: input.role,
      content: input.content,
    };

    await this.pool.query(
      "INSERT INTO conversation_messages (id, user_id, role, content) VALUES ($1, $2, $3, $4)",
      [message.id, message.userId, message.role, message.content],
    );

    return message;
  }

  async listRecentByUserId(userId: string, tokenBudget: number): Promise<ConversationMessage[]> {
    const result = await this.pool.query(
      `WITH ranked_messages AS (
        SELECT id, user_id, role, content, seq,
          SUM(char_length(content) + ${MESSAGE_TOKEN_OVERHEAD}) OVER (ORDER BY seq DESC) AS estimated_tokens
        FROM conversation_messages
        WHERE user_id = $1
      )
      SELECT id, user_id, role, content
      FROM ranked_messages
      WHERE estimated_tokens <= $2
      ORDER BY seq ASC`,
      [userId, tokenBudget],
    );

    return result.rows.map((row: {
      id: string;
      user_id: string;
      role: ConversationRole;
      content: string;
    }) => ({
      id: row.id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
    }));
  }
}
