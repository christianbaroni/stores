import { time } from '../../utils/time';

/**
 * Lazy initialization config for subscription handlers.
 */
interface SubscriptionHandlerConfig {
  /**
   * Callback executed when a subscription is added.
   * @param isFirstSubscription - Whether this is the first subscription
   * @param shouldThrottle - Whether to throttle the fetch
   */
  onSubscribe: (isFirstSubscription: boolean, shouldThrottle: boolean) => void;
  /** Callback executed when the last remaining subscription is removed. */
  onLastUnsubscribe: (willResubscribe?: boolean) => void;
}

/**
 * Manages subscription state and lifecycle events for a `createQueryStore` instance.
 */
export class SubscriptionManager {
  private count = 0;
  private lastSubscriptionTime: number | null = null;
  private readonly fetchThrottleMs: number | null = null;

  private onSubscribe: SubscriptionHandlerConfig['onSubscribe'] | null = null;
  private onLastUnsubscribe: SubscriptionHandlerConfig['onLastUnsubscribe'] | null = null;

  /**
   * Creates a new SubscriptionManager instance.
   */
  constructor(disableAutoRefetching: boolean) {
    if (disableAutoRefetching) {
      this.fetchThrottleMs = time.seconds(5);
    }
  }

  /**
   * Initializes subscription event handlers.
   */
  init({ onSubscribe, onLastUnsubscribe }: SubscriptionHandlerConfig): void {
    this.onSubscribe = onSubscribe;
    this.onLastUnsubscribe = onLastUnsubscribe;
  }

  hasSubscribers(): boolean {
    return this.count > 0;
  }

  /**
   * Adds a new subscription and triggers relevant lifecycle callbacks.
   * @returns A cleanup function that removes the subscription when called
   */
  subscribe(): (skipAbortFetch?: boolean) => void {
    const isFirstSubscription = this.count === 0;
    const throttleActive = this.fetchThrottleMs !== null;

    const shouldThrottle =
      throttleActive &&
      this.lastSubscriptionTime !== null &&
      !isFirstSubscription &&
      Date.now() - this.lastSubscriptionTime <= this.fetchThrottleMs;

    this.count += 1;
    this.onSubscribe?.(isFirstSubscription, shouldThrottle);

    if (throttleActive) this.lastSubscriptionTime = Date.now();

    return (skipAbortFetch?: boolean) => {
      const isLastSubscription = this.count === 1;
      this.count = Math.max(this.count - 1, 0);

      if (isLastSubscription) {
        this.onLastUnsubscribe?.(skipAbortFetch);
        this.lastSubscriptionTime = null;
      }
    };
  }
}
