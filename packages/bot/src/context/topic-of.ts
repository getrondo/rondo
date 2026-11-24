// Telegram also sets message_thread_id on ordinary replies, only is_topic_message marks a topic
import type { Message } from 'grammy/types';

export const topicOf = (message: Message): number | null =>
    message.is_topic_message === true ? (message.message_thread_id ?? null) : null;
