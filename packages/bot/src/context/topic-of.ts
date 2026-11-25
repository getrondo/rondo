// Telegram also sets message_thread_id on ordinary replies, only is_topic_message marks a topic
import type { Message } from '@rondo/telegram/webhook/telegram-update.model';

export const topicOf = (message: Message): number | null =>
    message.is_topic_message === true ? (message.message_thread_id ?? null) : null;
