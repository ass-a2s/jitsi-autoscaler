import { Context } from './context';
import GroupReportGenerator from './group_report';
import CloudManager, { CloudInstance, CloudRetryStrategy } from './cloud_manager';
import InstanceGroupManager, { InstanceGroup } from './instance_group';
import Redis from 'ioredis';

export interface SanityLoopOptions {
    redisClient: Redis.Redis;
    metricsTTL: number;
    cloudManager: CloudManager;
    reportExtCallRetryStrategy: CloudRetryStrategy;
    groupReportGenerator: GroupReportGenerator;
    instanceGroupManager: InstanceGroupManager;
}

export default class SanityLoop {
    private cloudManager: CloudManager;
    private reportExtCallRetryStrategy: CloudRetryStrategy;
    private groupReportGenerator: GroupReportGenerator;
    private instanceGroupManager: InstanceGroupManager;
    private redisClient: Redis.Redis;
    private metricsTTL: number;

    constructor(options: SanityLoopOptions) {
        this.cloudManager = options.cloudManager;
        this.reportExtCallRetryStrategy = options.reportExtCallRetryStrategy;
        this.groupReportGenerator = options.groupReportGenerator;
        this.instanceGroupManager = options.instanceGroupManager;
        this.redisClient = options.redisClient;
        this.metricsTTL = options.metricsTTL;

        this.reportUntrackedInstances = this.reportUntrackedInstances.bind(this);
    }

    async reportUntrackedInstances(ctx: Context, groupName: string): Promise<boolean> {
        const group: InstanceGroup = await this.instanceGroupManager.getInstanceGroup(groupName);
        if (group) {
            const cloudInstances = await this.cloudManager.getInstances(ctx, group, this.reportExtCallRetryStrategy);
            await this.saveCloudInstances(group.name, cloudInstances);
            const groupReport = await this.groupReportGenerator.generateReport(ctx, group);
            await this.saveMetricUnTrackedCount(groupName, groupReport.unTrackedCount);
            ctx.logger.info(
                `Successfully saved cloud instances and untracked count ${groupReport.unTrackedCount} for ${groupName}`,
            );
            return true;
        } else {
            ctx.logger.info(`Skipped saving untracked instances, as group is not found ${groupName}`);
            return false;
        }
    }

    async saveMetricUnTrackedCount(groupName: string, count: number): Promise<boolean> {
        const key = `service-metrics:${groupName}:untracked-count`;
        const result = await this.redisClient.set(key, JSON.stringify(count), 'ex', this.metricsTTL);
        if (result !== 'OK') {
            throw new Error(`unable to set ${key}`);
        }
        return true;
    }

    private async saveCloudInstances(groupName: string, cloudInstances: Array<CloudInstance>) {
        await Promise.all(
            cloudInstances.map(async (cloudInstance) => {
                return this.setCloudInstanceValue(
                    `cloud-instances:${groupName}:${cloudInstance.instanceId}`,
                    cloudInstance,
                    this.metricsTTL,
                );
            }),
        );
    }

    async setCloudInstanceValue(key: string, value: CloudInstance, ttl: number): Promise<boolean> {
        const result = await this.redisClient.set(key, JSON.stringify(value), 'ex', ttl);
        if (result !== 'OK') {
            throw new Error(`unable to set ${key}`);
        }
        return true;
    }
}
