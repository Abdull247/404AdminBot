import { isGroupJid } from '../../../whatsapp/filters.js';
import { deleteStoredFile, getStoredFile } from '../../../db/repositories/files.js';
import { deleteR2Object } from '../../../storage/r2.js';
import { logger } from '../../../utils/logger.js';

export async function handler(args = {}, context = {}) {
  const jid = context.jid;
  if (!jid) return { ok: false, error: 'no WhatsApp chat context' };
  if (isGroupJid(jid)) {
    return { ok: false, error: 'Uploaded files can only be deleted from the chat that owns them.' };
  }

  const fileId = String(args.fileId || '').trim();
  if (!fileId) {
    return { ok: false, error: 'fileId is required (the id returned when the Reelix file was uploaded)' };
  }

  try {
    const record = await getStoredFile(fileId, jid);
    if (!record) {
      return {
        ok: false,
        error: 'No uploaded file with that id was found for this user. Only the uploader can delete a file.',
      };
    }
    await deleteStoredFile(fileId, jid);
    await deleteR2Object(record.key).catch((error) => {
      logger.warn({ err: error, key: record.key }, 'failed to delete R2 object for Reelix file');
    });
    logger.info({ jid, id: fileId, filename: record.filename }, 'deleted Reelix uploaded file');
    return {
      ok: true,
      deleted: true,
      fileId,
      filename: record.filename,
      notice: 'The file and its direct download link have been deleted. Confirm this to the user.',
    };
  } catch (error) {
    logger.error({ err: error, fileId, jid }, 'reelix delete failed');
    return { ok: false, error: error.message };
  }
}
