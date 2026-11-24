// Telegram refuses a message_thread_id for the General topic, so a group without a bound topic gets none
import { isDefined } from '@rnw-community/shared';

import type { GroupTarget } from '../interface/group-target.interface';

export const topicOptions = ({ topicId }: Pick<GroupTarget, 'topicId'>) => (isDefined(topicId) ? { message_thread_id: topicId } : {});
