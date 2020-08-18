import Redis from 'ioredis';
import Redlock from 'redlock';
import logger from './logger';

export interface LockManagerOptions {
    redisClient: Redis.Redis;
    autoscalerProcessingLockTTL: number;
}

export default class LockManager {
    private redisClient: Redis.Redis;
    private groupProcessingLockManager: Redlock;
    private autoscalerProcessingLockTTL: number;
    private static readonly autoscalerProcessingLockKey = 'autoscalerLockKey';

    constructor(options: LockManagerOptions) {
        this.redisClient = options.redisClient;
        this.autoscalerProcessingLockTTL = options.autoscalerProcessingLockTTL;

        this.groupProcessingLockManager = new Redlock(
            // TODO: you should have one client for each independent redis node or cluster
            [this.redisClient],
            {
                driftFactor: 0.01, // time in ms
                retryCount: 3,
                retryDelay: 200, // time in ms
                retryJitter: 200, // time in ms
            },
        );

        this.groupProcessingLockManager.on('clientError', (err) => {
            logger.error('A redis error has occurred on the autoscalerLock:', err);
        });
    }

    async lockAutoscaleProcessing(): Promise<Redlock.Lock> {
        logger.debug(`Obtaining lock ${LockManager.autoscalerProcessingLockKey}`);
        const lock = await this.groupProcessingLockManager.lock(
            LockManager.autoscalerProcessingLockKey,
            this.autoscalerProcessingLockTTL,
        );
        logger.debug(`Lock obtained for ${LockManager.autoscalerProcessingLockKey}`);
        return lock;
    }
}
