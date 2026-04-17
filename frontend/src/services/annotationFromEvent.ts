import type {
  ChannelHypeTrainBeginEvent,
  ChannelHypeTrainEndEvent,
  ChannelRaidEvent,
  ChannelSubscribeEvent,
  ChannelSubscriptionGiftEvent,
  EventAnnotation,
} from '../types/twitch'

const formatNumber = (n: number): string => n.toLocaleString('en-US')

export type AnnotationInfo = Pick<EventAnnotation, 'type' | 'label'>

/**
 * Pure function that turns a Twitch EventSub subscription type + event payload
 * into the shared `EventAnnotation` shape consumed by the heatmap and
 * multi-stream chart. Returns null when the subscription type is not one of
 * the annotation-producing events.
 */
export const annotationFromEvent = (
  subscriptionType: string,
  event: unknown,
): AnnotationInfo | null => {
  if (subscriptionType === 'channel.raid') {
    const e = event as ChannelRaidEvent
    return {
      type: 'raid',
      label: `Raid from ${e.from_broadcaster_user_name} (${formatNumber(e.viewers)} viewers)`,
    }
  }
  if (subscriptionType === 'channel.subscribe') {
    const e = event as ChannelSubscribeEvent
    return { type: 'subscription', label: `Subscription from ${e.user_name}` }
  }
  if (subscriptionType === 'channel.subscription.gift') {
    const e = event as ChannelSubscriptionGiftEvent
    const who = e.is_anonymous || !e.user_name ? 'Anonymous' : e.user_name
    return { type: 'gift_sub', label: `Gift sub from ${who} (${e.total} subs)` }
  }
  if (subscriptionType === 'channel.hype_train.begin') {
    const e = event as ChannelHypeTrainBeginEvent
    return { type: 'hype_train_begin', label: `Hype train started (level ${e.level})` }
  }
  if (subscriptionType === 'channel.hype_train.end') {
    const e = event as ChannelHypeTrainEndEvent
    return { type: 'hype_train_end', label: `Hype train ended at level ${e.level}` }
  }
  return null
}
