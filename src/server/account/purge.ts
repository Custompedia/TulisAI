import { runtime } from '../runtime';
import { deleteDocument } from '../documents/service';

// Removes everything the app stores for a user except the auth rows (user, session, account), which the caller deletes.
export async function purgeUserData(userId: string): Promise<void> {
  while (true) {
    const documents = await runtime().DB.prepare('SELECT id FROM documents WHERE owner_id=? ORDER BY id ASC LIMIT 100').bind(userId).all<{ id: string }>();
    if (!(documents.results ?? []).length) break;
    for (const document of documents.results ?? []) await deleteDocument(userId, document.id);
  }
  await runtime().DB.batch([
    runtime().DB.prepare('DELETE FROM user_preferences WHERE user_id=?').bind(userId),
    runtime().DB.prepare('DELETE FROM writing_styles WHERE owner_id=?').bind(userId),
    runtime().DB.prepare('DELETE FROM usage_ledger WHERE owner_id=?').bind(userId),
  ]);
}
